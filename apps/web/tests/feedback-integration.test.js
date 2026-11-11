import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@whealthos/database";
import { randomUUID } from "node:crypto";

// In-app feedback, end to end against a real database.
//
// The property these exist to hold is the one the feature did not have: a
// submission survives the email failing. Before this, actions/feedback.js
// handed the message to Resend inside the request and kept nothing, so a
// provider outage destroyed it and told the person to try again.
//
// So almost every test below makes the email fail on purpose and then asserts
// the feedback is still there. The rest are about who may write a row and what
// a second identical submission does, both of which are enforced by Postgres
// and therefore tested against Postgres rather than against a fake.

let currentClerkId = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: currentClerkId }),
  currentUser: async () => null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn) => fn,
}));

vi.mock("@arcjet/next", () => ({
  request: async () => ({}),
  default: () => ({ protect: async () => ({ isDenied: () => false }) }),
  tokenBucket: () => ({}),
  shield: () => ({}),
  detectBot: () => ({}),
}));

vi.mock("@/lib/arcjet", () => ({ enforceRateLimit: async () => {} }));

// Inngest, captured rather than called. The events it would have raised are
// asserted directly, and no job runs unless a test runs it.
const raised = [];
let inngestFails = false;
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: async (event) => {
      if (inngestFails) throw new Error("inngest unreachable");
      raised.push(event);
      return { ids: ["evt_test"] };
    },
    createFunction: () => ({}),
  },
}));

// Resend, mocked throughout. No test in this file may send real mail.
const sent = [];
let nextResult = { data: { id: null }, error: null };
vi.mock("resend", () => ({
  Resend: class {
    constructor() {
      this.emails = {
        send: async (options) => {
          sent.push(options);
          if (nextResult instanceof Error) throw nextResult;
          return nextResult;
        },
      };
    }
  },
}));

process.env.RESEND_API_KEY = "re_fake_key_for_tests";
process.env.RESEND_FROM_EMAIL = "WHealthOS <hello@whealthos.com>";
process.env.FEEDBACK_EMAIL = "hello@whealthos.test";
process.env.SITE_URL = "https://www.whealthos.test";

const { submitFeedback } = await import("@/actions/feedback");
const {
  applyFeedbackDelivery,
  deliverFeedback,
  recordFeedback,
  staleFeedback,
} = await import("@/lib/notifications/feedback-notification");
const { recordDeliveryEvent } = await import("@/lib/email/delivery");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

let alice;
let bob;

const makeUser = (label) =>
  admin.user.create({
    data: {
      clerkUserId: `clerk_${label}_${randomUUID()}`,
      email: `${label}-${randomUUID()}@example.test`,
      name: `${label} Example`,
      imageUrl: "https://example.test/avatar.png",
    },
  });

const accepted = (id = `re_${randomUUID().replace(/-/g, "").slice(0, 16)}`) => ({
  data: { id },
  error: null,
});

beforeEach(async () => {
  await admin.feedback.deleteMany({});
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
  raised.length = 0;
  sent.length = 0;
  inngestFails = false;
  nextResult = accepted();

  alice = await makeUser("alice");
  bob = await makeUser("bob");
  currentClerkId = alice.clerkUserId;
});

afterAll(async () => {
  await admin.feedback.deleteMany({});
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
  await admin.$disconnect();
  const { db, adminDb } = await import("@/lib/prisma");
  await db.$disconnect();
  await adminDb.$disconnect();
});

const rowsFor = (userId) =>
  admin.feedback.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

describe("submitting feedback", () => {
  it("writes the feedback down and asks for the email separately", async () => {
    const result = await submitFeedback({ type: "feedback", message: "this is three words" });
    expect(result.success).toBe(true);

    const rows = await rowsFor(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "FEEDBACK",
      message: "this is three words",
      status: "QUEUED",
      attempts: 0,
      providerMessageId: null,
    });

    // The email has NOT been sent by the action. That is the change: the
    // request returns once the feedback is durable, and the notification is
    // owed against it.
    expect(sent).toHaveLength(0);
    expect(raised).toEqual([
      { name: "feedback.notification.send", data: { feedbackId: rows[0].id } },
    ]);
  });

  it("stores the problem type distinctly", async () => {
    await submitFeedback({ type: "problem", message: "the thing is broken" });
    const rows = await rowsFor(alice.id);
    expect(rows[0].type).toBe("PROBLEM");
  });

  it("rejects an invalid submission and writes nothing", async () => {
    for (const payload of [
      { type: "feedback", message: "" },
      { type: "feedback", message: "   " },
      { type: "feedback", message: "two words" },
      { type: "rate", message: "this is three words" },
      { type: "spam", message: "this is three words" },
      { type: "feedback", message: "x".repeat(4001) },
      {},
    ]) {
      const result = await submitFeedback(payload);
      expect(result.success, JSON.stringify(payload)).toBe(false);
    }
    expect(await rowsFor(alice.id)).toHaveLength(0);
  });

  it("refuses an unauthenticated caller", async () => {
    currentClerkId = null;
    const result = await submitFeedback({ type: "feedback", message: "this is three words" });
    expect(result.success).toBe(false);
    expect(await admin.feedback.count()).toBe(0);
  });

  it("ignores extra fields a crafted request adds", async () => {
    // z.object drops unknown keys, so none of these reaches the record. The
    // dangerous one is userId: the row's owner comes from the session.
    await submitFeedback({
      type: "feedback",
      message: "this is three words",
      userId: bob.id,
      status: "DELIVERED",
      providerMessageId: "re_forged",
      attempts: 99,
    });

    const mine = await rowsFor(alice.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("QUEUED");
    expect(mine[0].providerMessageId).toBeNull();
    expect(mine[0].attempts).toBe(0);
    expect(await rowsFor(bob.id)).toHaveLength(0);
  });

  it("keeps the feedback when the job runner cannot be reached", async () => {
    inngestFails = true;
    const result = await submitFeedback({ type: "feedback", message: "this is three words" });

    // Still a success, because it IS saved. The sweep is what sends it.
    expect(result.success).toBe(true);
    const rows = await rowsFor(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("QUEUED");
  });
});

describe("the duplicate window", () => {
  it("answers an identical resubmission as sent, without a second row", async () => {
    const payload = { type: "feedback", message: "this is three words" };
    const first = await submitFeedback(payload);
    const second = await submitFeedback(payload);
    const third = await submitFeedback(payload);

    expect(first.data).toEqual({ type: "feedback" });
    // Reported as a duplicate rather than as a failure: from the sender's
    // point of view it was sent, and an error would invite a fourth attempt.
    expect(second.data).toEqual({ type: "feedback", duplicate: true });
    expect(third.data).toEqual({ type: "feedback", duplicate: true });

    expect(await rowsFor(alice.id)).toHaveLength(1);
    // And exactly one email was ever asked for.
    expect(raised).toHaveLength(1);
  });

  it("does not collapse genuinely different feedback", async () => {
    await submitFeedback({ type: "feedback", message: "the first thing" });
    await submitFeedback({ type: "feedback", message: "the second thing" });
    // Same words, different kind of report: a separate submission.
    await submitFeedback({ type: "problem", message: "the first thing" });

    expect(await rowsFor(alice.id)).toHaveLength(3);
  });

  it("does not collapse the same words from two different accounts", async () => {
    await submitFeedback({ type: "feedback", message: "this is three words" });
    currentClerkId = bob.clerkUserId;
    await submitFeedback({ type: "feedback", message: "this is three words" });

    expect(await rowsFor(alice.id)).toHaveLength(1);
    expect(await rowsFor(bob.id)).toHaveLength(1);
  });

  it("lets an identical message through once the window has passed", async () => {
    const old = new Date(Date.now() - 5 * 60 * 1000);
    await recordFeedback({ userId: alice.id, type: "feedback", message: "same words again" });
    await admin.feedback.updateMany({ where: { userId: alice.id }, data: { createdAt: old } });

    const { created } = await recordFeedback({
      userId: alice.id,
      type: "feedback",
      message: "same words again",
    });
    expect(created).toBe(true);
    expect(await rowsFor(alice.id)).toHaveLength(2);
  });
});

describe("row-level security on feedback", () => {
  it("refuses a row attributed to another account", async () => {
    const { withTenant } = await import("@/lib/prisma");

    // Alice's tenant context, Bob's id on the row. The WITH CHECK on
    // feedback_insert is what rejects this -- not the action choosing the
    // right id, which it does, but the database refusing the wrong one.
    await expect(
      withTenant(alice.id, (tx) =>
        tx.feedback.create({
          data: { userId: bob.id, type: "FEEDBACK", message: "not mine to write" },
        })
      )
    ).rejects.toThrow();

    expect(await rowsFor(bob.id)).toHaveLength(0);
  });

  it("does not let a signed-in context mark its own notification delivered", async () => {
    const { withTenant } = await import("@/lib/prisma");
    const { feedback } = await recordFeedback({
      userId: alice.id,
      type: "feedback",
      message: "this is three words",
    });

    // The update policy is job-runner only. updateMany under a tenant matches
    // no rows rather than throwing, which is the same outcome: nothing moves.
    const result = await withTenant(alice.id, (tx) =>
      tx.feedback.updateMany({
        where: { id: feedback.id },
        data: { status: "DELIVERED", providerMessageId: "re_forged" },
      })
    );
    expect(result.count).toBe(0);

    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    expect(row.status).toBe("QUEUED");
    expect(row.providerMessageId).toBeNull();
  });

  it("does not show one account another account's feedback", async () => {
    const { withTenant } = await import("@/lib/prisma");
    await recordFeedback({ userId: bob.id, type: "feedback", message: "bob wrote this" });

    const visible = await withTenant(alice.id, (tx) => tx.feedback.findMany({}));
    expect(visible).toHaveLength(0);
  });
});

describe("delivering the notification", () => {
  const record = (message = "this is three words") =>
    recordFeedback({ userId: alice.id, type: "feedback", message }).then((r) => r.feedback);

  it("sends to the configured inbox and nowhere else", async () => {
    const feedback = await record();
    const result = await deliverFeedback(feedback.id);

    expect(result.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("hello@whealthos.test");
    expect(sent[0].from).toBe("WHealthOS <hello@whealthos.com>");
    // Replying reaches the author, whose address came from the account row.
    expect(sent[0].replyTo).toBe(alice.email);
  });

  it("records acceptance without claiming delivery", async () => {
    nextResult = accepted("re_known_id");
    const feedback = await record();
    await deliverFeedback(feedback.id);

    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    // ACCEPTED, not DELIVERED. Resend has taken the message; whether it
    // arrived is a separate fact its webhook reports.
    expect(row.status).toBe("ACCEPTED");
    expect(row.providerMessageId).toBe("re_known_id");
    expect(row.acceptedAt).toBeInstanceOf(Date);
    expect(row.deliveredAt).toBeNull();
  });

  it("sends only once however many times the job runs", async () => {
    const feedback = await record();
    await deliverFeedback(feedback.id);
    const again = await deliverFeedback(feedback.id);
    const andAgain = await deliverFeedback(feedback.id);

    expect(again.sent).toBe(false);
    expect(andAgain.sent).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("keeps the feedback when the provider rejects the email", async () => {
    nextResult = { data: null, error: { name: "internal_server_error", message: "upstream" } };
    const feedback = await record();

    // Thrown, which is how Inngest is asked to back off and retry.
    await expect(deliverFeedback(feedback.id)).rejects.toThrow();

    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    // The submission is intact and still owed. This is the whole point of the
    // table: before it, this case lost the feedback.
    expect(row.message).toBe("this is three words");
    expect(row.status).toBe("QUEUED");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("rejected");
  });

  it("gives up after MAX_ATTEMPTS and says so on the row", async () => {
    const { MAX_ATTEMPTS } = await import("@/lib/notifications/deliver");
    nextResult = { data: null, error: { name: "internal_server_error", message: "upstream" } };
    const feedback = await record();

    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      await expect(deliverFeedback(feedback.id)).rejects.toThrow();
    }
    const last = await deliverFeedback(feedback.id);

    expect(last.terminal).toBe(true);
    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    expect(row.status).toBe("FAILED");
    expect(row.failedAt).toBeInstanceOf(Date);
    // Still there, and still readable. A failed notification is not a lost
    // submission.
    expect(row.message).toBe("this is three words");
  });

  it("stops immediately on a failure that will never succeed", async () => {
    nextResult = { data: null, error: { name: "invalid_to_address", message: "bad recipient" } };
    const feedback = await record();

    const result = await deliverFeedback(feedback.id);
    expect(result.terminal).toBe(true);
    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
  });

  it("refuses terminally, and keeps the feedback, when no inbox is configured", async () => {
    const original = process.env.FEEDBACK_EMAIL;
    delete process.env.FEEDBACK_EMAIL;
    try {
      const feedback = await record();
      const result = await deliverFeedback(feedback.id);

      expect(result.reason).toBe("recipient-not-configured");
      expect(sent).toHaveLength(0);
      const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
      expect(row.status).toBe("FAILED");
      expect(row.message).toBe("this is three words");
    } finally {
      process.env.FEEDBACK_EMAIL = original;
    }
  });

  it("puts the reference and the author in the email, and no secret", async () => {
    const feedback = await record();
    await deliverFeedback(feedback.id);

    // @react-email/components, not /render: the subpackage cannot resolve
    // react from this workspace root, and the components entry is what every
    // other email test in this suite imports.
    const { render } = await import("@react-email/components");
    const html = await render(sent[0].react);

    expect(html).toContain(feedback.id);
    expect(html).toContain("alice Example");
    expect(html).toContain("this is three words");
    // Nothing from the environment, and nothing that identifies the account
    // beyond the name and the reply address the reviewer needs.
    expect(html).not.toContain(process.env.RESEND_API_KEY);
    expect(html).not.toMatch(/re_fake|api[_-]?key/i);
    expect(html).not.toContain(alice.clerkUserId);
  });

  it("strips control characters from the subject", async () => {
    // The display name comes from the account, and a person sets their own.
    // A carriage return in one ends the Subject header and begins another,
    // which is how a name becomes a way to add recipients to somebody else's
    // mail. headerSafe is applied on this path now; it was not before.
    await admin.user.update({
      where: { id: alice.id },
      data: { name: "Mallory\r\nBcc: victim@example.test" },
    });
    const feedback = await record();
    await deliverFeedback(feedback.id);

    expect(sent[0].subject).not.toMatch(/[\r\n]/);
    expect(sent[0].subject).toContain("Bcc: victim@example.test");
    expect(sent[0].subject).toBe(
      "[WHealthOS] Share Feedback from Mallory Bcc: victim@example.test"
    );
  });
});

describe("delivery status from Resend", () => {
  const delivered = async (message = "this is three words") => {
    nextResult = accepted("re_delivery_target");
    const { feedback } = await recordFeedback({
      userId: alice.id,
      type: "feedback",
      message,
    });
    await deliverFeedback(feedback.id);
    return feedback;
  };

  it("marks feedback delivered from the webhook event", async () => {
    const feedback = await delivered();
    const outcome = await recordDeliveryEvent({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "re_delivery_target" },
    });

    expect(outcome).toMatchObject({ handled: true, applied: true, kind: "feedback" });
    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    expect(row.status).toBe("DELIVERED");
    expect(row.deliveredAt).toBeInstanceOf(Date);
  });

  it("records a bounce against the feedback, not a subscription", async () => {
    const feedback = await delivered();
    const outcome = await recordDeliveryEvent({
      type: "email.bounced",
      created_at: new Date().toISOString(),
      data: { email_id: "re_delivery_target" },
    });

    expect(outcome.kind).toBe("feedback");
    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    expect(row.status).toBe("BOUNCED");
    expect(row.failedAt).toBeInstanceOf(Date);
  });

  it("will not walk the status backwards on a late event", async () => {
    const feedback = await delivered();
    await applyFeedbackDelivery({ providerMessageId: "re_delivery_target", status: "DELIVERED" });
    const late = await applyFeedbackDelivery({
      providerMessageId: "re_delivery_target",
      status: "DELAYED",
    });

    expect(late).toMatchObject({ matched: true, applied: false, reason: "out-of-order" });
    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });
    expect(row.status).toBe("DELIVERED");
  });

  it("ignores a message id that belongs to neither kind", async () => {
    const outcome = await recordDeliveryEvent({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "re_nothing_we_track" },
    });
    // The common case: a budget alert or a forwarded support email. Not a
    // failure, and nothing is written.
    expect(outcome).toMatchObject({ handled: true, matched: false });
  });
});

describe("the sweep", () => {
  it("finds feedback whose email never went out", async () => {
    const { feedback } = await recordFeedback({
      userId: alice.id,
      type: "feedback",
      message: "never sent",
    });
    // Older than the sweep's grace period, which is what tells a lost
    // notification apart from one still on its way.
    await admin.feedback.update({
      where: { id: feedback.id },
      data: { queuedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    const stale = await staleFeedback();
    expect(stale.map((row) => row.id)).toContain(feedback.id);
  });

  it("leaves a recent one alone", async () => {
    const { feedback } = await recordFeedback({
      userId: alice.id,
      type: "feedback",
      message: "just submitted",
    });
    const stale = await staleFeedback();
    expect(stale.map((row) => row.id)).not.toContain(feedback.id);
  });

  it("leaves an already-accepted one alone", async () => {
    const { feedback } = await recordFeedback({
      userId: alice.id,
      type: "feedback",
      message: "already accepted",
    });
    await deliverFeedback(feedback.id);
    await admin.feedback.update({
      where: { id: feedback.id },
      data: { queuedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    const stale = await staleFeedback();
    expect(stale.map((row) => row.id)).not.toContain(feedback.id);
  });
});
