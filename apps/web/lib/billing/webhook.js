// Processing a Razorpay webhook delivery, once its signature has been checked.
//
// The route verifies the signature. This decides what the delivery means and
// applies it. The split matters: nothing here should ever be reachable by an
// unverified request, and keeping verification at the edge makes that visible.
//
// Three properties this has to hold, because Razorpay guarantees none of them:
//
//   Idempotent.   A delivery is retried until it gets a 2xx, so the same event
//                 arrives many times. The unique providerEventId makes the
//                 second insert lose and the work is skipped.
//   Order-free.   Deliveries arrive out of order. No event's payload is ever
//                 used as the source of a subscription's state -- the event is
//                 a prompt to ask Razorpay what is true now, and the answer is
//                 the same whichever order the prompts arrive in.
//   Recoverable.  A delivery that fails halfway is left FAILED with a reason,
//                 and answered 500 so Razorpay sends it again.

import { adminDb } from "@/lib/prisma";
import { syncFromProvider } from "./service";
import { fromUnix } from "./status";

// Events this endpoint acts on. Anything else is recorded and ignored rather
// than treated as an error: Razorpay lets an account subscribe to more events
// than this handles, and an unexpected one is not a failure.
export const HANDLED_EVENTS = new Set([
  // The mandate was authorised. Still not paid for.
  "subscription.authenticated",
  // Charged and running.
  "subscription.activated",
  "subscription.charged",
  // A charge failed; Razorpay is retrying, or has stopped.
  "subscription.pending",
  "subscription.halted",
  // Ended, one way or another.
  "subscription.cancelled",
  "subscription.completed",
  "subscription.expired",
  // Suspended, resumed, or its plan changed at cycle end.
  "subscription.paused",
  "subscription.resumed",
  "subscription.updated",
]);

const PAYMENT_STATUS = {
  captured: "CAPTURED",
  authorized: "AUTHORIZED",
  failed: "FAILED",
  refunded: "REFUNDED",
};

// The subscription and payment entities a delivery carries, if any.
const entitiesOf = (body) => ({
  subscription: body?.payload?.subscription?.entity ?? null,
  payment: body?.payload?.payment?.entity ?? null,
});

// Records the charge behind a subscription.charged event.
//
// Separate from the subscription's own state on purpose: a payment is a fact
// that happened once, and the row for it must not be rewritten by a later
// delivery of the same event. The unique providerPaymentId makes the repeat a
// no-op rather than a second charge in the history.
async function recordPayment(subscriptionRowId, payment, period) {
  if (!payment?.id) return;

  const status = PAYMENT_STATUS[String(payment.status ?? "").toLowerCase()] ?? null;
  if (!status) return;

  await adminDb.payment.upsert({
    where: { providerPaymentId: payment.id },
    // A repeat delivery changes only the status -- a payment that was
    // authorized and is now captured is the same payment.
    update: { status },
    create: {
      subscriptionId: subscriptionRowId,
      providerPaymentId: payment.id,
      providerInvoiceId: payment.invoice_id ?? null,
      // Minor units, as Razorpay sends them. Never converted to a float.
      amount: Number.isSafeInteger(payment.amount) ? payment.amount : 0,
      currency: payment.currency ?? "INR",
      status,
      periodStart: period?.currentStart ?? null,
      periodEnd: period?.currentEnd ?? null,
      paidAt: fromUnix(payment.created_at),
    },
  });
}

// Applies one verified delivery.
//
// Returns { applied, reason }. The route turns that into a status code; it
// never turns a "we chose not to act on this" into an error, because Razorpay
// would retry it forever.
export async function processEvent({ eventId, body }) {
  const eventType = String(body?.event ?? "");
  const { subscription, payment } = entitiesOf(body);
  const providerSubscriptionId = subscription?.id ?? null;
  const eventAt = fromUnix(body?.created_at);

  // 1. Have we seen this delivery before? The insert is the lock: two
  //    concurrent retries race here and exactly one wins.
  try {
    await adminDb.billingEvent.create({
      data: {
        providerEventId: eventId,
        eventType,
        providerSubscriptionId,
        providerPaymentId: payment?.id ?? null,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return { applied: false, reason: "duplicate" };
    }
    throw error;
  }

  const finish = (status, note) =>
    adminDb.billingEvent.update({
      where: { providerEventId: eventId },
      data: { status, note: note ?? null, processedAt: new Date() },
    });

  try {
    if (!HANDLED_EVENTS.has(eventType)) {
      await finish("IGNORED", "event type not handled");
      return { applied: false, reason: "unhandled" };
    }

    if (!providerSubscriptionId) {
      await finish("IGNORED", "no subscription in payload");
      return { applied: false, reason: "no-subscription" };
    }

    // 2. Is it about a subscription this deployment opened? A delivery for an
    //    unknown one is recorded and dropped -- it belongs to another
    //    environment sharing the merchant account, which is the normal state
    //    of affairs when test and live keys point at the same dashboard.
    //
    //    Either record counts, and this is what makes a webhook arriving
    //    BEFORE the browser callback work rather than being discarded: at
    //    that moment there is no subscription row yet, only the checkout
    //    attempt that opened it. The sync below creates the row from that
    //    attempt, so the first thing to arrive -- webhook or callback --
    //    establishes the subscription and the second finds it already there.
    const [known, attempt] = await Promise.all([
      adminDb.subscription.findUnique({
        where: { providerSubscriptionId },
        select: { id: true },
      }),
      adminDb.checkoutAttempt.findUnique({
        where: { providerSubscriptionId },
        select: { id: true },
      }),
    ]);
    if (!known && !attempt) {
      await finish("IGNORED", "unknown subscription");
      return { applied: false, reason: "unknown-subscription" };
    }

    // 3. Ask Razorpay what is true now. The event told us something changed;
    //    it does not get to tell us what the state is.
    const synced = await syncFromProvider(providerSubscriptionId, { eventAt });
    if (!synced) {
      await finish("IGNORED", "provider state not recognised");
      return { applied: false, reason: "unrecognised-state" };
    }

    // 4. A charge is a fact of its own, and is recorded whatever the
    //    subscription's current state turned out to be.
    if (eventType === "subscription.charged" && payment) {
      // synced.id, not the row read in step 2: on a webhook that arrived
      // first there was no row to read, and the sync has just created it.
      await recordPayment(synced.id, payment, synced);
    }

    await finish("PROCESSED", null);
    return { applied: true, status: synced.status, planId: synced.planId };
  } catch (error) {
    // Left FAILED with a short reason so a retry is visibly a retry. The
    // message is ours, never the provider's payload and never a secret.
    await adminDb.billingEvent
      .update({
        where: { providerEventId: eventId },
        data: { status: "FAILED", note: "processing failed", processedAt: new Date() },
      })
      .catch(() => {});
    throw error;
  }
}
