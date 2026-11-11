import { inngest } from "@/lib/inngest/client";
import { adminDb } from "@/lib/prisma";
import {
  NOTIFICATION_EVENT,
  NOTIFICATION_STATUS,
  markSkipped,
  recordOwed,
} from "./outbox";
import { CONFIRMABLE_STATUSES, isConfirmable } from "./subscription-email";

// Turning "this subscription is now active" into "an email is owed".
//
// Where this is called from matters more than what it does. It is called from
// lib/billing/service.js syncFromProvider -- the ONE function that writes a
// subscription's status, and which only ever writes what Razorpay said when
// asked directly. So every condition §1 of the brief requires is already true
// before this runs:
//
//   payment verified          the webhook route checked the HMAC over the raw
//                             body; the browser callback checked the checkout
//                             signature. Neither reaches here otherwise.
//   attributed to a user      the subscription row's userId comes from the
//                             checkout attempt written before Razorpay was
//                             called, never from the callback.
//   plan validated            the row's planId likewise, and the email
//                             refuses a plan this deployment does not sell.
//   subscription activated    the status was just written from the provider's
//                             own current state.
//   entitlement established   resolved from that planId by the same engine
//                             the authorisation layer uses.
//
// There is deliberately no other entry point. A frontend redirect cannot
// reach this: /api/billing/verify goes through confirmCheckout, which verifies
// the signature and then asks Razorpay -- the redirect's own parameters are
// never the source of the state that triggers the email.

export const ACTIVATION_SUBJECT_EVENT = "subscription.confirmation.send";

/**
 * Records that a confirmation email is owed, and asks the job runner to send
 * it. Safe to call on every sync: the unique idempotency key means the second
 * and subsequent calls do nothing.
 *
 * Never throws. An activated subscription is a completed purchase, and a
 * notification problem must not turn it into a failed one -- so every failure
 * here is logged and swallowed, and the reconciling sweep is what recovers it.
 */
export async function queueActivationNotification(subscription) {
  try {
    if (!isConfirmable(subscription)) {
      return { queued: false, reason: "not-confirmable" };
    }

    // The recipient, resolved from the account rather than from anything the
    // caller holds. §7: never an address supplied by a request.
    const user = await adminDb.user.findUnique({
      where: { id: subscription.userId },
      select: { email: true },
    });

    const { notification, created } = await recordOwed({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      event: NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED,
      recipientEmail: user?.email ?? null,
    });

    if (!created) {
      // Already recorded. This is the normal outcome of the second webhook
      // delivery, of the browser callback arriving after the webhook, and of
      // every subsequent status poll.
      return { queued: false, reason: "already-recorded", id: notification?.id ?? null };
    }

    // No address on the account: terminal and not a failure. Marked now so
    // the sweep does not pick it up for the rest of time.
    if (!user?.email) {
      await markSkipped(notification.id, "account has no email address");
      return { queued: false, reason: "no-email-address", id: notification.id };
    }

    await inngest.send({
      name: ACTIVATION_SUBJECT_EVENT,
      data: { notificationId: notification.id },
    });

    return { queued: true, id: notification.id };
  } catch (error) {
    // Deliberately not rethrown. The subscription is active and paid for;
    // losing the email is a smaller failure than failing the activation, and
    // the row (or the sweep) is what makes it recoverable rather than lost.
    console.error({
      code: "SUBSCRIPTION_NOTIFICATION_NOT_QUEUED",
      details: {
        subscriptionId: subscription?.id ?? null,
        errorType: error?.name ?? "exception",
        message: error?.message ?? null,
      },
    });
    return { queued: false, reason: "error" };
  }
}

/**
 * Records that a plan-change email is owed, and asks the job runner to send it.
 *
 * Called from the same place and under the same guarantees as
 * queueActivationNotification above -- syncFromProvider, after Razorpay has
 * been asked directly what the subscription is now on. The caller compares the
 * plan it read BEFORE the write against the plan it wrote, so a replayed
 * webhook finds them equal and never reaches here.
 *
 * `previousPlanId` is used for the log line and for nothing else. It is
 * deliberately NOT put in the email: once the row is updated the old plan is
 * gone from the database, and an email that names it would be naming something
 * reconstructed from an argument rather than read back from a record -- which
 * is the one thing lib/notifications/subscription-email.js exists to prevent.
 * Everything the email does say is read from the row after the change landed.
 *
 * Never throws, for the same reason: a subscription that has moved to a new
 * plan has moved, and a notification problem must not turn that into a failure.
 */
export async function queuePlanChangeNotification(subscription) {
  try {
    if (!isConfirmable(subscription)) {
      return { queued: false, reason: "not-confirmable" };
    }

    const user = await adminDb.user.findUnique({
      where: { id: subscription.userId },
      select: { email: true },
    });

    const { notification, created } = await recordOwed({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      event: NOTIFICATION_EVENT.SUBSCRIPTION_PLAN_CHANGED,
      recipientEmail: user?.email ?? null,
      // The plan now in force. Two deliveries of the same change compute the
      // same key and the second loses; a later, different change gets its own.
      discriminator: subscription.planId ?? null,
    });

    if (!created) {
      return { queued: false, reason: "already-recorded", id: notification?.id ?? null };
    }

    if (!user?.email) {
      await markSkipped(notification.id, "account has no email address");
      return { queued: false, reason: "no-email-address", id: notification.id };
    }

    await inngest.send({
      // The same Inngest event as an activation. The payload is a notification
      // id and nothing else, and the row itself says which kind it is, so one
      // job function serves both -- which is also what makes the stale-queued
      // sweep work for this event without a second sweep.
      name: ACTIVATION_SUBJECT_EVENT,
      data: { notificationId: notification.id },
    });

    return { queued: true, id: notification.id };
  } catch (error) {
    console.error({
      code: "SUBSCRIPTION_PLAN_CHANGE_NOTIFICATION_NOT_QUEUED",
      details: {
        subscriptionId: subscription?.id ?? null,
        from: subscription?.previousPlanId ?? null,
        to: subscription?.planId ?? null,
        errorType: error?.name ?? "exception",
        message: error?.message ?? null,
      },
    });
    return { queued: false, reason: "error" };
  }
}

// How far back the reconciling sweep looks.
//
// Bounded so the query stays an index scan over recent rows rather than a
// walk of every subscription ever sold. Seven days is far longer than any
// outage this is meant to survive, and the migration's backfill means there
// is no historical backlog for it to find.
const SWEEP_WINDOW_DAYS = 7;

/**
 * Subscriptions that grant access and have no notification row at all.
 *
 * This is the half of the outbox that recovers a crash BEFORE anything was
 * written -- the window between Razorpay's state being saved and the
 * notification being recorded. Without it, a process killed in that window
 * loses the email with no trace that one was ever owed.
 *
 * `notifications: { none: ... }` is the whole mechanism, and it is why the
 * migration backfills a SKIPPED row for every already-live subscription: on a
 * deployment with existing subscribers the first sweep would otherwise
 * announce to all of them that their subscription is now active.
 */
export const subscriptionsMissingNotification = (limit = 50, now = new Date()) =>
  adminDb.subscription.findMany({
    where: {
      status: { in: CONFIRMABLE_STATUSES },
      createdAt: { gte: new Date(now.getTime() - SWEEP_WINDOW_DAYS * 86_400_000) },
      notifications: {
        none: { event: NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      status: true,
      currentEnd: true,
      cancelAtPeriodEnd: true,
    },
  });

/**
 * Notifications that were recorded but never handed to a provider.
 *
 * The other recovery path: the row exists, so something meant to send it and
 * did not -- the job runner was unreachable, the process died between the
 * insert and the send, or a transient provider failure left it QUEUED.
 */
export const staleQueued = (limit = 50, now = new Date(), olderThanMs = 10 * 60_000) =>
  adminDb.subscriptionNotification.findMany({
    where: {
      // Both events, because both are delivered by the same job through the
      // same Inngest event. Left as activation-only, a plan-change
      // notification whose `inngest.send` never landed would sit QUEUED for
      // ever with no sweep looking for it.
      event: {
        in: [
          NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED,
          NOTIFICATION_EVENT.SUBSCRIPTION_PLAN_CHANGED,
        ],
      },
      status: NOTIFICATION_STATUS.QUEUED,
      queuedAt: { lte: new Date(now.getTime() - olderThanMs) },
    },
    orderBy: { queuedAt: "asc" },
    take: limit,
    select: { id: true, subscriptionId: true, attempts: true },
  });
