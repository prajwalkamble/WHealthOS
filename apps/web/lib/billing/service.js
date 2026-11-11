// The subscription lifecycle: opening one, confirming it, keeping it in step
// with the provider, and answering what somebody is entitled to.
//
// Two database identities are used here, deliberately:
//
//   reads  go through withTenant(), so row-level security scopes them to the
//          person asking and a bug cannot read somebody else's subscription.
//   writes go through adminDb, because the RLS policies let only the job
//          runner write billing rows. A request carrying a signed-in user's
//          tenant context cannot mark its own subscription active.
//
// Nothing in this file takes a price, a plan id, a status or an owner from a
// request. Every one of those is resolved from configuration or from Razorpay.
//
// The ordering of a checkout is the part worth reading twice. A local attempt
// row is written BEFORE Razorpay is called, because the other way round --
// create the subscription, then record it -- loses the subscription whenever
// the response does not arrive, and the retry that follows creates a second
// one. The attempt is what the retry finds.

import { randomUUID } from "node:crypto";
import { adminDb } from "@/lib/prisma";
import {
  queueActivationNotification,
  queuePlanChangeNotification,
} from "@/lib/notifications/subscription-activated";
import { withTenant } from "@/lib/prisma";
import {
  PaymentError,
  cancelSubscription,
  changeSubscriptionPlan,
  checkoutSignatureMatches,
  createSubscription,
  fetchSubscription,
  listSubscriptions,
} from "@/lib/payments/razorpay";
import {
  FREE_PLAN_ID,
  catalogEntry,
  intervalEnum,
  planFromProviderPlanId,
  rankOf,
  resolvePurchase,
  totalCountFor,
} from "./plans";
import {
  LIVE_STATUSES,
  SUBSCRIPTION_STATUS,
  fromUnix,
  grantsAccess,
  isLive,
  normaliseStatus,
} from "./status";

export class BillingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
  }
}

// How many of a person's subscriptions are considered when working out what
// they can do. More than one is already unusual -- the partial unique index
// allows only one live at a time -- and this bounds the query either way.
const RECENT = 10;

// How long an attempt may be resumed for.
//
// Long enough to cover somebody fetching their phone for a UPI PIN, short
// enough that a half-finished purchase from this morning does not reopen when
// they come back in the evening expecting to start again. Razorpay's own
// authorisation links outlive this; what expires here is only our willingness
// to reuse the same one.
const ATTEMPT_TTL_MINUTES = 30;

// The two states that occupy the one-attempt-per-user slot. Must match the
// partial unique index in the checkout_attempts migration.
export const IN_FLIGHT_ATTEMPT_STATUSES = ["OPEN", "CREATED"];

// Razorpay states a payment window can still be opened against. `created` is
// never authorised; `authenticated` has a mandate but no charge yet, and
// reopening it is how somebody who closed the window finishes paying.
const REOPENABLE = new Set(["created", "authenticated"]);

// --- Reading ----------------------------------------------------------------

const selectSubscription = {
  id: true,
  planId: true,
  interval: true,
  status: true,
  amount: true,
  currency: true,
  currentStart: true,
  currentEnd: true,
  cancelAtPeriodEnd: true,
  cancelledAt: true,
  endedAt: true,
  // What has been asked for and not yet taken effect. Read everywhere a
  // subscription is read, because every screen that shows the current plan has
  // to be able to say "and it changes on the 11th" -- a screen that shows one
  // without the other is how somebody comes to think their upgrade was lost.
  scheduledPlanId: true,
  scheduledInterval: true,
  scheduledChangeAt: true,
  providerSubscriptionId: true,
  createdAt: true,
  updatedAt: true,
};

const selectAttempt = {
  id: true,
  userId: true,
  planId: true,
  interval: true,
  status: true,
  amount: true,
  currency: true,
  providerPlanId: true,
  providerSubscriptionId: true,
  idempotencyKey: true,
  failureCode: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
};

// Every subscription that might still matter, newest first.
async function recentFor(userId, tx) {
  const client = tx ?? null;
  const query = (c) =>
    c.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT,
      select: selectSubscription,
    });

  if (client) return query(client);
  return withTenant(userId, (t) => query(t));
}

// The subscription that currently entitles this person to something, or null.
//
// Where more than one would grant access -- a cancelled Pro still inside its
// paid period alongside a fresh Intelligent -- the higher plan wins, so an
// upgrade is never worse than not upgrading.
export async function effectiveSubscription(userId, { tx = null, now = new Date() } = {}) {
  return bestGranting(await recentFor(userId, tx), now);
}

// The same decision, over rows somebody already has in hand.
//
// Pure, and exported because one caller cannot afford the query above. The app
// shell needs the plan on every navigation -- it decides whether the assistant
// is mounted at all -- and lib/checkUser.js is already fetching the account
// row, so it includes the recent subscriptions in that fetch and asks this
// instead of opening two more tenant transactions per page.
//
// Shared rather than reimplemented there: "which subscription grants the most"
// is a rule with a real edge -- a cancelled Pro inside its paid period beside a
// fresh Intelligent -- and two copies of it would eventually disagree about
// which plan somebody is on, in the two places most likely to be compared.
export const bestGranting = (rows, now = new Date()) => {
  const granting = (rows ?? []).filter((row) => grantsAccess(row, now));
  if (granting.length === 0) return null;

  return granting.reduce((best, row) =>
    rankOf(row.planId) > rankOf(best.planId) ? row : best
  );
};

// The plan to authorise against, from rows in hand. Free when nothing grants.
export const planIdFromRows = (rows, now = new Date()) =>
  bestGranting(rows, now)?.planId ?? FREE_PLAN_ID;

// The plan to authorise against. Free when nothing grants anything, which is
// the state every account is in until it pays.
export async function effectivePlanId(userId, options = {}) {
  const subscription = await effectiveSubscription(userId, options);
  return subscription?.planId ?? FREE_PLAN_ID;
}

// The subscription occupying the one-live-per-user slot, if any. This is what
// makes a second checkout a conflict rather than a duplicate charge.
export async function liveSubscription(userId, { tx = null } = {}) {
  const rows = await recentFor(userId, tx);
  return rows.find((row) => isLive(row.status)) ?? null;
}

// The attempt in flight for this person, if any. Read as the tenant: it is
// their own row, and nothing here needs to see anybody else's.
export async function inFlightAttempt(userId, { tx = null } = {}) {
  const query = (c) =>
    c.checkoutAttempt.findFirst({
      where: { userId, status: { in: IN_FLIGHT_ATTEMPT_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: selectAttempt,
    });

  if (tx) return query(tx);
  return withTenant(userId, (t) => query(t));
}

// Everything the billing screens need, in one trip.
export async function billingSummary(userId) {
  const [rows, attempt] = await Promise.all([
    recentFor(userId),
    inFlightAttempt(userId).catch(() => null),
  ]);

  const now = new Date();
  const granting = rows.filter((row) => grantsAccess(row, now));
  const effective =
    granting.length === 0
      ? null
      : granting.reduce((best, row) => (rankOf(row.planId) > rankOf(best.planId) ? row : best));

  const pending = rows.find((row) => row.status === SUBSCRIPTION_STATUS.PENDING) ?? null;

  return {
    planId: effective?.planId ?? FREE_PLAN_ID,
    subscription: effective ?? rows.find((row) => isLive(row.status)) ?? null,
    // A pending one is worth showing even when it grants nothing: it is why
    // the upgrade button is unavailable.
    pending,
    // The attempt, so a screen can say "we are still confirming" rather than
    // "you are on the Free plan" to somebody who has just paid.
    attempt: attempt ?? null,
    // True when something is on its way but has not been established yet.
    // This is what the confirmation page polls on, and it is deliberately not
    // a grant of anything: it only decides whether to keep waiting.
    confirming: Boolean(!effective && (pending || (attempt && attempt.status === "CREATED"))),
  };
}

// --- Opening a subscription -------------------------------------------------

// How long a create call may plausibly still be in flight.
//
// Longer than the browser's own request timeout (20s in use-checkout.js), so
// that by the time an attempt is older than this, nothing is still waiting on
// it and there is genuinely something to reconcile.
const CREATE_IN_FLIGHT_MS = 30_000;

// Failures after which Razorpay cannot have created a subscription.
//
// Keyed on the error CODE, not on the HTTP status this application chose to
// report. Those are two different questions, and tying them together is a
// bug waiting for somebody to change a status code: rejected merchant
// credentials became a 503 rather than a 401 -- the right answer, since it is
// an operator problem and not the caller's session -- and that silently moved
// them into "might have created something, keep the attempt open for
// reconciliation", which is the opposite of the truth.
const DEFINITELY_NOT_CREATED = new Set([
  // No credentials configured; nothing was ever sent.
  "NOT_CONFIGURED",
  // Credentials sent and refused. Razorpay did not get as far as a
  // subscription, so there is no orphan and nothing to reconcile.
  "UPSTREAM_UNAUTHORIZED",
]);

// Whether a failed create call may nonetheless have reached the provider.
//
// Only an upstream failure or a lost response can have: a 4xx means Razorpay
// read the request and declined it, and the two codes above mean it never
// read one at all.
const couldHaveCreated = (error) =>
  error instanceof PaymentError &&
  !DEFINITELY_NOT_CREATED.has(error.code) &&
  error.status >= 500;

const attemptExpiry = (from = new Date()) =>
  new Date(from.getTime() + ATTEMPT_TTL_MINUTES * 60_000);

const terminateAttempt = (id, status, failureCode = null) =>
  adminDb.checkoutAttempt
    .update({ where: { id }, data: { status, failureCode } })
    .catch(() => null);

// Closes the attempt behind a subscription once the subscription itself has
// an answer, so the one-attempt-per-user slot is freed.
//
// This is called from syncFromProvider rather than from the browser callback,
// because the callback is the path that may never run: somebody closes the
// tab the moment they have paid and the only thing that ever reports the
// activation is the webhook. Leaving the attempt CREATED in that case meant
// the account could never start another checkout -- the same lockout the
// attempt row was introduced to remove, moved one step down the flow.
//
// PENDING is left alone deliberately: the provider says `created` or
// `authenticated`, nothing has been charged, and the payment window can still
// be reopened against the same subscription.
async function closeAttemptFor(providerSubscriptionId, status) {
  if (status === SUBSCRIPTION_STATUS.PENDING) return;

  const attempt = await adminDb.checkoutAttempt.findUnique({
    where: { providerSubscriptionId },
    select: { id: true, status: true },
  });
  if (!attempt || !IN_FLIGHT_ATTEMPT_STATUSES.includes(attempt.status)) return;

  // EXPIRED means the mandate was never authorised and nothing was ever
  // charged, which is an abandoned attempt rather than a completed one.
  const expired = status === SUBSCRIPTION_STATUS.EXPIRED;
  await terminateAttempt(
    attempt.id,
    expired ? "ABANDONED" : "COMPLETED",
    expired ? "EXPIRED_UNPAID" : null
  );
}

// Did a create call that never answered actually succeed?
//
// Razorpay's subscriptions API has no idempotency key, so this is the only
// honest way to find out: look at the subscriptions created around the time
// of the attempt and see whether one of them carries this attempt's id in its
// notes. We put it there; nobody else can.
//
// Returns the orphaned subscription id, or null. A null means it is safe to
// create one -- which is the whole point, because creating one when the
// previous call did succeed charges somebody twice.
async function reconcileAttempt(attempt) {
  // A minute of slack before the attempt was written: clocks differ, and the
  // subscription is created after the row either way.
  const from = Math.floor(attempt.createdAt.getTime() / 1000) - 60;

  const items = await listSubscriptions({ from });
  const match = items.find((item) => item?.notes?.whealthos_attempt === attempt.id);
  return match?.id ?? null;
}

// Opens or resumes a checkout. Returns only what the browser needs.
//
// Duplicate protection is in three layers, because any one of them alone has
// a hole:
//
//   1. the live-subscription check, which gives a useful message;
//   2. the one-attempt-per-user partial unique index, which is what actually
//      holds when two requests race -- a double click, two tabs, or a client
//      retry after a timeout;
//   3. reconciliation against Razorpay, for the case neither of the above can
//      see: the create call succeeded and the answer was lost.
export async function startCheckout({ userId, planId, interval }) {
  const purchase = resolvePurchase(planId, interval);
  if (!purchase) {
    throw new BillingError("PLAN_UNAVAILABLE", "That plan cannot be bought right now.", 400);
  }

  const existing = await liveSubscription(userId);
  if (existing) {
    // Authorised but not yet charged. Razorpay takes the first payment on its
    // own from here, so there is nothing to reopen -- but telling somebody
    // they "already have this plan" would be a lie, because a PENDING
    // subscription grants nothing. Its own code, so the review page can say
    // what is actually happening.
    if (existing.status === SUBSCRIPTION_STATUS.PENDING) {
      throw new BillingError(
        "AWAITING_FIRST_PAYMENT",
        "This subscription is being set up. There is nothing more to pay — it will appear on your account shortly.",
        409
      );
    }
    if (existing.planId === planId && existing.interval === intervalEnum(interval)) {
      throw new BillingError(
        "ALREADY_SUBSCRIBED",
        "You already have this plan. Refresh the page to see it.",
        409
      );
    }
    throw new BillingError(
      "SUBSCRIPTION_EXISTS",
      // Named the actual route, 2026-11-10. It used to say "Change or cancel
      // it", and there is no change: requestPlanChange() below has no caller,
      // no route and no control, so the only move between paid plans is
      // cancel, wait out the paid period, subscribe again. Telling somebody to
      // do a thing the product cannot do is worse than telling them it takes
      // two steps.
      "You already have a subscription. Cancel it in Settings first — it keeps running to the end of the period you have paid for, and you can subscribe to another plan once it ends.",
      409
    );
  }

  const resumed = await resumeAttempt({ userId, planId, interval, purchase });
  if (resumed) return resumed;

  // Nothing to resume. Write the attempt first, then call Razorpay.
  let attempt;
  try {
    attempt = await adminDb.checkoutAttempt.create({
      data: {
        userId,
        planId,
        interval: purchase.intervalEnum,
        providerPlanId: purchase.providerPlanId,
        amount: purchase.amount,
        currency: purchase.currency,
        idempotencyKey: randomUUID(),
        expiresAt: attemptExpiry(),
      },
      select: selectAttempt,
    });
  } catch (error) {
    // The race the checks above cannot catch: two requests arriving together.
    // The index refused the second, which means the first is creating the
    // subscription right now. Answering 409 rather than waiting keeps this
    // request short; the browser's next attempt resumes the winner's.
    if (error?.code === "P2002") {
      throw new BillingError(
        "CHECKOUT_IN_PROGRESS",
        "A payment is already being prepared on your account. Give it a moment and try again.",
        409
      );
    }
    throw error;
  }

  let created;
  try {
    created = await createSubscription({
      providerPlanId: purchase.providerPlanId,
      totalCount: totalCountFor(interval),
      userId,
      planId,
      interval,
      attemptId: attempt.id,
    });
  } catch (error) {
    // Could this failure have left a subscription at Razorpay?
    //
    // If it could, the attempt stays OPEN so the next try reconciles and
    // adopts the orphan instead of opening a second subscription -- a timeout
    // looks exactly like a refusal from in here. If it could not, the attempt
    // is closed immediately, because leaving it open costs the next click a
    // pointless reconciliation against a provider that has nothing to find.
    if (!couldHaveCreated(error)) {
      await terminateAttempt(attempt.id, "FAILED", error?.code ?? "UPSTREAM_FAILED");
    }
    throw error;
  }

  if (!created?.id || typeof created.id !== "string" || !created.id.startsWith("sub_")) {
    // A 200 with something that is not a subscription id. Recorded as failed
    // rather than persisted: half a provider response is not a purchase.
    await terminateAttempt(attempt.id, "FAILED", "MALFORMED_RESPONSE");
    throw new BillingError("UPSTREAM_FAILED", "Could not start the subscription.", 502);
  }

  await adminDb.checkoutAttempt.update({
    where: { id: attempt.id },
    data: { status: "CREATED", providerSubscriptionId: created.id },
  });

  return {
    subscriptionId: created.id,
    planId,
    interval,
    amount: purchase.amount,
    currency: purchase.currency,
    resumed: false,
  };
}

// Whether the attempt already in flight can be used for this request.
//
// Four outcomes, and the differences between them are the whole of why this
// is not a one-liner:
//
//   expired, or for another plan  -> abandoned, and a new attempt is opened
//   never reached Razorpay        -> reconciled; the orphan is adopted if
//                                    there is one, otherwise a new call is
//                                    allowed to proceed
//   still openable at Razorpay    -> the SAME subscription id is handed back,
//                                    which is what makes a double click, a
//                                    refresh and a second tab harmless
//   already paid                  -> synced, and the caller is told they are
//                                    subscribed rather than sold it twice
async function resumeAttempt({ userId, planId, interval, purchase }) {
  const attempt = await inFlightAttempt(userId);
  if (!attempt) return null;

  const stale = attempt.expiresAt <= new Date();
  const sameThing =
    attempt.planId === planId && attempt.interval === purchase.intervalEnum;

  if (stale || !sameThing) {
    await terminateAttempt(attempt.id, "ABANDONED", stale ? "EXPIRED" : "SUPERSEDED");
    return null;
  }

  // Written, but with no subscription id yet. Two very different situations
  // wear the same shape here, and telling them apart is the whole of this
  // branch:
  //
  //   the create call is STILL RUNNING, in another request a moment ago
  //   the create call never answered, minutes or hours ago
  //
  // Reconciling the first one is a double charge. The reconciliation asks
  // Razorpay what exists, Razorpay has not finished creating it yet, the
  // answer is "nothing", and this request abandons an attempt that is about
  // to come back with a perfectly good subscription -- then opens a second
  // one of its own. Both get paid for.
  //
  // So an attempt younger than a request can plausibly take is treated as in
  // flight, and the caller is told to wait. Matched to the browser's own
  // 20-second timeout with room to spare: past this, no request that started
  // it is still waiting for an answer.
  if (!attempt.providerSubscriptionId) {
    if (Date.now() - attempt.createdAt.getTime() < CREATE_IN_FLIGHT_MS) {
      throw new BillingError(
        "CHECKOUT_IN_PROGRESS",
        "A payment is already being prepared on your account. Give it a moment and try again.",
        409
      );
    }

    const orphan = await reconcileAttempt(attempt);
    if (!orphan) {
      // Nothing was created. Free the slot so the caller can open a fresh
      // attempt -- the row has served its purpose.
      await terminateAttempt(attempt.id, "ABANDONED", "NOT_CREATED");
      return null;
    }

    console.warn({
      code: "BILLING_ORPHAN_ADOPTED",
      details: { attemptId: attempt.id, providerSubscriptionId: orphan },
    });

    await adminDb.checkoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "CREATED", providerSubscriptionId: orphan },
    });
    attempt.providerSubscriptionId = orphan;
  }

  // What does Razorpay say about it now?
  const remote = await fetchSubscription(attempt.providerSubscriptionId);
  const providerStatus = String(remote?.status ?? "").toLowerCase();

  if (REOPENABLE.has(providerStatus)) {
    return {
      subscriptionId: attempt.providerSubscriptionId,
      planId: attempt.planId,
      interval,
      amount: attempt.amount,
      currency: attempt.currency,
      // The browser does not need to know, but the tests and the logs do:
      // this is the same subscription as last time, not a second one.
      resumed: true,
    };
  }

  // It has moved on. Whatever it became, our row should say so -- and if it
  // became a paid subscription, saying "you already have this plan" is both
  // true and the only safe answer.
  const synced = await syncFromProvider(attempt.providerSubscriptionId).catch(() => null);
  await terminateAttempt(
    attempt.id,
    synced && grantsAccess(synced) ? "COMPLETED" : "ABANDONED",
    synced ? null : "PROVIDER_STATE_UNUSABLE"
  );

  if (synced && isLive(synced.status)) {
    throw new BillingError(
      "ALREADY_SUBSCRIBED",
      "That payment has already gone through. Refresh the page to see your plan.",
      409
    );
  }

  return null;
}

// --- Confirming a checkout --------------------------------------------------

// Handles the browser's success callback.
//
// This never grants anything on the browser's word. It establishes, in order:
// that Razorpay signed the pair, that the subscription is one we opened for
// THIS user, and then what Razorpay itself currently says the subscription is.
// Access follows from the last of those, not from the callback.
export async function confirmCheckout({ userId, paymentId, providerSubscriptionId, signature }) {
  if (!checkoutSignatureMatches({ paymentId, providerSubscriptionId, signature })) {
    throw new BillingError("SIGNATURE_MISMATCH", "This payment could not be verified.", 400);
  }

  // Whose subscription is it? From our own records, looked up by the provider
  // id -- never from anything in the callback. A signature proves the payment
  // is real, not that it is yours.
  //
  // Either record will do, and which one exists depends on a race nobody
  // controls: the webhook may have arrived first and created the subscription,
  // or this callback may be first and only the attempt exists.
  const [attempt, row] = await Promise.all([
    adminDb.checkoutAttempt.findUnique({
      where: { providerSubscriptionId },
      select: { id: true, userId: true },
    }),
    adminDb.subscription.findUnique({
      where: { providerSubscriptionId },
      select: { id: true, userId: true },
    }),
  ]);

  const owner = row?.userId ?? attempt?.userId ?? null;
  if (!owner || owner !== userId) {
    throw new BillingError("NOT_YOUR_SUBSCRIPTION", "This payment could not be verified.", 403);
  }

  const synced = await syncFromProvider(providerSubscriptionId);

  if (attempt) {
    await terminateAttempt(
      attempt.id,
      "COMPLETED",
      synced ? null : "PROVIDER_STATE_UNRECOGNISED"
    );
  }

  return {
    verified: true,
    planId: synced?.planId ?? null,
    status: synced?.status ?? null,
    // Said plainly rather than implied: a signed callback is not an active
    // subscription, and the screen must not celebrate before it is one.
    active: synced ? grantsAccess(synced) : false,
  };
}

// --- Keeping in step with the provider --------------------------------------

// Reads the authoritative state from Razorpay and writes it to our row,
// creating that row the first time if the checkout attempt accounts for it.
//
// Everything that changes a subscription's status goes through here, which is
// why an out-of-order or replayed webhook is harmless: the event is only ever
// a prompt to ask Razorpay, never the source of the answer. There is no
// "ignore older events" rule because there is nothing for a stale event to
// overwrite -- it causes the same question to be asked again and the same
// current answer to be written.
export async function syncFromProvider(providerSubscriptionId, { eventAt = null } = {}) {
  const remote = await fetchSubscription(providerSubscriptionId);
  if (!remote?.id) return null;

  const status = normaliseStatus(remote.status, {
    cancelAtCycleEnd: Boolean(remote.cancel_at_cycle_end),
  });

  if (!status) {
    // An undocumented state. Recorded, not guessed at: leaving the row as it
    // was is the only safe reading, because every wrong guess here either
    // takes away access somebody paid for or grants access they did not.
    console.error({
      code: "RAZORPAY_UNKNOWN_SUBSCRIPTION_STATUS",
      details: { providerSubscriptionId, status: remote.status ?? null },
    });
    return null;
  }

  const currentEnd = fromUnix(remote.current_end);
  const existing = await adminDb.subscription.findUnique({
    where: { providerSubscriptionId },
    // status and userId are read for the confirmation email: the email is
    // owed on the TRANSITION into a paid state, and sending it needs to know
    // whose subscription this is. Neither is used to decide the new state --
    // that comes from the provider, above.
    //
    // planId and interval are read for the same reason, one step later: a plan
    // change is also a transition, and the only way to recognise it is to
    // compare what the row says against what Razorpay now says.
    select: {
      id: true,
      lastEventAt: true,
      status: true,
      userId: true,
      planId: true,
      interval: true,
      // To recognise a scheduled change that has now arrived, and clear it.
      scheduledPlanId: true,
    },
  });

  // Which of OUR plans the subscription is on now, according to Razorpay.
  //
  // This is the one field whose authority is the provider rather than the
  // checkout attempt, and it is why this block exists at all. Everywhere else
  // planId comes from the attempt written before Razorpay was called -- but a
  // plan CHANGE happens entirely at Razorpay, at the end of a billing cycle,
  // with no attempt and no checkout. Before this, the row's planId was written
  // once at creation and never again: a subscription moved from Pro to
  // Intelligent would be charged the Intelligent price by Razorpay and keep
  // Pro entitlements here, forever, with nothing logged.
  //
  // `undefined` leaves the column alone, and that is the answer to both
  // "Razorpay sent no plan id" and "it sent one this deployment does not
  // recognise". Neither is a reason to guess, and a guess here changes what
  // somebody is entitled to. The unrecognised case is logged, because it means
  // the merchant account holds a Plan this deployment is not configured for.
  const remotePlan = planFromProviderPlanId(remote.plan_id ?? null);
  if (remote.plan_id && !remotePlan) {
    console.error({
      code: "RAZORPAY_UNKNOWN_PLAN_ID",
      details: { providerSubscriptionId, providerPlanId: remote.plan_id },
    });
  }

  // Deliberately NOT part of `state` below.
  //
  // `state` is spread into the create branch as well, and there the plan comes
  // from the checkout attempt -- that is the rule the create branch's own
  // comment states, and it is the stronger source: the attempt was written by
  // this application before Razorpay was called. Folding these in would also
  // have overwritten a required column with `undefined` on any subscription
  // whose plan id did not resolve. So the provider's plan is applied only
  // where it is the only available answer: an update to a row that already
  // exists.
  const remotePlanFields = remotePlan
    ? {
        planId: remotePlan.planId,
        interval: remotePlan.intervalEnum,
        providerPlanId: remote.plan_id,
      }
    : {};

  // A scheduled change that has arrived is no longer scheduled.
  //
  // Cleared only when the plan Razorpay now reports is the one that was asked
  // for. Any other reading would be wrong in a way somebody would notice:
  // clearing on every sync would wipe a pending upgrade on the next renewal
  // webhook, and never clearing it would leave "changes to Intelligent on the
  // 11th" on the screen of somebody who has been on Intelligent for a month.
  //
  // Computed against the row as it was read above, so a replayed delivery
  // finds the columns already null and writes nothing.
  const scheduleLanded =
    existing?.scheduledPlanId && remotePlan?.planId === existing.scheduledPlanId;

  const clearedSchedule = scheduleLanded
    ? { scheduledPlanId: null, scheduledInterval: null, scheduledChangeAt: null }
    : {};

  const state = {
    status,
    providerCustomerId: remote.customer_id ?? undefined,
    currentStart: fromUnix(remote.current_start),
    currentEnd,
    cancelAtPeriodEnd: Boolean(remote.cancel_at_cycle_end),
    cancelledAt: status === SUBSCRIPTION_STATUS.CANCELLED ? new Date() : undefined,
    endedAt: isLive(status) ? null : fromUnix(remote.ended_at) ?? currentEnd ?? new Date(),
  };

  if (existing) {
    const updated = await adminDb.subscription.update({
      where: { providerSubscriptionId },
      data: {
        ...state,
        ...remotePlanFields,
        ...clearedSchedule,
        // Only ever forward. The column means "the newest event applied to
        // this row", and a retry of a week-old delivery must not make it
        // claim otherwise.
        lastEventAt:
          eventAt && (!existing.lastEventAt || eventAt > existing.lastEventAt)
            ? eventAt
            : undefined,
      },
      select: selectSubscription,
    });
    await closeAttemptFor(providerSubscriptionId, status);

    // Activation is a transition, not a state: a renewal arrives as another
    // `subscription.charged` on a subscription that is already ACTIVE, and
    // must not produce a second "your subscription is confirmed" email. The
    // unique idempotency key would refuse one anyway -- this is the cheaper
    // of the two guards, and the one that explains itself.
    if (updated.status !== existing.status) {
      await queueActivationNotification({ ...updated, userId: existing.userId });
    }

    // A plan change is the other transition, and it is invisible to the test
    // above: a scheduled upgrade lands on the cycle-end charge, which arrives
    // as `subscription.charged` on a subscription that is already ACTIVE and
    // stays ACTIVE. Status does not move, so nothing above fires -- and the
    // activation notification could not be reused anyway, because its
    // idempotency key was spent when this subscription was first confirmed.
    //
    // Its own event, for its own key. Compared against the row as it was read
    // BEFORE the update, so a replayed webhook finds the two already equal and
    // queues nothing.
    if (updated.planId !== existing.planId) {
      await queuePlanChangeNotification({
        ...updated,
        userId: existing.userId,
        previousPlanId: existing.planId,
      });
    }

    return updated;
  }

  // No row yet. The attempt is what says whose this is and what they chose;
  // without one, this subscription is not ours to record.
  const attempt = await adminDb.checkoutAttempt.findUnique({
    where: { providerSubscriptionId },
    select: selectAttempt,
  });

  if (!attempt) {
    console.warn({
      code: "BILLING_UNATTRIBUTED_SUBSCRIPTION",
      details: { providerSubscriptionId },
    });
    return null;
  }

  try {
    const row = await adminDb.subscription.create({
      data: {
        userId: attempt.userId,
        // Ours, from the attempt -- never from the provider's notes, which
        // are only used to recognise an orphan. Entitlements follow this.
        planId: attempt.planId,
        interval: attempt.interval,
        providerSubscriptionId,
        providerCustomerId: remote.customer_id ?? null,
        providerPlanId: attempt.providerPlanId,
        amount: attempt.amount,
        currency: attempt.currency,
        ...state,
        lastEventAt: eventAt ?? undefined,
      },
      select: selectSubscription,
    });
    await closeAttemptFor(providerSubscriptionId, status);

    // A subscription whose first recorded state is already paid -- the usual
    // shape, since the webhook that creates the row is the one announcing the
    // charge. There is no previous status to compare against; the row itself
    // is the transition.
    await queueActivationNotification({ ...row, userId: attempt.userId });

    return row;
  } catch (error) {
    if (error?.code === "P2002") {
      // Two possibilities, both rare and both handled by doing nothing. The
      // row appeared between the read and the write -- a webhook and the
      // browser callback arriving together -- in which case it is already
      // correct. Or this person already has a live subscription and the
      // one-live-per-user index refused a second: that happens when an
      // abandoned attempt is paid after a newer one succeeded, and the
      // subscription that landed first is the one they keep.
      console.error({
        code: "BILLING_SUBSCRIPTION_NOT_RECORDED",
        details: { providerSubscriptionId, userId: attempt.userId },
      });
      return adminDb.subscription.findUnique({
        where: { providerSubscriptionId },
        select: selectSubscription,
      });
    }
    throw error;
  }
}

// --- Reconciling on demand ---------------------------------------------------

// How stale our copy may be before a status check asks Razorpay again.
//
// The confirmation page polls on a backing-off schedule, so this does not
// decide how often anybody asks -- it decides how often asking reaches the
// provider rather than the database. Five seconds means two tabs polling
// together make one upstream call, and a page left open overnight cannot
// turn into a slow denial of service against our own rate limit.
const RESYNC_AFTER_MS = 5_000;

// The summary, with one bounded provider check when something is in flight.
//
// This exists because a webhook is not guaranteed to arrive. It is the normal
// case in development -- Razorpay cannot reach localhost -- and it happens in
// production too, when a delivery is delayed, fails, or is sent to an
// endpoint whose secret has changed. Without this the confirmation page would
// poll its way through two minutes of reading an unchanging row and then
// announce that it had given up, having never once asked the only system that
// knows the answer.
//
// What it is not: a way for the browser to change anything. It re-reads
// Razorpay's own state through the same syncFromProvider every other path
// uses, and the caller is the signed-in owner, resolved from the session.
export async function refreshConfirming(userId) {
  const summary = await billingSummary(userId);
  if (!summary.confirming) return summary;

  // Whichever record names a provider subscription. A webhook-first flow has
  // only the attempt; a callback-first flow has the row.
  const row = summary.pending ?? summary.subscription ?? null;
  const providerSubscriptionId =
    row?.providerSubscriptionId ?? summary.attempt?.providerSubscriptionId ?? null;
  if (!providerSubscriptionId) return summary;

  const lastTouched = (row ?? summary.attempt)?.updatedAt ?? null;
  if (lastTouched && Date.now() - lastTouched.getTime() < RESYNC_AFTER_MS) {
    return summary;
  }

  try {
    await syncFromProvider(providerSubscriptionId);
  } catch (error) {
    // A provider that is slow or unreachable must not turn a status check
    // into an error: the page keeps polling, and the stale answer it already
    // had is still an honest one.
    console.warn({
      code: "BILLING_RESYNC_FAILED",
      details: { providerSubscriptionId },
      error: error?.code ?? error?.message ?? "unknown",
    });
    return summary;
  }

  return billingSummary(userId);
}

// --- Changing and ending ----------------------------------------------------

// Schedules a cancellation at the end of the paid period.
export async function requestCancellation(userId) {
  const live = await liveSubscription(userId);
  if (!live) {
    throw new BillingError("NO_SUBSCRIPTION", "There is no subscription to cancel.", 404);
  }
  if (live.cancelAtPeriodEnd) {
    throw new BillingError(
      "ALREADY_CANCELLING",
      "This subscription is already set to stop at the end of the period.",
      409
    );
  }

  await cancelSubscription(live.providerSubscriptionId, { atCycleEnd: true });
  // Not trusted: read the result back from Razorpay rather than assuming the
  // call did what was asked.
  const synced = await syncFromProvider(live.providerSubscriptionId);
  return synced ?? live;
}

// Moves a live subscription UP to a higher plan at the end of the current
// cycle.
//
// The effective plan does NOT change here. It changes when Razorpay says the
// new plan is running, which arrives as a webhook and is written by
// syncFromProvider -- the only function that may write a plan. Until then the
// person keeps what they are paying for, which is also what they are still
// being charged for. That is the whole of why no money moves in this function:
// there is nothing to charge for a period that has already been paid at the old
// rate, and nothing to refund either.
//
// Upgrades only, deliberately. Three things this refuses and why:
//
//   a DOWNGRADE          Pro is cheaper than Intelligent, so moving down means
//                        either giving back part of a period already paid for
//                        or charging the old rate for a cheaper plan. Both are
//                        proration decisions, and there is no proration policy
//                        published anywhere in this product -- section 6 of the
//                        Terms says so in as many words. Inventing one here
//                        would silently decide whether somebody is owed money.
//   an INTERVAL-ONLY     Monthly to yearly on the same plan is a billing-
//   change               duration change, which has the same problem from the
//                        other direction and no policy either.
//   a NON-ACTIVE         PENDING has never been charged, PAST_DUE is a
//   subscription         subscription whose last charge failed, and
//                        CANCEL_SCHEDULED has been told to stop. Changing the
//                        plan of any of them schedules a change onto a cycle
//                        that may never arrive.
//
// Each refusal is its own code so the screen can say which one it is rather
// than "that did not work".
export async function requestPlanChange({ userId, planId, interval }) {
  const purchase = resolvePurchase(planId, interval);
  if (!purchase) {
    throw new BillingError("PLAN_UNAVAILABLE", "That plan cannot be bought right now.", 400);
  }

  const live = await liveSubscription(userId);
  if (!live) {
    throw new BillingError("NO_SUBSCRIPTION", "There is no subscription to change.", 404);
  }
  if (live.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw new BillingError(
      "NOT_CHANGEABLE",
      "A subscription can only be changed while it is active.",
      409
    );
  }
  if (live.planId === planId && live.interval === purchase.intervalEnum) {
    throw new BillingError("NO_CHANGE", "That is the plan you are already on.", 409);
  }

  // The direction. Compared on the plan alone: rankOf() is the plan ladder and
  // knows nothing about billing intervals, which is correct here -- Pro yearly
  // to Intelligent monthly is still a move up the ladder.
  const from = rankOf(live.planId);
  const to = rankOf(planId);

  if (to <= from) {
    throw new BillingError(
      "NOT_AN_UPGRADE",
      to === from
        ? "Changing how often you are billed is not something this page can do. Cancel in Settings and subscribe again on the period you want."
        : "Moving to a lower plan is not something this page can do. Cancel in Settings — your subscription runs to the end of the period you have paid for — and subscribe to the other plan once it ends.",
      409
    );
  }

  await changeSubscriptionPlan(live.providerSubscriptionId, {
    providerPlanId: purchase.providerPlanId,
  });

  // Our row keeps the OLD plan until a webhook confirms the new one is in
  // force. Writing the new plan here would grant Intelligent features for the
  // rest of a month that was paid for at the Pro rate.
  //
  // What IS written is the schedule: what was asked for, on what period, and
  // when it arrives. Not providerPlanId -- that column means "the provider
  // plan this subscription is running on", and a scheduled change does not
  // move Razorpay's own plan_id, so syncFromProvider would read the old one
  // back and overwrite it on the very next webhook. These three columns exist
  // precisely so the pending change has somewhere to live that a sync will not
  // trample.
  const updated = await adminDb.subscription.update({
    where: { providerSubscriptionId: live.providerSubscriptionId },
    data: {
      scheduledPlanId: planId,
      scheduledInterval: purchase.intervalEnum,
      // currentEnd as it is NOW. Recorded rather than left to be read later,
      // because currentEnd moves forward on every renewal and this date must
      // not. Null when the provider has not told us the period end, in which
      // case the screens say "at the end of your current billing period"
      // rather than inventing a date.
      scheduledChangeAt: live.currentEnd ?? null,
    },
    select: selectSubscription,
  });

  return {
    scheduled: true,
    planId,
    interval,
    from: live.planId,
    effectiveFrom: live.currentEnd ?? null,
    subscription: updated,
  };
}

// --- What the checkout page needs -------------------------------------------

// Everything /billing renders, resolved on the server in one place.
//
// The page itself decides nothing: it is handed a `state` and renders the view
// for it. That is deliberate -- "which of these twenty situations am I in" is
// exactly the logic that gets quietly duplicated into a client component and
// then disagrees with the server about whether somebody may be charged.
export async function checkoutState({ userId, planId, interval, availability = null }) {
  // Not something we sell at all: an unknown plan, or a bad interval.
  const entry = planId && interval ? catalogEntry(planId, interval) : null;
  if (!entry) return { state: "no-selection", entry: null };

  // Sold, but this deployment cannot take the payment -- no Razorpay plan id,
  // or no credentials. A different thing from a bad URL, and said differently.
  const sellable =
    entry.enabledForSale && (availability === null || availability.ready !== false);
  if (!sellable) return { state: "unavailable", entry };

  const [live, attempt] = await Promise.all([
    liveSubscription(userId),
    inFlightAttempt(userId).catch(() => null),
  ]);

  if (live) {
    // Authorised, not yet charged. Neither "already on it" nor "ready to buy
    // it": the payment has happened and the confirmation has not.
    if (live.status === SUBSCRIPTION_STATUS.PENDING) {
      return { state: "confirming", entry, subscription: live };
    }

    const same = live.planId === planId && live.interval === entry.intervalEnum;
    if (same) return { state: "already-on-plan", entry, subscription: live };

    // An upgrade already asked for and not yet arrived. Checked before the
    // offer below, because the thing this person needs is the date, not the
    // button they have already pressed -- and pressing it again would be
    // refused by requestPlanChange anyway, after a pointless round trip to
    // Razorpay.
    if (live.scheduledPlanId) {
      return {
        state: "upgrade-scheduled",
        entry,
        subscription: live,
        // The catalogue entry for what is coming, so the screen can name its
        // price rather than only its name. Resolved server-side from the
        // stored plan and interval, never from the URL.
        scheduled: catalogEntry(
          live.scheduledPlanId,
          String(live.scheduledInterval ?? "").toLowerCase()
        ),
      };
    }

    // Can this live subscription be moved to the plan in the URL, in one step?
    //
    // Only upwards, and only from ACTIVE. The reasoning is requestPlanChange's
    // and is not repeated here -- what matters is that this page and that
    // function agree, so a screen never offers a move the service will refuse.
    const upgradable =
      live.status === SUBSCRIPTION_STATUS.ACTIVE && rankOf(planId) > rankOf(live.planId);

    return {
      state: upgradable ? "upgrade" : "other-plan",
      entry,
      subscription: live,
      // What the upgrade costs and when it starts, for the review screen.
      // effectiveFrom is the end of the period already paid for: nothing is
      // charged before it and nothing changes before it.
      ...(upgradable
        ? {
            upgrade: {
              from: live.planId,
              fromInterval: live.interval,
              effectiveFrom: live.currentEnd ?? null,
            },
          }
        : {}),
    };
  }

  const resumable =
    attempt && attempt.status === "CREATED" && attempt.expiresAt > new Date();

  return {
    state: "ready",
    entry,
    // Shown as "you started this a moment ago", so a second visit does not
    // look like a second charge waiting to happen.
    attempt: resumable ? { planId: attempt.planId, interval: attempt.interval } : null,
  };
}

export { PaymentError, LIVE_STATUSES, grantsAccess, ATTEMPT_TTL_MINUTES };
