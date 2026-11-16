import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FREE_FAQS, FEATURE_GROUPS, PLANS } from "@/data/pricing";
import { ENTITLEMENT_KEYS } from "@/lib/billing/entitlements";
import { landingActions, DEMO_HREF, SIGN_UP_HREF } from "@/lib/landing/cta";

// The free pricing page, asserted at the source.
//
// The risk here is not a broken render, it is a page that quietly starts
// lying: a plan price reappearing, a feature advertised that nothing grants,
// or the "everything is included" claim surviving the day somebody switches
// enforcement back on. None of that is visible in a screenshot and none of it
// would fail a build.
const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const flat = (relative) => read(relative).replace(/\s+/g, " ");
// Comments stripped, for assertions about what a visitor actually reads. A
// comment explaining why the page must not name a price otherwise counts as
// the page naming one.
const copy = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");

const PAGE = "app/(marketing)/pricing/_components/free-pricing.jsx";
const ROUTE = "app/(marketing)/pricing/page.jsx";
const GRID = "app/(marketing)/pricing/_components/everything-included.jsx";
const CTA = "app/(marketing)/pricing/_components/pricing-cta.jsx";

describe("the page offers the sample-data route the user asked for", () => {
  const cta = flat(CTA);

  it("shows the Try it (Sample Data!) button", () => {
    expect(cta).toContain("Try it (Sample Data!)");
  });

  it("points it at guest mode and not at an account", () => {
    expect(cta).toContain(
      "<Link href={DEMO_HREF}>Try it (Sample Data!)</Link>"
    );
    expect(DEMO_HREF).toBe("/demo");
  });

  it("renders the buttons in both the hero and the closing section", () => {
    const page = flat(PAGE);
    const occurrences = page.match(/<PricingCta /g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("says what the demo does with what you type into it", () => {
    // Guest rows live in localStorage and there is no path that carries them
    // into an account. Somebody who enters real figures expecting either to
    // be saved properly or to migrate on sign-up has been misled by omission.
    const text = copy(PAGE);
    expect(text).toMatch(/stays in this browser/i);
    expect(text).toMatch(/never reaches an account/i);
    expect(text).toMatch(/not carried over if you sign up/i);
  });
});

describe("the buttons follow who is reading the page", () => {
  const cta = flat(CTA);

  it("takes signed-in state from the server rather than guessing", () => {
    // Resolved in the route with auth() and passed down as a prop. The
    // marketing layout mounts no ClerkProvider for a signed-out visitor, so
    // useAuth() in the browser would have nothing to read.
    const route = flat(ROUTE);
    expect(route).toContain('from "@clerk/nextjs/server"');
    expect(route).toContain("signedIn={Boolean(userId)}");
    expect(flat(PAGE)).toContain("signedIn");
    expect(cta).not.toContain("useAuth");
  });

  it("sends an account holder to their dashboard", () => {
    expect(cta).toContain("if (signedIn)");
    expect(cta).toContain("landingActions(true,");
    expect(cta).toContain("<Link href={primary.href}>{primary.label}</Link>");
    expect(landingActions(true, { signUp: "unused" }).primary.href).toBe(
      "/dashboard"
    );
  });

  // Changed deliberately on 2026-11-13: it used to offer the sample data
  // alongside the dashboard. /demo is still public and still reachable by
  // URL -- it is the invitation that went, not the route.
  it("offers an account holder nothing but their dashboard", () => {
    expect(landingActions(true, { signUp: "x", demo: "y" }).secondary).toBeNull();
  });

  it("sends a guest part-way through the demo back to it, not through it again", () => {
    expect(cta).toContain("if (guest)");
    expect(cta).toContain("<Link href={DEMO_HREF}>Back to your demo</Link>");
    expect(DEMO_HREF).toBe("/demo");
  });

  it("offers a first-time visitor the demo and an account", () => {
    expect(cta).toContain(
      "<Link href={SIGN_UP_HREF}>Create a free account</Link>"
    );
    expect(SIGN_UP_HREF).toBe("/sign-up");
  });

  it("detects a guest from the demo store's own key, not a copy of it", () => {
    // A second literal here would be free to drift from the store that
    // actually writes the rows, and the drift would show up as a button that
    // silently stops adapting.
    expect(cta).toContain("import { DEMO_STORAGE_KEY }");
    // From storage-key, not store: store carries the sample dataset, which
    // this page would otherwise ship to every visitor to read one string.
    expect(cta).toContain('from "@/lib/demo/storage-key"');
    expect(cta).not.toMatch(/"whealth-demo-/);
  });

  it("never asks storage about somebody who is signed in", () => {
    expect(cta).toMatch(/if \(signedIn\) return;/);
  });

  it("agrees with the server on the first render, so nothing flickers", () => {
    // guest starts null and the null branch is the first-time variant, which
    // is what the server renders. Seeding it true or false would either
    // mismatch hydration or flash the wrong button.
    expect(cta).toContain("useState(null)");
  });

  it("survives storage being blocked or corrupt", () => {
    expect(cta).toMatch(/\}\s*catch\s*\{/);
    expect(cta).toContain("setGuest(false)");
  });
});

describe("the page sells nothing and says so", () => {
  const text = copy(PAGE);

  it("names no price and no billing period", () => {
    expect(text).not.toMatch(/₹|\$\d|per month|\/month|monthly|yearly/i);
  });

  it("mentions the old tiers only as discontinued, never as a choice", () => {
    // Naming them is deliberate -- somebody who remembers Pro needs to be
    // told where it went. What must not come back is a tier presented as
    // something to pick or pay for, so the CTA labels from the catalogue are
    // what this watches for.
    for (const plan of PLANS) {
      if (plan.monthly === 0) continue;
      expect(
        text,
        `the page offers "${plan.cta.label}" again`
      ).not.toContain(plan.cta.label);
      expect(text).not.toMatch(new RegExp(`choose\\s+${plan.name}|get\\s+${plan.name}\\b`, "i"));
    }
  });

  it("opens no checkout and links to none", () => {
    expect(read(PAGE)).not.toContain("/billing");
    expect(read(PAGE)).not.toContain("useRazorpayCheckout");
    expect(read(PAGE)).not.toContain("checkoutUrl");
  });

  it("states plainly that the paid plans are discontinued", () => {
    expect(text).toMatch(/discontinued/i);
  });

  it("does not ask for a card", () => {
    expect(text).toMatch(/no card/i);
  });
});

describe("what it claims is included is what the backend knows about", () => {
  it("renders the catalogue rather than a second copy of it", () => {
    // A hand-typed list here could advertise a feature no entitlement key
    // grants, and nothing would notice.
    const grid = read(GRID);
    expect(grid).toContain('from "@/data/pricing"');
    expect(grid).toContain("FEATURE_GROUPS.map");
    expect(grid).not.toMatch(/const FEATURES\s*=\s*\[/);
  });

  it("covers every feature group, with no plan column left over", () => {
    expect(FEATURE_GROUPS.length).toBeGreaterThan(0);
    const grid = read(GRID);
    // The old page ticked a row per plan. With one plan there is nothing to
    // compare, so no per-plan branching should remain.
    expect(grid).not.toContain("plans.includes");
    expect(grid).not.toContain('"pro"');
    expect(grid).not.toContain('"intelligent"');
  });

  it("every advertised feature still maps to an entitlement key", () => {
    const keys = new Set(ENTITLEMENT_KEYS);
    for (const group of FEATURE_GROUPS) {
      for (const feature of group.features) {
        expect(
          keys.has(feature.key),
          `${feature.label} (${feature.key}) is advertised but is not an entitlement`
        ).toBe(true);
      }
    }
  });
});

describe("the FAQ answers the free model, not the old one", () => {
  const questions = FREE_FAQS.map((faq) => faq.question).join(" ");
  const answers = FREE_FAQS.map((faq) => faq.answer).join(" ");

  it("no longer explains plan mechanics that no longer exist", () => {
    expect(questions).not.toMatch(/upgrade or downgrade|setup fees|per transaction/i);
    expect(answers).not.toMatch(/proration|flat monthly price|Free plan covers/i);
  });

  it("says it is free and says what happened to the plans", () => {
    expect(questions).toMatch(/really free/i);
    expect(answers).toMatch(/discontinued/i);
  });

  it("tells somebody who already subscribed what happens to their money", () => {
    // The Terms promise a refund for a feature that is now free. A pricing
    // page that goes free without answering this leaves the one person with
    // a real financial question to guess.
    expect(questions).toMatch(/subscribed before/i);
    expect(answers).toMatch(/refunded in full/i);
    expect(answers).toMatch(/cancelled from Settings/i);
  });

  it("does not promise free forever", () => {
    // "For now" is the honest claim. A promise here is one the Terms do not
    // make and nobody can keep.
    expect(answers).not.toMatch(/free forever|always be free|never charge/i);
    expect(answers).toMatch(/free for now/i);
  });

  it("still refuses to call the AI advice", () => {
    expect(answers).toMatch(/not regulated financial advice/i);
  });
});

describe("the free page cannot be served while the plans are for sale", () => {
  it("is chosen by the same switch the checkout obeys", () => {
    // Before this, /pricing was unconditionally the free page and a tripwire
    // test had to catch the disagreement. Now the route picks the layout from
    // plansAreOnSale(), so "free page up, checkout open" is unreachable
    // rather than merely tested for.
    const route = read(ROUTE).replace(/\s+/g, " ");
    expect(route).toContain("if (!plansAreOnSale())");
    expect(route).toContain("<FreePricing");
    expect(route).toContain("<PlanPricing");
  });
});

describe("the claim is tied to enforcement actually being off", () => {
  it("fails if plans are enforced while the page says everything is included", () => {
    // A tripwire, in the spirit of the one in legal-consistency.test.js.
    //
    // This page tells every visitor that budgets, goals, analytics, exports
    // and the AI work are open to them. Switching BILLING_ENFORCEMENT on
    // makes that false for anybody on the free plan, and the switch is an
    // environment variable -- there is no deploy step that would notice.
    const text = copy(PAGE);
    // Only meaningful when this layout is the one being served. With the
    // plans on sale the route renders PlanPricing instead, so the free page's
    // claim is not on anybody's screen.
    const freePageIsServed =
      process.env.BILLING_PLANS_ON_SALE?.toLowerCase() !== "on";
    const claimsEverythingIsFree =
      /Every feature, for everyone/i.test(text) && freePageIsServed;
    if (claimsEverythingIsFree) {
      expect(
        process.env.BILLING_ENFORCEMENT?.toLowerCase(),
        "enforcement is on, so /pricing no longer describes the product -- " +
          "either turn it off or rewrite the page and its FAQ"
      ).not.toBe("on");
    }
  });
});
