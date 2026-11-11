import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { plansAreOnSale } from "@/lib/billing/availability";

// Nothing may take money while the product is free.
//
// /pricing says every feature is included, entitlements grant everything
// while BILLING_ENFORCEMENT is off, and the Terms say paying unlocks nothing.
// A reachable checkout alongside those three charges somebody for what their
// neighbour has free -- which the Terms then oblige us to refund. So the
// checkout is closed, and these assert that it is closed in the one place
// that counts (the endpoint) as well as the two that are courtesies (the
// page and the Settings card).
const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const flat = (relative) => read(relative).replace(/\s+/g, " ");

const ROUTE = "app/api/billing/checkout/route.js";
// The other endpoint that can put somebody on a paid plan. It takes no money,
// but moving an account onto a plan that is no longer sold is selling it, so
// it carries the same switch.
const PLAN_CHANGE_ROUTE = "app/api/billing/plan-change/route.js";
const BILLING_PAGE = "app/(checkout)/billing/page.jsx";
const PLAN_CARD = "app/(main)/settings/_components/plan-card.jsx";
const SETTINGS = "app/(main)/settings/page.jsx";
const AVAILABILITY = "lib/billing/availability.js";

describe("the switch itself", () => {
  const original = process.env.BILLING_PLANS_ON_SALE;
  afterEach(() => {
    if (original === undefined) delete process.env.BILLING_PLANS_ON_SALE;
    else process.env.BILLING_PLANS_ON_SALE = original;
  });

  it("is off unless something explicitly turns it on", () => {
    delete process.env.BILLING_PLANS_ON_SALE;
    expect(plansAreOnSale()).toBe(false);
  });

  it("stays off for anything that is not 'on'", () => {
    for (const value of ["", "off", "false", "0", "yes", "true", " on"]) {
      process.env.BILLING_PLANS_ON_SALE = value;
      expect(plansAreOnSale(), `"${value}" should not sell plans`).toBe(false);
    }
  });

  it("turns back on, because this is a decision and not a demolition", () => {
    for (const value of ["on", "ON", "On"]) {
      process.env.BILLING_PLANS_ON_SALE = value;
      expect(plansAreOnSale()).toBe(true);
    }
  });

  it("is asked separately from whether the gateway is configured", () => {
    // "Could we take a payment" and "should we" are different questions. A
    // correctly configured Razorpay account must still sell nothing.
    const source = read(AVAILABILITY);
    expect(source).toContain("export const plansAreOnSale");
    expect(source).toContain("BILLING_PLANS_ON_SALE");
  });
});

describe("the upgrade endpoint refuses too", () => {
  const route = flat(PLAN_CHANGE_ROUTE);

  it("checks before it reads a plan or touches the gateway", () => {
    const guard = route.indexOf("if (!plansAreOnSale())");
    const gateway = route.indexOf("gatewayReady()");
    const parse = route.indexOf("billingPlanChangeSchema.safeParse");
    expect(guard).toBeGreaterThan(-1);
    expect(guard, "the refusal must come before the gateway check").toBeLessThan(gateway);
    expect(guard, "the refusal must come before the body is parsed").toBeLessThan(parse);
  });

  it("requires a session first", () => {
    expect(route.indexOf("await authenticate()")).toBeLessThan(
      route.indexOf("if (!plansAreOnSale()")
    );
  });

  it("names the refusal, and says the existing subscription is unaffected", () => {
    expect(route).toContain("PLANS_NOT_ON_SALE");
    // The distinction this endpoint has to draw and the checkout does not:
    // somebody holding a live subscription while the plans are withdrawn
    // keeps it. Refusing to MOVE it is not refusing to honour it, and a
    // message that did not say so would read as "your subscription is gone".
    expect(route).toMatch(/current subscription is unaffected/i);
  });

  it("offers no upgrade in Settings while the plans are withdrawn", () => {
    // The courtesy half. `onSale &&` on the block, so the card does not
    // advertise a move the endpoint above would refuse.
    expect(flat(PLAN_CARD)).toMatch(/\{onSale && upgrades\.length > 0 &&/);
  });
});

describe("the endpoint refuses, which is the part that matters", () => {
  const route = flat(ROUTE);

  it("checks before it reads a plan or touches the gateway", () => {
    expect(route).toContain("if (!plansAreOnSale())");
    const guard = route.indexOf("if (!plansAreOnSale())");
    const gateway = route.indexOf("gatewayReady()");
    const parse = route.indexOf("billingCheckoutSchema.safeParse");
    expect(guard).toBeGreaterThan(-1);
    expect(guard, "the refusal must come before the gateway check").toBeLessThan(gateway);
    expect(guard, "the refusal must come before the body is parsed").toBeLessThan(parse);
  });

  it("still requires a session first, so it leaks nothing to anonymous callers", () => {
    expect(route.indexOf("await authenticate()")).toBeLessThan(
      route.indexOf("if (!plansAreOnSale())")
    );
  });

  it("names the refusal so it can be told apart in a log", () => {
    expect(route).toContain("PLANS_NOT_ON_SALE");
  });
});

describe("the surfaces that offer it", () => {
  it("sends an old checkout link to the page that explains why", () => {
    const page = flat(BILLING_PAGE);
    expect(page).toContain('if (!plansAreOnSale()) redirect("/pricing")');
    // Before the parameters, so no plan is resolved for a sale that is not
    // happening.
    expect(page.indexOf("plansAreOnSale()")).toBeLessThan(
      page.indexOf("readCheckoutParams(params)")
    );
  });

  it("does not render plan tiles or a period toggle in Settings", () => {
    const card = flat(PLAN_CARD);
    expect(card).toContain("{onSale && !hasLive && (");
    // The free-state panel split in two on 2026-11-10, when enforcement was
    // switched on: the original says every feature is included at no cost,
    // which that switch made false, so each state now has its own panel and
    // both are gated on `enforced` so neither can be on screen while the
    // other is the true one. Neither renders a tile or a toggle.
    expect(card).toContain("{!onSale && !hasLive && !enforced && (");
    expect(card).toContain("{!onSale && !hasLive && enforced && (");
    expect(card).toContain("no plan to choose and no card");
    expect(card).toContain("belong to the paid plans");
  });

  it("reads the switch on the server, because the browser cannot see it", () => {
    // BILLING_PLANS_ON_SALE has no NEXT_PUBLIC_ prefix on purpose.
    expect(flat(SETTINGS)).toContain("onSale={plansAreOnSale()}");
    expect(read(PLAN_CARD)).not.toContain("process.env");
  });

  it("keeps the way out for somebody who already subscribed", () => {
    // Discontinuing the plans must not strand an existing subscriber with a
    // live mandate and no cancel button.
    const card = flat(PLAN_CARD);
    expect(card).toContain("<CancelSubscription />");
    // The cancel button hangs off the live-subscription panel, which is not
    // gated on onSale.
    const panel = card.indexOf("{current && state && (");
    const gated = card.indexOf("{onSale && !hasLive && (");
    expect(panel).toBeGreaterThan(-1);
    expect(panel, "the subscription panel must not be inside the on-sale branch")
      .toBeLessThan(gated);
  });
});

describe("the claim stays true", () => {
  it("the pricing page and the checkout cannot disagree", () => {
    // /pricing says the plans are discontinued. If somebody turns selling
    // back on, that page has to be rewritten in the same change.
    const pricing = read("app/(marketing)/pricing/page.jsx")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    if (/discontinued/i.test(pricing)) {
      expect(
        process.env.BILLING_PLANS_ON_SALE?.toLowerCase(),
        "plans are on sale while /pricing calls them discontinued -- " +
          "rewrite the pricing page and its FAQ in the same change"
      ).not.toBe("on");
    }
  });
});
