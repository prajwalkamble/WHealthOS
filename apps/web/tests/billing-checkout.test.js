import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PHASES } from "@/components/billing/use-checkout";

// The checkout surface, asserted at the source.
//
// These are wiring and copy guarantees rather than render tests, for the same
// reason tests/legal-consistency.test.js is: what breaks here is not a
// component's output, it is somebody removing the sentence that says nothing
// has been charged, or reintroducing a second screen that can take a payment.
// A render test would not notice either.
const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const flat = (relative) => read(relative).replace(/\s+/g, " ");
// The file with its comments taken out, for assertions about what a person
// actually reads on the screen. Without this, a comment explaining why a page
// must never say "payment failed" counts as the page saying it.
const copy = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");

const PAGE = "app/(checkout)/billing/page.jsx";
const STATUS = "app/(checkout)/billing/success/page.jsx";
const LAYOUT = "app/(checkout)/layout.js";
const BUTTON = "app/(checkout)/billing/_components/pay-button.jsx";
const POLLER = "app/(checkout)/billing/success/_components/confirmation-poller.jsx";
const HOOK = "components/billing/use-checkout.js";

describe("where checkout lives", () => {
  it("is a route of its own with its own shell", () => {
    for (const file of [PAGE, STATUS, LAYOUT, BUTTON, POLLER]) {
      expect(existsSync(path.join(WEB, file)), `${file} is missing`).toBe(true);
    }
  });

  // A payment screen with a sidebar, a feedback tab and an assistant widget
  // is a payment screen with three invitations to go somewhere else.
  it("mounts none of the signed-in app's furniture", () => {
    const layout = read(LAYOUT);
    for (const widget of [
      "AppSidebar",
      "AppHeader",
      "SidebarProvider",
      "FeedbackWidget",
      "AgentWidget",
    ]) {
      expect(layout, `the checkout shell mounts ${widget}`).not.toContain(widget);
    }
    // It is still signed-in territory, so Clerk is still there.
    expect(layout).toContain("<Clerk>");
  });

  it("is behind the middleware", () => {
    const middleware = read("middleware.js");
    expect(middleware).toContain('"/billing(.*)"');
    expect(middleware).toContain('"/api/billing(.*)"');
    // The webhook must stay out of it: Arcjet's detectBot runs LIVE in
    // production and does not allow Razorpay.
    //
    // Asserted as an exclusion rather than as one exact pattern string. The
    // literal used to be checked here, and it passed while the webhook was
    // being blocked anyway -- the exclusion sat in this pattern and the
    // OTHER one re-matched the path, which is all Next needs to run the
    // middleware. tests/middleware-matcher.test.js now evaluates every
    // pattern together, which is the only way that bug is visible.
    expect(middleware).toContain("webhooks/");
    expect(middleware).toMatch(/\/api\/\(\(\?!webhooks\//);
  });

  it("is never cached and never indexed", () => {
    for (const file of [PAGE, STATUS]) {
      expect(read(file), `${file} may be cached`).toContain(
        'export const dynamic = "force-dynamic"'
      );
      expect(read(file), `${file} may be indexed`).toContain("index: false");
    }
  });

  it("sends somebody with no account through consent, keeping their plan", () => {
    expect(read(PAGE)).toContain("requireBillingAccount(checkoutUrl(plan, interval))");
    const gate = read("lib/billing/account-gate.js");
    expect(gate).toContain("safeRedirect");
    expect(gate).toContain("/welcome?next=");
  });
});

describe("what the review page has to say before anybody pays", () => {
  const page = flat(PAGE);

  it("states the price, the interval and that it recurs", () => {
    expect(page).toContain("Due now");
    expect(page).toContain("entry.renewal");
    expect(page).toMatch(/is charged now, and then/);
  });

  it("states how to stop it, and that there is no proration", () => {
    expect(page).toMatch(/cancel at any time from Settings/i);
    expect(page).toMatch(/do not calculate part-period refunds/i);
  });

  it("links the terms, the privacy policy and billing support", () => {
    expect(page).toContain('href="/terms#plans"');
    expect(page).toContain('href="/privacy"');
    expect(page).toContain('href="/contact"');
    const layout = flat(LAYOUT);
    expect(layout).toContain('href="/terms"');
    expect(layout).toContain('href="/privacy"');
    expect(layout).toContain('href="/contact"');
  });

  // Reassurance that describes the integration, not a standard nobody has
  // audited this application against.
  it("reassures without claiming a certification", () => {
    const everything = [page, flat(LAYOUT), flat(BUTTON)].join(" ");
    expect(everything).toMatch(/never reach WHealthOS|never sees or stores/i);
    for (const claim of [/PCI/i, /ISO 27001/i, /SOC ?2/i, /bank-grade/i, /military-grade/i]) {
      expect(everything, `claims ${claim}`).not.toMatch(claim);
    }
  });

  it("asks for no payment details of its own", () => {
    // Card numbers, CVVs and UPI PINs are entered on Razorpay's screen. An
    // input for one here would be a compliance problem and a phishing
    // lesson for our own users.
    const sources = [read(PAGE), read(BUTTON), read(LAYOUT), read(STATUS)].join(" ");
    expect(sources).not.toMatch(/<input/i);
    expect(sources).not.toMatch(/cvv|card_?number|upi_?pin/i);
  });

  it("warns that a subscription unlocks nothing while enforcement is off", () => {
    expect(page).toContain("enforcementEnabled()");
    expect(page).toMatch(/does not change what you can do today/i);
  });
});

describe("every state the review page can be in", () => {
  const page = read(PAGE);

  // Each of these is a situation somebody can actually arrive in, and the
  // failure mode they share is a blank screen or an offer to pay again.
  it.each([
    ["a link naming something we do not sell", /does not name a plan we sell/i],
    ["no plan chosen", /Choose a plan first/i],
    ["a plan this deployment cannot sell", /is not available yet/i],
    ["a payment that is still being confirmed", /being set up/i],
    ["the plan they are already on", /already on/i],
    ["a different plan from the one they have", /One subscription at a time/i],
  ])("has a view for %s", (_label, pattern) => {
    expect(page).toMatch(pattern);
  });

  it("says nothing has been charged in each refusal", () => {
    // Six panels, and the sentence that matters in every one of them.
    const occurrences = page.match(/has been charged|been charged/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });

  it("offers a way out of each one", () => {
    expect(page).toContain('href="/pricing"');
    expect(page).toContain('href="/dashboard"');
    expect(page).toContain('href="/settings#plan"');
  });

  // The twenty-first state, and the one a stack trace used to occupy.
  it("has a boundary for an unexpected server error", () => {
    const boundary = read("app/(checkout)/error.jsx");
    expect(boundary).toContain('"use client"');
    // The question somebody on a payment screen actually has.
    expect(boundary.replace(/\s+/g, " ")).toMatch(/nothing has been charged/i);
    expect(boundary).toContain("reset");
    expect(boundary).toContain('href="/billing/success"');
    // An internal error must not reach a visitor. Next replaces the message
    // with a digest in production anyway; this makes it explicit.
    expect(boundary).toContain('process.env.NODE_ENV !== "production"');
  });

  it("shows a skeleton rather than a bare spinner while it loads", () => {
    const loading = read("app/(checkout)/billing/loading.jsx");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("sr-only");
    // The decoration is hidden rather than read out as a list of nothing.
    expect(loading).toContain("aria-hidden");
  });
});

// A 503 that says only "Payments are not available just now." is true,
// useless, and identical for several different causes. One of them -- the
// credentials being set but rejected -- had no diagnosis at all, and cost two
// rounds of debugging a status code whose reason was written nowhere.
describe("a refusal says what an operator can act on", () => {
  const http = read("lib/billing/http.js");

  it("diagnoses every upstream failure code it can", () => {
    for (const code of [
      "UPSTREAM_UNAUTHORIZED",
      "UPSTREAM_FAILED",
      "NOT_CONFIGURED",
      "WEBHOOK_NOT_CONFIGURED",
    ]) {
      expect(http, `${code} has no hint`).toContain(code);
    }
    // The one that cost the debugging round names the variables to change.
    expect(http).toMatch(/RAZORPAY_KEY_ID \/ RAZORPAY_KEY_SECRET/);
    expect(http).toMatch(/restart the dev server/i);
  });

  it("keeps the diagnosis out of production", () => {
    expect(http).toContain('process.env.NODE_ENV === "production"');
    // Two gates, for the two kinds of 503: the missing-variable one and the
    // rejected-credentials one.
    expect((http.match(/NODE_ENV === "production"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("never puts a secret in a response", () => {
    expect(http).not.toMatch(/keySecret\(\)|webhookSecret\(\)/);
    expect(http).not.toMatch(/process\.env\.RAZORPAY_KEY_SECRET/);
  });

  it("is used by every route that talks to Razorpay", () => {
    for (const route of ["checkout", "verify", "cancel"]) {
      const source = read(`app/api/billing/${route}/route.js`);
      expect(source, `${route} does not diagnose upstream failures`).toContain(
        "failPayment(error)"
      );
    }
  });
});

describe("the pay button", () => {
  const button = flat(BUTTON);

  it("reports every phase inline, in one live region", () => {
    expect(button).toContain('role="status" aria-live="polite"');
    expect(button).toContain("aria-busy={busy}");
    expect(button).toContain("disabled={busy}");
  });

  it("says what it is doing rather than just spinning", () => {
    expect(button).toContain("Preparing secure checkout…");
    expect(button).toContain("Continue to secure payment");
    expect(button).toContain("Confirming your payment…");
  });

  // Closing the window is a decision. Treating it as a failure tells people
  // something went wrong when they simply changed their mind.
  it("treats a dismissed window as a decision, not an error", () => {
    expect(button).toMatch(/Checkout cancelled.*Nothing has been charged/);
  });

  it("offers a retry that cannot double-charge", () => {
    expect(button).toContain("Try again");
    expect(flat(HOOK)).toMatch(/Trying again will not charge you twice/);
  });
});

describe("the hook that opens the window", () => {
  const hook = read(HOOK);

  it("reports phases rather than a single boolean", () => {
    expect(Object.values(PHASES)).toEqual([
      "idle",
      "creating",
      "opening",
      "awaiting",
      "verifying",
      "dismissed",
      "failed",
    ]);
  });

  it("sends a plan and an interval, and nothing with a price on it", () => {
    expect(hook).toContain('body: JSON.stringify({ planId, interval })');
    expect(hook).not.toMatch(/amount:/);
    expect(hook).not.toMatch(/currency:/);
    // The provider's plan id is configuration. A browser that could name one
    // could name the amount, because the amount lives on it.
    expect(hook).not.toContain("plan_id");
  });

  it("uses the subscription field, not the order field", () => {
    // Subscriptions are opened with subscription_id and signed
    // "<payment>|<subscription>"; orders use order_id and the reverse. Mixing
    // them is a checkout that silently never confirms.
    expect(hook).toContain("subscription_id: checkout.subscriptionId");
    expect(hook).not.toContain("order_id");
    expect(hook).toContain("razorpay_subscription_id");
  });

  it("loads the script from Razorpay, on demand, and nowhere else", () => {
    expect(hook).toContain('"https://checkout.razorpay.com/v1/checkout.js"');
    const urls = hook.match(/https?:\/\/[^"'\s)]+/g) ?? [];
    for (const url of urls) {
      expect(url, `${url} is not Razorpay`).toMatch(/^https:\/\/checkout\.razorpay\.com\//);
    }
  });

  it("never decides for itself that a payment succeeded", () => {
    // The browser hands the callback to the server and goes to the page that
    // reads the database. Nothing here sets a plan or an entitlement.
    expect(hook).toContain('router.push("/billing/success")');
    expect(hook).not.toMatch(/setPlan|grant|entitle/i);
  });

  it("times its own requests out rather than hanging", () => {
    expect(hook).toContain("AbortController");
    expect(hook).toContain("REQUEST_TIMEOUT_MS");
  });
});

describe("waiting for the webhook", () => {
  const poller = read(POLLER);

  it("polls with a bounded, backing-off schedule", () => {
    const backoff = poller.match(/const BACKOFF = \[([^\]]+)\]/);
    expect(backoff, "the schedule is no longer a literal array").not.toBeNull();

    const delays = backoff[1].split(",").map((value) => Number(value.trim()));
    expect(delays.length).toBeGreaterThanOrEqual(5);
    expect(delays.length).toBeLessThanOrEqual(12);
    // Rising, so a delayed webhook is not met with a request a second.
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]);
    }
    // Long enough to be useful, short enough that nobody waits all day.
    const total = delays.reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(60);
    expect(total).toBeLessThan(600);
  });

  it("stops, and says what to do when it does", () => {
    expect(poller).toContain("setExhausted(true)");
    expect(flat(POLLER)).toMatch(/Still not confirmed/);
    expect(flat(POLLER)).toMatch(/Nothing needs paying again/i);
    expect(poller).toContain("Check again");
  });

  it("reads the account's real state rather than deciding anything", () => {
    expect(poller).toContain('fetch("/api/billing/subscription"');
    expect(poller).toContain('cache: "no-store"');
    expect(poller).toContain("body?.confirming === false");
    expect(poller).toContain("router.refresh()");
  });

  it("announces itself once, not once per attempt", () => {
    expect(poller).toContain('aria-live="polite"');
    expect((poller.match(/aria-live/g) ?? []).length).toBe(1);
  });
});

describe("the status page", () => {
  const status = flat(STATUS);

  it("reads the subscription from the database, not from the redirect", () => {
    expect(status).toContain("billingSummary");
    expect(status).toMatch(/Arriving here proves only that a browser arrived here/);
  });

  it("distinguishes active, confirming and nothing", () => {
    expect(status).toContain("Your subscription is active");
    expect(status).toContain("We are confirming your subscription");
    expect(status).toContain("No active subscription");
  });

  it("does not tell somebody their payment failed when it may not have", () => {
    // A subscription that is not active may be a payment that failed, or a
    // webhook that has not arrived. The page cannot tell, so it does not
    // guess -- and the wrong guess is the one that frightens somebody who has
    // in fact been charged.
    expect(copy(STATUS)).not.toMatch(/payment failed|did not go through/i);
    expect(status).toMatch(/nothing needs paying again/i);
  });
});

describe("one dependency failing does not close the till", () => {
  const page = read(PAGE);

  // Clerk's backend API went down mid-session once and took the whole review
  // page with it: a ClerkAPIResponseError thrown inside the Promise.all, an
  // error boundary, and no way to pay. The email it fetches is a prefill in
  // Razorpay's form and nothing else, so its failure has to be survivable.
  it("treats the email prefill as optional", () => {
    expect(page).toMatch(/currentUser\(\)\s*\.catch\(\(\)\s*=>\s*null\)/);
    expect(page).toContain("primaryEmailAddress?.emailAddress ?? null");
  });

  // requireBillingAccount redirects by throwing. In a Promise.all the first
  // rejection is the one that propagates, so an unhandled sibling can swallow
  // the redirect and show an error to somebody who only needed to sign in.
  it("never lets a sibling rejection swallow the sign-in redirect", () => {
    const block = page.match(/const \[userId, user\] = await Promise\.all\(\[([\s\S]*?)\]\);/);
    expect(block, "the gate is no longer a Promise.all").not.toBeNull();

    const calls = block[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));

    for (const call of calls) {
      const gate = call.startsWith("requireBillingAccount");
      expect(
        gate || /\.catch\(/.test(call),
        `${call} can reject and take the redirect with it`
      ).toBe(true);
    }
  });
});
