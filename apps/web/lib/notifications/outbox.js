import { adminDb } from "@/lib/prisma";

// The notification outbox: what email is owed, what has been handed over, and
// what the provider said happened to it.
//
// Deliberately knows nothing about subscriptions, Razorpay, Resend or React.
// It records intentions and outcomes. That is what makes the next notification
// event -- a renewal, a failed payment, a cancellation -- a new enum member
// and a new template rather than a second notification system, which §18 of
// the brief forbids and which is how a codebase ends up sending two different
// "your subscription is active" emails from two different places.
//
// Everything here runs as the job runner (adminDb). The row-level security on
// the table only lets that role write, so a signed-in request cannot create a
// notification for itself or for anybody else.

export const NOTIFICATION_EVENT = {
  SUBSCRIPTION_ACTIVATED: "SUBSCRIPTION_ACTIVATED",
};

export const NOTIFICATION_STATUS = {
  QUEUED: "QUEUED",
  ACCEPTED: "ACCEPTED",
  DELIVERED: "DELIVERED",
  DELAYED: "DELAYED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
};

// The exactly-once key.
//
// One activation of one subscription is one email, for the life of that
// subscription row. A renewal does not produce a second: it does not change
// the subscription's status, so nothing re-queues, and if something did the
// key would already be taken.
export const idempotencyKeyFor = (subscriptionId, event) =>
  `${subscriptionId}:${event}`;

// How far along a status is.
//
// Provider webhooks arrive out of order and are retried for days, so a status
// is only ever allowed to move forward. Without this a `delivery_delayed`
// redelivered after `delivered` would walk the row backwards and the audit
// trail would say a message that arrived is still in flight.
//
// A complaint outranks a delivery because it necessarily follows one: somebody
// has to receive a message to mark it as spam.
const RANK = {
  QUEUED: 0,
  ACCEPTED: 1,
  DELAYED: 2,
  DELIVERED: 3,
  BOUNCED: 3,
  FAILED: 3,
  SKIPPED: 3,
  COMPLAINED: 4,
};

export const advancesTo = (from, to) => (RANK[to] ?? -1) > (RANK[from] ?? -1);

// A short reason, length-capped. Never a provider payload, never a body, never
// a credential -- this column is read in logs and in a support conversation.
const MAX_ERROR = 300;
const reasonOf = (value) => {
  if (!value) return null;
  const text = String(value);
  return text.length > MAX_ERROR ? `${text.slice(0, MAX_ERROR)}…` : text;
};

/**
 * Records that an email is owed, exactly once.
 *
 * The insert IS the lock. Two concurrent callers -- a Razorpay webhook and the
 * browser callback landing together, which is the normal case rather than the
 * rare one -- both compute the same key and exactly one insert survives. The
 * loser is told `created: false` and does nothing, which is the success path
 * and not an error.
 */
export async function recordOwed({ userId, subscriptionId, event, recipientEmail = null }) {
  const idempotencyKey = idempotencyKeyFor(subscriptionId, event);
  try {
    const notification = await adminDb.subscriptionNotification.create({
      data: {
        userId,
        subscriptionId,
        event,
        idempotencyKey,
        recipientEmail,
        status: NOTIFICATION_STATUS.QUEUED,
      },
      select: SELECT,
    });
    return { notification, created: true };
  } catch (error) {
    if (error?.code === "P2002") {
      const existing = await adminDb.subscriptionNotification.findUnique({
        where: { idempotencyKey },
        select: SELECT,
      });
      return { notification: existing, created: false };
    }
    throw error;
  }
}

const SELECT = {
  id: true,
  userId: true,
  subscriptionId: true,
  event: true,
  status: true,
  recipientEmail: true,
  providerMessageId: true,
  attempts: true,
  queuedAt: true,
};

export const findById = (id) =>
  adminDb.subscriptionNotification.findUnique({ where: { id }, select: SELECT });

// Claims a notification for a send attempt.
//
// Increments the attempt counter before the provider is called, not after, so
// a send that crashes the process still counts. An attempt that is invisible
// because it died is exactly the one worth seeing.
//
// Only a QUEUED row can be claimed. FAILED is terminal on purpose: a
// notification that has exhausted its retries stays put until somebody looks
// at it, because the usual cause is an address that will never accept mail
// and retrying it forever is how a sender's reputation is destroyed.
export async function beginAttempt(id) {
  const updated = await adminDb.subscriptionNotification.updateMany({
    where: { id, status: NOTIFICATION_STATUS.QUEUED },
    data: { attempts: { increment: 1 }, lastError: null },
  });
  // Zero means somebody else has it, or it is already finished. Not an error.
  return updated.count === 1;
}

/**
 * The provider accepted the message and gave us an id.
 *
 * ACCEPTED, not SENT. The provider has taken responsibility for delivery and
 * nothing more is known yet; `DELIVERED` is a separate fact that arrives, or
 * fails to arrive, through the provider's own webhook.
 */
export const markAccepted = (id, providerMessageId) =>
  adminDb.subscriptionNotification.update({
    where: { id },
    data: {
      status: NOTIFICATION_STATUS.ACCEPTED,
      providerMessageId: providerMessageId ?? null,
      acceptedAt: new Date(),
      lastError: null,
    },
    select: SELECT,
  });

/**
 * This attempt failed.
 *
 * `terminal` decides whether it stays retryable. A transient failure is left
 * QUEUED with the reason recorded, so the sweep and the job runner both pick
 * it up again; an exhausted or refused one is FAILED, which is terminal and
 * is what an operator should be able to list.
 */
export const markFailed = (id, reason, { terminal = false } = {}) =>
  adminDb.subscriptionNotification.update({
    where: { id },
    data: {
      status: terminal ? NOTIFICATION_STATUS.FAILED : NOTIFICATION_STATUS.QUEUED,
      lastError: reasonOf(reason),
      ...(terminal ? { failedAt: new Date() } : {}),
    },
    select: SELECT,
  });

// Never going to be sent, on purpose. Terminal, and distinguishable from a
// failure: nobody should be paged because an account has no email address.
export const markSkipped = (id, reason) =>
  adminDb.subscriptionNotification.update({
    where: { id },
    data: {
      status: NOTIFICATION_STATUS.SKIPPED,
      lastError: reasonOf(reason),
      failedAt: new Date(),
    },
    select: SELECT,
  });

/**
 * Applies what the email provider says happened to a message.
 *
 * Found by the provider's own message id, which is the only identifier a
 * delivery webhook carries -- it says nothing about users or subscriptions,
 * and must not be allowed to. A webhook for a message this table does not
 * know is not an error: every other email WHealthOS sends produces the same
 * events.
 *
 * Returns what was done, so the endpoint can answer honestly without
 * inventing a reason.
 */
export async function applyDeliveryEvent({ providerMessageId, status, at = new Date() }) {
  // RANK.QUEUED is 0, so this tests for presence rather than truthiness --
  // `!RANK[status]` would reject the first member of the enum.
  if (!providerMessageId || RANK[status] === undefined) {
    return { matched: false, reason: "unusable" };
  }

  const existing = await adminDb.subscriptionNotification.findUnique({
    where: { providerMessageId },
    select: { id: true, status: true },
  });
  if (!existing) return { matched: false, reason: "not-a-subscription-notification" };

  if (!advancesTo(existing.status, status)) {
    return { matched: true, applied: false, reason: "out-of-order", from: existing.status };
  }

  await adminDb.subscriptionNotification.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === NOTIFICATION_STATUS.DELIVERED ? { deliveredAt: at } : {}),
      ...(status === NOTIFICATION_STATUS.BOUNCED ||
      status === NOTIFICATION_STATUS.COMPLAINED
        ? { failedAt: at }
        : {}),
    },
  });

  return { matched: true, applied: true, from: existing.status, to: status };
}

// Notifications still owed. Ordered oldest first so a backlog drains in the
// order it accumulated rather than newest-first.
export const owed = (limit = 50) =>
  adminDb.subscriptionNotification.findMany({
    where: { status: NOTIFICATION_STATUS.QUEUED },
    orderBy: { queuedAt: "asc" },
    take: limit,
    select: SELECT,
  });
