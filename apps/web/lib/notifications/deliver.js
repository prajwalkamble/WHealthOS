import SubscriptionConfirmationEmail from "@/emails/subscription-confirmation";
import { sendEmail } from "@/lib/email/send";
import { adminDb } from "@/lib/prisma";
import {
  NOTIFICATION_STATUS,
  beginAttempt,
  findById,
  markAccepted,
  markFailed,
  markSkipped,
} from "./outbox";
import {
  activationModel,
  activationText,
  kindForEvent,
  subjectFor,
} from "./subscription-email";

// Sending one notification.
//
// Separated from the trigger on purpose. lib/notifications/subscription-
// activated.js runs inside the webhook and the checkout callback, where the
// only acceptable amount of work is a single insert; this runs in the job
// runner, where an attempt may take seconds and fail. Nothing in this file is
// reachable from a request path, which is also why the billing service does
// not pull React and the Resend client into the webhook's module graph.

// How many times a notification is attempted before it is left FAILED for a
// person to look at.
//
// Five, with Inngest's exponential backoff between them, spans several hours
// -- long enough to ride out a provider outage. Beyond that the cause is
// almost never transient, and a sender that retries forever against an
// address that will never accept mail is a sender that gets blocked.
export const MAX_ATTEMPTS = 5;

// Which failures retrying cannot fix.
//
// The distinction matters in both directions. Retrying a malformed address
// five times achieves nothing and delays the FAILED row somebody has to see;
// NOT retrying a provider outage throws away a paying subscriber's
// confirmation over a condition that cleared in a minute.
//
// sendEmail's own reasons first. A missing API key or an unconfigured sender
// is a deployment that was not finished: the same attempt in an hour fails
// identically.
const PERMANENT_REASONS = new Set([
  "api-key-missing",
  "sender-not-configured",
  "no-recipient",
  "no-body",
]);

// Then Resend's own error names, for the ones that describe the message or
// the credentials rather than a passing condition. `application_error`,
// `internal_server_error`, `rate_limit_exceeded` and anything unrecognised
// are deliberately NOT here: those are exactly what §6 of the brief means by
// "the email provider is temporarily unavailable".
const PERMANENT_PROVIDER_ERRORS = new Set([
  "validation_error",
  "invalid_parameter",
  "missing_required_field",
  "invalid_from_address",
  "invalid_to_address",
  "invalid_attachment",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "not_found",
]);

// Unknown reasons are treated as transient. The cost of being wrong that way
// is MAX_ATTEMPTS attempts and then a FAILED row -- the same end state, a few
// hours later. The cost of being wrong the other way is a lost confirmation
// for a subscription somebody paid for.
// Exported so the feedback notification shares this judgement rather than
// keeping a second copy of it. The list above is the expensive part -- knowing
// which of Resend's error names will never succeed on a retry -- and two
// copies of it would drift the moment one was updated.
export const isPermanentFailure = (result) =>
  PERMANENT_REASONS.has(result.reason) ||
  PERMANENT_PROVIDER_ERRORS.has(result.error?.name ?? "");

const isPermanent = isPermanentFailure;

/**
 * Delivers one subscription notification, or explains why it did not.
 *
 * Idempotent in both directions. A second call after a successful send finds
 * the row ACCEPTED and does nothing; two concurrent calls race on
 * beginAttempt and exactly one proceeds. That matters because Inngest can run
 * a step twice, and an email is not something to send twice.
 *
 * Throws only to ask for a retry. Everything terminal is recorded and
 * returned, because a job that throws on "this account has no email address"
 * retries four more times and then reports a failure nobody can act on.
 */
export async function deliverActivation(notificationId) {
  const notification = await findById(notificationId);
  if (!notification) return { sent: false, reason: "notification no longer exists" };

  if (notification.status !== NOTIFICATION_STATUS.QUEUED) {
    // Already accepted, already failed terminally, or deliberately skipped.
    return { sent: false, reason: `already ${notification.status}` };
  }

  if (!(await beginAttempt(notification.id))) {
    return { sent: false, reason: "claimed by another attempt" };
  }

  // Rebuilt from the database at send time, not carried in the event payload.
  // The subscription may have been cancelled, the account deleted or the
  // email address changed between activation and this attempt, and the email
  // must describe what is true now.
  // Which letter this row is for. The event is read from the row rather than
  // carried in the job payload, so a replayed or re-swept Inngest event cannot
  // send the wrong one.
  const kind = kindForEvent(notification.event);

  const built = await activationModel(notification.subscriptionId, { kind });
  if (built.skip) {
    await markSkipped(notification.id, built.skip);
    return { sent: false, reason: built.skip };
  }

  // The address as the account holds it now. Recorded even when it has
  // changed since the row was written, so the audit trail says where the
  // message actually went rather than where it was going to go.
  if (built.recipient !== notification.recipientEmail) {
    await adminDb.subscriptionNotification.update({
      where: { id: notification.id },
      data: { recipientEmail: built.recipient },
    });
  }

  const result = await sendEmail({
    type: "subscription-confirmation",
    to: built.recipient,
    subject: subjectFor(kind),
    react: SubscriptionConfirmationEmail({ model: built.model }),
    // Both parts, from the same model. A transactional email with no text
    // alternative scores worse with spam filters and is unreadable in a
    // text-only client.
    text: activationText(built.model),
  });

  if (result.success) {
    await markAccepted(notification.id, result.id);
    // "accepted", not "sent": Resend has taken the message. Whether it
    // arrived is a separate fact that its webhook reports, and
    // app/api/webhooks/resend/route.js is what records it.
    return { sent: true, accepted: true, providerMessageId: result.id ?? null };
  }

  const attempts = (notification.attempts ?? 0) + 1;
  const terminal = isPermanent(result) || attempts >= MAX_ATTEMPTS;
  await markFailed(notification.id, result.reason ?? "unknown", { terminal });

  if (terminal) {
    console.error({
      code: "SUBSCRIPTION_NOTIFICATION_FAILED",
      details: {
        notificationId: notification.id,
        reason: result.reason,
        providerError: result.error?.name ?? null,
        attempts,
      },
    });
    return { sent: false, reason: result.reason ?? "unknown", terminal: true };
  }

  // Thrown so the job runner retries with its own backoff. The row is back to
  // QUEUED, so the sweep would also recover it if the runner never did.
  throw new Error(
    `Subscription confirmation ${notification.id} failed: ${result.reason ?? "unknown"}`
  );
}
