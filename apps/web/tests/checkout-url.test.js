import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CHECKOUT_PATH,
  PRICING_PATH,
  checkoutUrl,
  isDuration,
  isPaidPlanId,
  pricingUrl,
  readCheckoutParams,
} from "@/lib/billing/checkout-url";
import { safeRedirect } from "@/lib/safe-redirect";

const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

// Every source file in apps/web, as a path relative to it. Node 20 has no
// fs.globSync, and a four-line walk is not worth a dependency.
const SKIP = new Set(["node_modules", ".next", ".next-build", "tests", "public"]);
const sources = (dir = "") =>
  readdirSync(path.join(WEB, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sources(relative);
    return /\.(js|jsx)$/.test(entry.name) ? [relative] : [];
  });

describe("the URL that names a plan", () => {
  it("is /billing with plan and duration", () => {
    expect(CHECKOUT_PATH).toBe("/billing");
    expect(checkoutUrl("pro", "monthly")).toBe("/billing?plan=pro&duration=monthly");
    expect(checkoutUrl("intelligent", "yearly")).toBe(
      "/billing?plan=intelligent&duration=yearly"
    );
  });

  it("keeps /pricing for going back to compare", () => {
    expect(PRICING_PATH).toBe("/pricing");
    expect(pricingUrl("pro", "yearly")).toBe("/pricing?plan=pro&duration=yearly");
  });

  it("escapes what it is given rather than interpolating it raw", () => {
    // Neither argument reaches here unvalidated today -- both are checked
    // against the catalogue first -- but a URL builder that trusts its inputs
    // is one refactor away from being an injection point.
    expect(checkoutUrl("pro&admin=1", "monthly")).toBe(
      "/billing?plan=pro%26admin%3D1&duration=monthly"
    );
  });

  it("says duration in the address bar, whatever the code calls it", () => {
    // `interval` is the internal word -- Razorpay's, and the column's. The URL
    // uses `duration`, and the two are mapped at this boundary only.
    expect(checkoutUrl("pro", "monthly")).toContain("duration=");
    expect(checkoutUrl("pro", "monthly")).not.toContain("interval=");
  });

  it("recognises the plans that are sold, and only those", () => {
    expect(isPaidPlanId("pro")).toBe(true);
    expect(isPaidPlanId("intelligent")).toBe(true);
    // Free is not bought.
    expect(isPaidPlanId("free")).toBe(false);
    expect(isPaidPlanId("nonsense")).toBe(false);
    expect(isPaidPlanId(null)).toBe(false);
  });

  it("recognises the two durations", () => {
    expect(isDuration("monthly")).toBe(true);
    expect(isDuration("yearly")).toBe(true);
    expect(isDuration("weekly")).toBe(false);
    expect(isDuration(undefined)).toBe(false);
  });
});

describe("reading a plan out of a URL", () => {
  it("takes a valid pair", () => {
    expect(readCheckoutParams({ plan: "pro", duration: "yearly" })).toEqual({
      plan: "pro",
      duration: "yearly",
      invalid: false,
    });
  });

  // A URL is a request, never an authorisation. Anything the catalogue does
  // not recognise is dropped rather than corrected, so a nonsense link renders
  // "that is not a plan we sell" instead of guessing at a purchase.
  it.each([
    // The spec's own examples of invalid input.
    [{ plan: "admin", duration: "monthly" }, { plan: null, duration: "monthly" }],
    [{ plan: "pro", duration: "weekly" }, { plan: "pro", duration: null }],
    // Free is advertised but not sold: asking to buy it is a bad request.
    [{ plan: "free", duration: "monthly" }, { plan: null, duration: "monthly" }],
    // A Razorpay plan id in the URL buys nothing: the provider's ids are
    // configuration and are never read from a request.
    [{ plan: "plan_RZPfake123", duration: "monthly" }, { plan: null, duration: "monthly" }],
    // A price in the URL is not a price.
    [{ plan: "pro", duration: "monthly", amount: "1" }, { plan: "pro", duration: "monthly" }],
    [{ plan: "pro", duration: "monthly", amount: "-999" }, { plan: "pro", duration: "monthly" }],
    // A repeated parameter arrives as an array. It asks two questions, so it
    // gets neither answered.
    [{ plan: ["pro", "intelligent"] }, { plan: null, duration: null }],
  ])("drops what it does not recognise in %o", (input, expected) => {
    const { invalid: _invalid, ...read } = readCheckoutParams(input);
    expect(read).toEqual(expected);
  });

  // The difference between "this link is broken" and "nothing was asked for",
  // because the page says different things about them.
  it("tells a broken link apart from a bare visit", () => {
    expect(readCheckoutParams({}).invalid).toBe(false);
    expect(readCheckoutParams({ plan: "pro" }).invalid).toBe(false);
    expect(readCheckoutParams({ plan: "admin" }).invalid).toBe(true);
    expect(readCheckoutParams({ plan: "pro", duration: "weekly" }).invalid).toBe(true);
    expect(readCheckoutParams({ duration: "monthly" }).invalid).toBe(false);
  });

  it("survives being handed nothing", () => {
    expect(readCheckoutParams()).toEqual({ plan: null, duration: null, invalid: false });
  });
});

describe("a destination carried in a URL", () => {
  it("accepts a same-site path", () => {
    expect(safeRedirect("/pricing?plan=pro&duration=monthly")).toBe(
      "/pricing?plan=pro&duration=monthly"
    );
    expect(safeRedirect("/settings#plan")).toBe("/settings#plan");
  });

  // An open redirect is worth more to a phisher than it looks: the link
  // genuinely starts on our domain, and the bounce happens after the person
  // has just typed their password.
  it.each([
    ["an absolute URL", "https://evil.example/steal"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash host", "/\\evil.example"],
    ["a relative path", "pricing"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a newline", "/pricing\nLocation: https://evil.example"],
    ["a non-string", 42],
    ["nothing", undefined],
  ])("refuses %s", (_label, value) => {
    expect(safeRedirect(value)).toBeNull();
  });

  it("returns the fallback it was given", () => {
    expect(safeRedirect("https://evil.example", "/dashboard")).toBe("/dashboard");
  });
});

// These are wiring assertions: the behaviour they protect is a routing
// decision, and routing decisions are exactly what gets quietly reverted.
describe("choosing a plan goes to the review page, not to a payment window", () => {
  const plans = read("app/(marketing)/pricing/_components/pricing-plans.jsx");

  it("links each paid plan to /billing with its plan and duration", () => {
    expect(plans).toContain("checkoutUrl(plan.id, period)");
    // A link, so choosing a plan navigates to the review page rather than
    // opening a payment window. Either link component satisfies that:
    // PrefetchLink is next/link plus navigation-intent detection, and on this
    // button it carries intent="none" so the router never warms a checkout
    // page nobody has asked for. See tests/prefetch-intent.test.js.
    expect(plans.replace(/\s+/g, " ")).toMatch(
      /<(?:Prefetch)?Link\s+href=\{checkoutUrl\(plan\.id, period\)\}/
    );
  });

  // The bug this replaced the first time: every paid button was a
  // <Link href="/settings...">, so choosing a plan took you somewhere you had
  // to choose it again.
  it("does not send a paid plan to Settings", () => {
    expect(plans).not.toMatch(/href=\{[^}]*settings/i);
    expect(plans).not.toContain("ctaHref");
  });

  // ...and the bug it replaced the second time: the modal opened on the
  // marketing page, so a visitor went from comparing plans to a card field
  // with no price confirmed, no renewal terms and nothing to agree to.
  it("opens no payment window of its own", () => {
    expect(plans).not.toContain("useRazorpayCheckout");
    // Asserted on the identifiers rather than on the word, which still
    // appears in the comment explaining why none of this is here.
    expect(plans).not.toContain("window.Razorpay");
    expect(plans).not.toContain("checkout.razorpay.com");
    expect(plans).not.toMatch(/from "@\/components\/billing/);
  });

  it("offers the free plan no button once somebody is signed in", () => {
    const collapsed = plans.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/plan\.monthly === 0 \? \( signedIn \? null :/);
  });

  it("reads whether they are signed in on the server", () => {
    // This layout mounts no ClerkProvider for a signed-out visitor, so
    // useAuth() in the browser would have nothing to read. Still true on the
    // free page, which branches on it to choose between "Create a free
    // account" and "Go to dashboard".
    const page = read("app/(marketing)/pricing/page.jsx");
    expect(page).toContain('from "@clerk/nextjs/server"');
    expect(page).toMatch(/auth\(\)/);
    expect(page).toContain("signedIn={Boolean(userId)}");
    expect(plans).not.toContain("useAuth");
  });

  it("validates the duration in the URL before the browser sees it", () => {
    // Asserted against /pricing until the paid plans were discontinued; that
    // page takes no plan or duration now. /billing is where a hand-edited
    // ?duration= still has to be refused.
    const page = read("app/(checkout)/billing/page.jsx");
    expect(page).toContain("readCheckoutParams");
  });
});

describe("one place can open a payment window", () => {
  it("is the pay button on /billing, and nothing else", () => {
    // The protection this gives: a second surface that charges people is a
    // second surface that has to state the renewal terms, show the price the
    // server resolved, and handle a dismissed modal. Both of the ones that
    // existed before got at least one of those wrong.
    const callers = sources().filter((file) =>
      read(file).includes("useRazorpayCheckout(")
    );

    expect(callers.sort()).toEqual([
      "app/(checkout)/billing/_components/pay-button.jsx",
      "components/billing/use-checkout.js",
    ]);
  });

  it("is reached from Settings by a link rather than a second checkout", () => {
    const card = read("app/(main)/settings/_components/plan-card.jsx");
    expect(card).toContain("checkoutUrl(plan.id, interval)");
    expect(card).not.toContain("SubscribeButton");
  });
});

describe("signing up keeps the plan that was chosen", () => {
  it("defers the destination to after consent rather than dropping it", () => {
    const signUp = read("app/(auth)/sign-up/[[...sign-up]]/page.jsx");
    // The consent step still cannot be skipped -- that is why it is
    // forceRedirectUrl -- but the destination rides along on it.
    expect(signUp).toContain("forceRedirectUrl={afterSignUp}");
    expect(signUp).toContain("/welcome?next=");
    expect(signUp).toContain("safeRedirect");

    const welcome = read("app/(auth)/welcome/page.jsx");
    expect(welcome).toContain("safeRedirect");
    expect(welcome).toContain("<ConsentForm next={next} />");
  });
});
