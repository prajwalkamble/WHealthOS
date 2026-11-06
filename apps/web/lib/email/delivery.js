import { NOTIFICATION_STATUS, applyDeliveryEvent } from "@/lib/notifications/outbox";

// What the email provider says happened to a message after it accepted it.
//
// This is the half of "did the email work" that an API response cannot tell
// you. lib/email/send.js returns success when Resend accepts a message, and
// says so in its own comment: an id is not proof of delivery. These events
// are the proof, or the opposite.
//
// Deliberately not tracked: email.opened and email.clicked. Both require a
// tracking pixel or a rewritten link, both are personal data about when
// somebody read their mail, and neither says anything about delivery. They
// are recognised below only so the endpoint can acknowledge them rather than
// log them as unknown.

// Resend's event names, mapped onto notification states.
const DELIVERY_EVENTS = {
  // Resend accepted and dispatched it. Normally already recorded by the send
  // itself; harmless to receive, and it carries no new fact.
  "email.sent": NOTIFICATION_STATUS.ACCEPTED,
  "email.delivered": NOTIFICATION_STATUS.DELIVERED,
  "email.delivery_delayed": NOTIFICATION_STATUS.DELAYED,
  "email.bounced": NOTIFICATION_STATUS.BOUNCED,
  "email.complained": NOTIFICATION_STATUS.COMPLAINED,
  "email.failed": NOTIFICATION_STATUS.FAILED,
};

const IGNORED_EVENTS = new Set(["email.opened", "email.clicked"]);

export const isDeliveryEvent = (type) =>
  Object.hasOwn(DELIVERY_EVENTS, type) || IGNORED_EVENTS.has(type);

// Resend has used both spellings for the identifier it returns from the send
// API. Read tolerantly, like parseInboundEvent: an unrecognised shape is left
// null rather than guessed at.
const messageIdOf = (data) =>
  data?.email_id ?? data?.emailId ?? data?.id ?? null;

const timestampOf = (event) => {
  const raw = event?.created_at ?? event?.data?.created_at ?? null;
  if (!raw) return new Date();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

/**
 * Records a delivery outcome against the notification it belongs to.
 *
 * Most of these events are about mail this does not track -- the budget
 * alert, the monthly report, a forwarded support message -- so "no matching
 * notification" is the common case and not a failure. Returns what happened
 * so the endpoint can answer without inventing a reason.
 */
export async function recordDeliveryEvent(event) {
  const type = typeof event?.type === "string" ? event.type : null;
  if (!type) return { handled: false, reason: "no event type" };

  if (IGNORED_EVENTS.has(type)) return { handled: true, ignored: type };

  const status = DELIVERY_EVENTS[type];
  if (!status) return { handled: false, reason: "not a delivery event" };

  const providerMessageId = messageIdOf(event.data);
  if (!providerMessageId) return { handled: true, ignored: "no message id" };

  const result = await applyDeliveryEvent({
    providerMessageId,
    status,
    at: timestampOf(event),
  });

  // A bounce or a complaint about a transactional email is worth a log line:
  // it means a paying subscriber did not get their confirmation, and nothing
  // else in the system would say so.
  if (
    result.applied &&
    (status === NOTIFICATION_STATUS.BOUNCED ||
      status === NOTIFICATION_STATUS.COMPLAINED ||
      status === NOTIFICATION_STATUS.FAILED)
  ) {
    console.error({
      code: "SUBSCRIPTION_NOTIFICATION_NOT_DELIVERED",
      details: { status, from: result.from },
    });
  }

  return { handled: true, ...result };
}
