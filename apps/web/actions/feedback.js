"use server";

import { inngest } from "@/lib/inngest/client";
import { runAction } from "@/lib/action-error";
import { enforceRateLimit } from "@/lib/arcjet";
import { requireClerkUserId } from "@/lib/session";
import { withCurrentTenant } from "@/lib/prisma";
import { feedbackInputSchema, parseOrThrow } from "@/app/lib/schema";
import {
  FEEDBACK_SUBJECT_EVENT,
  recordFeedback,
} from "@/lib/notifications/feedback-notification";

// Submitting in-app feedback.
//
// This used to be an email and nothing else: the message was handed to Resend
// inside the request, and if Resend was unreachable the submission was gone --
// the person was told to try again and the only copy of what they wrote was in
// a browser about to be closed. There was no feedback table at all.
//
// Now the row is written first and the email is something OWED against it,
// delivered by lib/notifications/feedback-notification.js through Inngest,
// retried with backoff, swept hourly if the retry never ran, and marked
// delivered or bounced by Resend's own webhook. The same shape as the
// subscription confirmation, for the same reason: the part that depends on a
// third party is the part most likely to fail, so the intention is recorded
// before it is attempted.
//
// What this action does NOT do, and nothing in the payload can make it:
//
//   choose a recipient     there is one, it is FEEDBACK_EMAIL, and it is read
//                          in the delivery module from the environment.
//   name an author         identity comes from the verified session.
//   send the email         that happens in a job, as the job runner.
//
// Returning success now means "this is written down", which is true the moment
// it returns. Before, it meant "Resend accepted it", and the person had no
// record either way.

export async function submitFeedback(rawData) {
  return runAction(async () => {
    const clerkUserId = await requireClerkUserId();
    await enforceRateLimit("write", clerkUserId);

    // A server action is a public endpoint, so the payload is validated here
    // rather than trusted from the form. z.object drops unknown keys, so an
    // extra field in a crafted request never reaches the record.
    const { type, message } = parseOrThrow(feedbackInputSchema, rawData);

    // Written as the tenant, so the row's ownership is enforced by the
    // database and not only by this function choosing the right id.
    // withCurrentTenant resolves the internal users.id from the verified
    // session and sets it as the transaction's tenant.
    const { feedback, created } = await withCurrentTenant((tx, userId) =>
      recordFeedback({ tx, userId, type, message })
    );

    if (!created) {
      // An identical message from this account moments ago. Answered as sent,
      // because from the sender's point of view it was -- and an error here
      // would only invite a third attempt. This is the guard the disabled
      // button cannot provide: a retry after a timeout, a resubmitted page,
      // two tabs, two devices.
      return { success: true, data: { type, duplicate: true } };
    }

    // Best effort, and deliberately not awaited into the result. The feedback
    // is already saved; a job runner that is unreachable must not turn a
    // recorded submission into a failed one, and staleFeedback() is what picks
    // the row up when this never lands.
    try {
      await inngest.send({
        name: FEEDBACK_SUBJECT_EVENT,
        data: { feedbackId: feedback.id },
      });
    } catch (error) {
      console.error({
        code: "FEEDBACK_NOTIFICATION_NOT_QUEUED",
        details: { feedbackId: feedback.id, errorType: error?.name ?? "exception" },
      });
    }

    return { success: true, data: { type } };
  });
}
