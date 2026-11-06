import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Which paths the Arcjet + Clerk middleware runs on.
//
// This exists because of a bug that was invisible everywhere except
// production. The matcher listed two patterns and excluded /api/webhooks/
// from the second one only. Next runs the middleware when ANY pattern
// matches, so the first pattern matched the webhook paths anyway and Arcjet's
// detectBot -- LIVE in production, DRY_RUN locally -- answered every inbound
// delivery with 403.
//
// Nothing surfaced it: the endpoints were correct, the signatures were
// correct, the secrets were correct, and development behaved perfectly. The
// symptom was Razorpay webhooks that never arrived, Clerk users that never
// synced, and every Inngest cron silently dead for sixteen days.
//
// So this test reproduces Next's matcher semantics against the real patterns
// and asserts both halves: the machine endpoints are excluded, and nothing
// that needs a session accidentally joins them.
const WEB = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(WEB, "middleware.js"), "utf8");

// Pull the patterns out of the file rather than restating them, so the test
// cannot drift from what Next is actually given.
const patterns = (() => {
  // Sliced on the closing "]," at the start of a line, not on the first "]":
  // the patterns themselves contain character classes like [^?], and a lazy
  // match to the first bracket silently returns nothing.
  const start = source.indexOf("matcher: [");
  if (start < 0) throw new Error("no matcher array in middleware.js");
  const end = source.indexOf("\n  ],", start);
  const block = source.slice(start, end);
  return [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    // The file is JS source, so a regex backslash is written doubled.
    m[1].replace(/\\\\/g, "\\")
  );
})();

const runsOn = (pathname) =>
  patterns.some((p) => new RegExp(`^${p}$`).test(pathname));

describe("the middleware matcher", () => {
  it("was read from the file, not retyped", () => {
    expect(patterns.length).toBeGreaterThanOrEqual(2);
  });

  // The whole point. Each of these authenticates itself more strongly than
  // bot detection could, and each is called by a machine that detectBot will
  // not recognise.
  it.each([
    ["/api/webhooks/razorpay", "verifies an HMAC over the raw body"],
    ["/api/webhooks/clerk", "verifies a Svix signature"],
    ["/api/webhooks/resend", "verifies a Svix signature"],
    ["/api/inngest", "verifies INNGEST_SIGNING_KEY"],
  ])("does not run on %s (%s)", (pathname) => {
    expect(
      runsOn(pathname),
      `${pathname} is matched, so Arcjet will 403 every delivery in production`
    ).toBe(false);
  });

  // The other half: excluding too much would be a far worse bug than the one
  // this replaced, because it would be silent in the opposite direction.
  it.each([
    "/",
    "/pricing",
    "/dashboard",
    "/transactions",
    "/settings",
    "/billing",
    "/account/abc123",
    "/api/billing/checkout",
    "/api/billing/cancel",
    "/api/ai/chat",
    "/api/export/transactions",
  ])("still runs on %s", (pathname) => {
    expect(
      runsOn(pathname),
      `${pathname} would lose both the Clerk gate and Arcjet`
    ).toBe(true);
  });

  it("excludes the machine endpoints in every pattern, not just one", () => {
    // The original bug in one assertion: an exclusion that appears in only
    // one of two patterns does nothing at all.
    for (const needle of ["api/webhooks/", "api/inngest"]) {
      const covering = patterns.filter((p) =>
        new RegExp(`^${p}$`).test("/api/webhooks/razorpay") ||
        new RegExp(`^${p}$`).test("/api/inngest")
      );
      expect(
        covering,
        `a pattern still matches a machine endpoint despite ${needle}`
      ).toEqual([]);
    }
  });
});
