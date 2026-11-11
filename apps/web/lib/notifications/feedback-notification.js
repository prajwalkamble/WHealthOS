import { adminDb } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { inbox } from "@/lib/email/config";
import FeedbackEmail from "@/emails/feedback";
import { FEEDBACK_TYPES, headerSafe } from "@/app/lib/schema";
import { NOTIFICATION_STATUS, advancesTo } from "./outbox";
import { MAX_ATTEMPTS, isPermanentFailure } from "./deliver";

// In-app feedback: recording it, and the email owed for it.
//
// The order is the whole point. Feedback used to be an email and nothing else
// -- actions/feedback.js handed it to Resend inside the request and kept no
// record -- so a provider outage destroyed the submission and the person was
// told to try again. The row is now written first, and the notification is
// something owed against a record that already exists.
//
// Everything here runs as the job runner (adminDb). The row-level security on
// `feedback` only lets that role write, so a signed-in request cannot invent
// feedback, alter somebody else's, or mark its own notification delivered. The
// owner comes from the verified session, resolved by the caller, and is never
// read from a payload.

// The Inngest event that asks for the email to be sent.
export const FEEDBACK_SUBJECT_EVENT = "feedback.notification.send";

// The database enum for the schema's lowercase type.
export const feedbackTypeEnum = (type) => String(type ?? "").toUpperCase();

// How long an identical message from the same account is treated as a repeat.
//
// Two minutes, matching actions/contact.js, which established the behaviour
// and the reasoning: the disabled submit button covers the double click, and
// this covers the rest -- a retry after a timeout, a resubmitted page, two
// tabs, two devices.
//
// Unlike that one, this check is a query rather than an in-memory Map. The
// contact form's comment explains why it settled for memory: "the alternative
// is a database table of other people's messages". Feedback now HAS that
// table, so the window holds across instances and across a restart, which is
// the half the in-memory version cannot do.
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Writes feedback down, or recognises it as one already written.
 *
 * Takes the tenant transaction, not adminDb, and that is the point: the
 * `feedback_insert` policy allows a row only where "userId" matches the
 * current tenant, so the database refuses feedback attributed to anybody else.
 * The action resolves the right id from the verified session -- this is the
 * guarantee that still holds if it ever stopped.
 *
 * Returns { feedback, created }. `created: false` is a duplicate inside the
 * window, and the caller answers it as a success -- because from the sender's
 * point of view it was sent, and an error would only invite a third attempt.
 */
export async function recordFeedback({ tx, userId, type, message, now = new Date() }) {
  const client = tx ?? adminDb;

  const existing = await client.feedback.findFirst({
    where: {
      userId,
      type: feedbackTypeEnum(type),
      message,
      createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, status: true },
  });

  if (existing) return { feedback: existing, created: false };

  const feedback = await client.feedback.create({
    data: {
      userId,
      type: feedbackTypeEnum(type),
      message,
      status: NOTIFICATION_STATUS.QUEUED,
    },
    select: { id: true, type: true, status: true },
  });

  return { feedback, created: true };
}

// Claims a row for one delivery attempt.
//
// updateMany with the status in the WHERE is a compare-and-set: two concurrent
// attempts both issue it, Postgres serialises them, and the second updates no
// rows and is told so. Inngest can run a step twice, and an email is not
// something to send twice.
async function claim(id) {
  const { count } = await adminDb.feedback.updateMany({
    where: { id, status: NOTIFICATION_STATUS.QUEUED },
    data: { attempts: { increment: 1 } },
  });
  return count === 1;
}

const markTerminal = (id, status, reason, at = new Date()) =>
  adminDb.feedback.update({
    where: { id },
    data: { status, lastError: reason ? String(reason).slice(0, 300) : null, failedAt: at },
  });

/**
 * Sends the notification for one feedback row, or explains why it did not.
 *
 * Rebuilt from the database at send time rather than carried in the event
 * payload: the account may have been deleted or its address changed between
 * submission and this attempt, and the email must describe what is true now.
 *
 * Throws only to ask for a retry. Everything terminal is recorded and
 * returned -- a job that throws on "the recipient is not configured" retries
 * four more times and then reports a failure nobody can act on.
 */
export async function deliverFeedback(feedbackId) {
  const row = await adminDb.feedback.findUnique({
    where: { id: feedbackId },
    select: {
      id: true,
      type: true,
      message: true,
      status: true,
      attempts: true,
      createdAt: true,
      // The author, read back from the account rather than from the payload
      // that created the row.
      user: { select: { name: true, email: true } },
    },
  });

  if (!row) return { sent: false, reason: "feedback no longer exists" };
  if (row.status !== NOTIFICATION_STATUS.QUEUED) {
    return { sent: false, reason: `already ${row.status}` };
  }

  // The official inbox, from the environment, read at call time. Never a
  // value from a request, and never a second recipient: there is exactly one
  // destination for feedback and it is configuration.
  const to = inbox();
  if (!to) {
    await markTerminal(row.id, NOTIFICATION_STATUS.FAILED, "recipient not configured");
    console.error(
      "FEEDBACK_EMAIL is not set, so feedback cannot be delivered. The " +
        "feedback itself is saved; set the variable and re-run the sweep."
    );
    return { sent: false, reason: "recipient-not-configured" };
  }

  if (!(await claim(row.id))) {
    return { sent: false, reason: "claimed by another attempt" };
  }

  const label = FEEDBACK_TYPES[String(row.type).toLowerCase()] ?? "Feedback";
  const from = row.user?.name || "A WHealthOS user";
  const replyTo = row.user?.email ?? null;

  const result = await sendEmail({
    type: "feedback",
    to,
    // headerSafe, because this interpolates a display name the user sets
    // themselves. A carriage return in one ends the Subject header and begins
    // another, which is how a name becomes a way to add recipients to
    // somebody else's mail. app/lib/schema.js has applied this to the contact
    // form's subject since that form existed; this path was missed.
    subject: headerSafe(`[WHealthOS] ${label} from ${from}`),
    react: FeedbackEmail({
      label,
      message: row.message,
      from,
      replyTo,
      feedbackId: row.id,
      submittedAt: row.createdAt,
    }),
    // A real header, so replying reaches whoever wrote in. The address comes
    // from the account, never from the submitted payload.
    ...(replyTo ? { replyTo } : {}),
  });

  if (result.success) {
    await adminDb.feedback.update({
      where: { id: row.id },
      data: {
        status: NOTIFICATION_STATUS.ACCEPTED,
        providerMessageId: result.id ?? null,
        acceptedAt: new Date(),
        lastError: null,
      },
    });
    // "accepted", not "sent": Resend has taken the message. Whether it arrived
    // is a separate fact its webhook reports.
    return { sent: true, accepted: true, providerMessageId: result.id ?? null };
  }

  const attempts = (row.attempts ?? 0) + 1;
  const terminal = isPermanentFailure(result) || attempts >= MAX_ATTEMPTS;

  if (terminal) {
    await markTerminal(row.id, NOTIFICATION_STATUS.FAILED, result.reason);
    console.error({
      code: "FEEDBACK_NOTIFICATION_FAILED",
      details: { feedbackId: row.id, reason: result.reason, attempts },
    });
    return { sent: false, reason: result.reason, terminal: true };
  }

  // Left QUEUED so the retry and the sweep can both find it. The reason is
  // recorded without moving the status, because the row is still owed.
  await adminDb.feedback.update({
    where: { id: row.id },
    data: { lastError: String(result.reason ?? "unknown").slice(0, 300) },
  });

  // Thrown, which is how Inngest is asked to back off and try again.
  throw new Error(`feedback notification not sent: ${result.reason}`);
}

// How far back the sweep looks. Bounded so the query stays a scan over recent
// rows rather than a walk of every piece of feedback ever submitted.
const SWEEP_WINDOW_DAYS = 7;

/**
 * Feedback still owed an email, where the ordinary path did not deliver it.
 *
 * This is what makes the feature reliable rather than usually-correct: the
 * action's `inngest.send` can fail, the process can be killed between the
 * insert and the send, and a transient provider failure leaves the row QUEUED.
 * None of those lose the feedback now, and this is what picks it up.
 */
export const staleFeedback = (limit = 50, now = new Date(), olderThanMs = 10 * 60_000) =>
  adminDb.feedback.findMany({
    where: {
      status: NOTIFICATION_STATUS.QUEUED,
      queuedAt: {
        lte: new Date(now.getTime() - olderThanMs),
        gte: new Date(now.getTime() - SWEEP_WINDOW_DAYS * 86_400_000),
      },
    },
    orderBy: { queuedAt: "asc" },
    take: limit,
    select: { id: true, attempts: true },
  });

/**
 * Records a delivery outcome from Resend against the feedback it belongs to.
 *
 * Called only when no subscription notification matched the message id, so
 * this is the second place a delivery event may land rather than a competing
 * one. Status only ever moves forward, by the same rule the outbox applies:
 * a delayed event redelivered after a delivered one must not walk the row
 * backwards.
 */
export async function applyFeedbackDelivery({ providerMessageId, status, at = new Date() }) {
  const existing = await adminDb.feedback.findUnique({
    where: { providerMessageId },
    select: { id: true, status: true },
  });
  if (!existing) return { matched: false, reason: "not-feedback" };

  if (!advancesTo(existing.status, status)) {
    return {
      matched: true,
      applied: false,
      reason: "out-of-order",
      from: existing.status,
      kind: "feedback",
    };
  }

  await adminDb.feedback.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === NOTIFICATION_STATUS.DELIVERED ? { deliveredAt: at } : {}),
      ...(status === NOTIFICATION_STATUS.BOUNCED ||
      status === NOTIFICATION_STATUS.COMPLAINED ||
      status === NOTIFICATION_STATUS.FAILED
        ? { failedAt: at }
        : {}),
    },
  });

  return {
    matched: true,
    applied: true,
    from: existing.status,
    to: status,
    kind: "feedback",
  };
}
