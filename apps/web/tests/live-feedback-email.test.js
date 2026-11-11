import { describe, it, expect, afterAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@whealthos/database";
import { randomUUID } from "node:crypto";

// ONE real feedback notification, to the official business inbox.
//
// This file is skipped unless FEEDBACK_LIVE_SEND=1 is set in the shell, so
// `pnpm test` never sends mail. It exists to satisfy the one verification that
// cannot be mocked: whether the configured sender is actually permitted to
// deliver to the official recipient, through the same code path a genuine
// submission uses.
//
// What makes it the same path and not a simulation:
//
//   the row is written by recordFeedback(), the function the action calls;
//   the email is sent by deliverFeedback(), the function the Inngest job
//     calls, which resolves the recipient from FEEDBACK_EMAIL itself;
//   sendEmail() and the Resend client are the real ones -- resend is NOT
//     mocked here, which is the only difference from
//     tests/feedback-integration.test.js.
//
// The feedback row itself is written to the TEST database (.env.test, the
// disposable container), so no production record is created. Only the email is
// real.
//
// The subject is the mechanism's own, deliberately not overridden: the brief
// offers "[TEST] WHealthOS — New Feedback Received" as an example, but writing
// a different subject would mean testing a code path nobody uses. The test is
// made identifiable through the author name and the message body instead, both
// of which the real mechanism renders.

// The test database, captured BEFORE .env is read.
//
// vitest.config.mjs loads .env.test and only .env.test, precisely so that a
// database suite cannot write to production. Reading .env here would undo that
// -- it holds the production DATABASE_URL -- so the test connection string is
// taken first and .env is loaded WITHOUT override, which means it can only
// fill in variables .env.test does not set. The Resend key and the official
// recipient come from there; the database does not move.
//
// An earlier version of this file passed `override: true`. That would have
// repointed Prisma at the production database and written this test feedback
// into it.
const TEST_DB = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";

// The real credentials and the real recipient, from .env rather than the
// shell, so neither is typed into a command or printed anywhere.
loadEnv({ path: ".env", quiet: true });

const LIVE = process.env.FEEDBACK_LIVE_SEND === "1";

const TEST_AUTHOR = "WHealthOS Feedback Verification (TEST)";
const TEST_MESSAGE =
  "This is a test feedback notification generated during WHealthOS feedback " +
  "feature verification. No real customer feedback is represented in this " +
  "message.";

describe.skipIf(!LIVE)("one real feedback notification", () => {
  const admin = new PrismaClient({ datasourceUrl: TEST_DB });
  let user;

  afterAll(async () => {
    if (user) {
      await admin.feedback.deleteMany({ where: { userId: user.id } });
      await admin.user.delete({ where: { id: user.id } }).catch(() => {});
    }
    await admin.$disconnect();
  });

  it("is pointed at the disposable test database, not production", () => {
    // Asserted rather than assumed, and asserted first. Everything below
    // writes rows; this is the check that says where they land.
    expect(TEST_DB, "no test database configured").toBeTruthy();
    const host = new URL(TEST_DB.replace(/^postgres(ql)?:/, "http:")).hostname;
    expect(
      ["127.0.0.1", "localhost", "::1"].includes(host),
      `refusing to write test feedback to a non-local database (${host})`
    ).toBe(true);
  });

  it("delivers to the official inbox through the real mechanism", async () => {
    const { recordFeedback, deliverFeedback } = await import(
      "@/lib/notifications/feedback-notification"
    );
    const { inbox, sender } = await import("@/lib/email/config");
    const { CONTACT_EMAIL } = await import("@/lib/company/contact");

    // Verified before anything is sent: the recipient is the official address
    // and not a personal or test one. This is the check the brief requires
    // before a real send.
    //
    // Compared against CONTACT_EMAIL rather than a literal. The address is
    // already established in exactly one place -- lib/company/contact.js,
    // which records that it is the contact published on the Privacy Policy as
    // the grievance officer, on the domain verified as a sender in Resend --
    // and a second copy here would be a second thing to update. It would also
    // be the address hardcoded in source, which is the thing the brief asks
    // this configuration not to be.
    expect(inbox(), "FEEDBACK_EMAIL must be the official business inbox").toBe(
      CONTACT_EMAIL
    );
    expect(sender(), "the sender must be on the verified domain").toMatch(
      /@whealthos\.com>?$/
    );
    expect(process.env.RESEND_API_KEY, "a real API key is required").toBeTruthy();

    user = await admin.user.create({
      data: {
        clerkUserId: `clerk_livetest_${randomUUID()}`,
        email: "feedback-verification@whealthos.test",
        name: TEST_AUTHOR,
        imageUrl: "https://example.test/avatar.png",
      },
    });

    const { feedback, created } = await recordFeedback({
      tx: admin,
      userId: user.id,
      type: "feedback",
      message: TEST_MESSAGE,
    });
    expect(created).toBe(true);

    const result = await deliverFeedback(feedback.id);

    const row = await admin.feedback.findUnique({ where: { id: feedback.id } });

    // The provider's own identifiers, recorded for the audit. No key and no
    // secret: a message id, a status and a recipient.
    //
    // Written to a FILE as well as stdout, and this is not belt-and-braces --
    // it is the fix for a real mistake. The first run of this test printed
    // only through console.log, the surrounding shell pipeline swallowed it,
    // and afterAll had already deleted the row by the time that was noticed.
    // The message id for that send is gone, and recovering it would have
    // meant sending a second email to the official inbox, which the brief
    // forbids. A file survives the pipeline and the cleanup both.
    const evidence = {
      sent: result.sent,
      reason: result.reason ?? null,
      providerMessageId: result.providerMessageId ?? null,
      rowStatus: row?.status ?? null,
      acceptedAt: row?.acceptedAt ?? null,
      feedbackId: feedback.id,
      recipient: inbox(),
      sender: sender(),
      subjectAuthor: TEST_AUTHOR,
      at: new Date().toISOString(),
    };

    const { writeFileSync, mkdirSync } = await import("node:fs");
    // node_modules/.cache is gitignored, so provider identifiers are not
    // committed by accident.
    const dir = "node_modules/.cache/whealth-live-send";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/result.json`, JSON.stringify(evidence, null, 2));

    // Raw stdout, not console.log: vitest intercepts the latter and a shell
    // pipeline can lose it.
    process.stdout.write(`\nLIVE_SEND_RESULT ${JSON.stringify(evidence)}\n`);

    expect(result.sent, `send failed: ${result.reason}`).toBe(true);
    expect(row.status).toBe("ACCEPTED");
    expect(row.providerMessageId).toBeTruthy();
  }, 30_000);
});
