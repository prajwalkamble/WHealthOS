import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { planFromProviderPlanId, providerPlanId, rankOf } from "@/lib/billing/plans";
import {
  EMAIL_KIND,
  PLAN_CHANGE_SUBJECT,
  SUBJECT,
  activationText,
  kindForEvent,
  subjectFor,
} from "@/lib/notifications/subscription-email";
import { NOTIFICATION_EVENT, idempotencyKeyFor } from "@/lib/notifications/outbox";

// The one-step upgrade, in the places a database test cannot reach.
//
// tests/billing-integration.test.js exercises the lifecycle against real rows
// and a provider fake that schedules the way Razorpay does. This covers the
// three things that are not a database: the plan-id mapping the sync depends
// on, the shape of the endpoint, and the email that announces the change.
//
// Why the endpoint is read as source rather than invoked: it is a Next route
// handler whose guards are an ORDER -- session, then on-sale, then gateway,
// then body -- and the order is the security property. A test that called it
// would prove the whole chain refuses without proving the body is never read
// before the caller is known.

const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const flat = (relative) => read(relative).replace(/\s+/g, " ");

const ROUTE = "app/api/billing/plan-change/route.js";
const SERVICE = "lib/billing/service.js";
const BILLING_PAGE = "app/(checkout)/billing/page.jsx";
const PLAN_CARD = "app/(main)/settings/_components/plan-card.jsx";
const BUTTON = "app/(checkout)/billing/_components/upgrade-button.jsx";

describe("resolving a provider plan id back to one of ours", () => {
  // The lookup syncFromProvider depends on. Everywhere else in this codebase
  // our plan id comes from a checkout attempt; a plan change is the one
  // outcome that arrives from Razorpay, so this is the only place the mapping
  // runs backwards -- and a wrong answer changes what somebody may do.
  it("round-trips every plan and interval the catalogue sells", () => {
    for (const planId of ["pro", "intelligent"]) {
      for (const interval of ["monthly", "yearly"]) {
        const provider = providerPlanId(planId, interval);
        if (!provider) continue; // not configured in this environment
        expect(planFromProviderPlanId(provider)).toEqual({
          planId,
          interval,
          intervalEnum: interval.toUpperCase(),
        });
      }
    }
  });

  it("returns null for anything it does not recognise", () => {
    // Each of these must leave a subscription's plan alone rather than
    // resolving to a default. "pro" is the dangerous default: it is the
    // cheapest paid plan, so guessing it would silently downgrade somebody.
    for (const value of [
      "plan_someone_elses",
      "",
      null,
      undefined,
      0,
      {},
      [],
      "pro",
      "intelligent",
    ]) {
      expect(planFromProviderPlanId(value), `${String(value)} must not resolve`).toBeNull();
    }
  });

  it("is driven by the same configuration as the forward lookup", () => {
    // Not a second table. If these two ever came from different places, a
    // subscription could be opened against one plan and read back as another.
    const source = flat("lib/billing/plans.js");
    expect(source).toMatch(/planFromProviderPlanId[\s\S]*providerPlanId\(planId, interval\)/);
  });
});

describe("the upgrade endpoint", () => {
  const route = flat(ROUTE);

  it("takes a plan and an interval, and nothing with a price in it", () => {
    expect(route).toContain("billingPlanChangeSchema.safeParse");
    // The same rule the checkout route follows. An amount, a currency or a
    // provider plan id in a request body is a price the buyer chose.
    expect(route).not.toMatch(/body\.(amount|currency|providerPlanId|planPrice)/);
    expect(route).not.toMatch(/parsed\.data\.(amount|currency|providerPlanId)/);
  });

  it("never lets the caller name the subscription being changed", () => {
    // There is no subscription id in the request at all: requestPlanChange
    // reads whichever one the signed-in account holds. This is what makes
    // "upgrade somebody else's subscription" unexpressible rather than merely
    // refused.
    expect(route).not.toMatch(/subscriptionId|providerSubscriptionId/);
    expect(route).toMatch(/userId: auth\.userId/);
  });

  it("returns only what the screen needs", () => {
    expect(route).not.toMatch(/return ok\(change\)/);
    expect(route).toMatch(/scheduled: true/);
    // A provider subscription id or customer id in a JSON response is a
    // provider identifier in a browser.
    const response = route.slice(route.indexOf("return ok({"), route.indexOf("} catch"));
    expect(response).not.toMatch(/provider/i);
  });

  it("runs on node, because the payment client is CommonJS", () => {
    expect(route).toMatch(/export const runtime = "nodejs"/);
  });
});

describe("what the service refuses", () => {
  const service = flat(SERVICE);

  it("refuses anything that is not a move up the ladder", () => {
    expect(service).toContain("NOT_AN_UPGRADE");
    // Compared by rank, which is the plan ladder. Comparing plan ids as
    // strings would make "intelligent" < "pro" alphabetically and invert the
    // whole check.
    expect(service).toMatch(/const from = rankOf\(live\.planId\)/);
    expect(service).toMatch(/const to = rankOf\(planId\)/);
    expect(service).toMatch(/if \(to <= from\)/);
  });

  it("agrees with the ladder the pricing table publishes", () => {
    expect(rankOf("free")).toBe(0);
    expect(rankOf("pro")).toBeLessThan(rankOf("intelligent"));
    expect(rankOf("nonsense")).toBe(-1);
    // -1 for an unknown plan means `to <= from` is true for every live
    // subscription, so an unrecognised target is refused rather than ranked
    // above Free.
    expect(rankOf("nonsense")).toBeLessThan(rankOf("free"));
  });

  it("only acts on an ACTIVE subscription", () => {
    const change = service.slice(
      service.indexOf("export async function requestPlanChange"),
      service.indexOf("export async function checkoutState")
    );
    expect(change).toMatch(/live\.status !== SUBSCRIPTION_STATUS\.ACTIVE/);
    expect(change).toContain("NOT_CHANGEABLE");
  });

  it("does not write the new plan when the change is only scheduled", () => {
    const change = service.slice(
      service.indexOf("export async function requestPlanChange"),
      service.indexOf("export async function checkoutState")
    );
    // The whole of the correctness here. Writing planId at this point would
    // hand somebody Intelligent for the remainder of a month they paid for at
    // the Pro price.
    expect(change).toMatch(/scheduledPlanId: planId/);
    expect(change).not.toMatch(/data: \{[^}]*\bplanId: planId/);
  });

  it("calls the provider before it writes anything", () => {
    const change = service.slice(
      service.indexOf("export async function requestPlanChange"),
      service.indexOf("export async function checkoutState")
    );
    expect(change.indexOf("await changeSubscriptionPlan(")).toBeLessThan(
      change.indexOf("adminDb.subscription.update")
    );
  });
});

describe("the sync is the only thing that moves a plan", () => {
  const service = read(SERVICE);

  it("writes the plan from the provider, not from a request", () => {
    const sync = service.slice(
      service.indexOf("export async function syncFromProvider"),
      service.indexOf("// --- Reconciling on demand")
    );
    expect(sync).toMatch(/planFromProviderPlanId\(remote\.plan_id/);
    expect(sync).toMatch(/planId: remotePlan\.planId/);
  });

  it("applies the provider's plan only to a row that already exists", () => {
    // The create branch takes its plan from the checkout attempt, which was
    // written before Razorpay was called. Folding the provider's plan into
    // the shared `state` object would override it -- and would write
    // `undefined` into a required column whenever the plan id did not
    // resolve.
    const sync = service.slice(
      service.indexOf("export async function syncFromProvider"),
      service.indexOf("// --- Reconciling on demand")
    );
    const state = sync.slice(sync.indexOf("const state = {"), sync.indexOf("if (existing) {"));
    expect(state).not.toMatch(/\bplanId:/);
    expect(sync).toMatch(/\.\.\.remotePlanFields/);
    expect(sync).toMatch(/planId: attempt\.planId/);
  });

  it("clears a schedule only when the plan it named has arrived", () => {
    const sync = service.slice(
      service.indexOf("export async function syncFromProvider"),
      service.indexOf("// --- Reconciling on demand")
    );
    expect(sync).toMatch(/remotePlan\?\.planId === existing\.scheduledPlanId/);
  });
});

describe("where the upgrade is offered", () => {
  it("is a link to the review screen, never a control that changes anything", () => {
    const card = flat(PLAN_CARD);
    // The Settings card must not POST. Every change goes through /billing,
    // which resolves the subscription and prices the plan again.
    expect(card).not.toMatch(/api\/billing\/plan-change/);
    expect(card).toMatch(/Upgrade to \{plan\.name\}/);
  });

  it("keeps the subscriber's own billing period", () => {
    // §3.8 of the brief. Using the page's toggle instead would quietly move
    // a yearly subscriber onto monthly billing.
    const card = flat(PLAN_CARD);
    expect(card).toMatch(/checkoutUrl\(plan\.id, currentInterval\)/);
    expect(card).toMatch(/String\(current\?\.interval \?\? ""\)\.toLowerCase\(\)/);
  });

  it("offers nothing when there is already a change scheduled", () => {
    const card = flat(PLAN_CARD);
    expect(card).toMatch(/!current\.scheduledPlanId/);
  });

  it("offers only plans above the current one", () => {
    const card = flat(PLAN_CARD);
    expect(card).toMatch(/rankOf\(plan\.id\) > rankOf\(current\.planId\)/);
  });

  it("reports a scheduled change where somebody would look for it", () => {
    const card = read(PLAN_CARD);
    expect(card).toMatch(/current\.scheduledPlanId &&/);
    expect(card).toMatch(/You keep \{titleCase\(current\.planId\)\} until then/);
  });
});

describe("the confirm step says what it commits to", () => {
  const button = read(BUTTON);

  it("takes two clicks, and states the price and the date on the second", () => {
    expect(button).toMatch(/armed/);
    expect(button).toMatch(/Confirm the upgrade/);
    expect(button).toMatch(/\{amountLabel\}/);
    expect(button).toMatch(/\{effectiveLabel/);
  });

  it("says nothing is charged today", () => {
    // Flattened: the sentence wraps across source lines, and the assertion is
    // about what the reader sees rather than how it is indented.
    expect(flat(BUTTON)).toMatch(/Nothing is charged today/i);
  });

  it("sends a plan and an interval and nothing else", () => {
    expect(button).toMatch(/JSON\.stringify\(\{ planId, interval \}\)/);
  });

  it("passes the server's own refusal through rather than flattening it", () => {
    // requestPlanChange's messages name the way out -- "cancel in Settings",
    // "only while it is active". A generic toast would throw that away.
    expect(button).toMatch(/body\?\.error \?\?/);
  });

  it("does not claim the upgrade is immediate", () => {
    const page = read(BILLING_PAGE);
    for (const source of [button, page]) {
      expect(source).not.toMatch(/applies immediately|available immediately|right away/i);
    }
  });
});

describe("the email that announces the change", () => {
  it("is its own event, so the activation key cannot swallow it", () => {
    expect(NOTIFICATION_EVENT.SUBSCRIPTION_PLAN_CHANGED).toBe("SUBSCRIPTION_PLAN_CHANGED");
    expect(kindForEvent(NOTIFICATION_EVENT.SUBSCRIPTION_PLAN_CHANGED)).toBe(
      EMAIL_KIND.PLAN_CHANGE
    );
    expect(kindForEvent(NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED)).toBe(EMAIL_KIND.ACTIVATION);
    // Anything unrecognised is an activation, which is the safe default: the
    // activation letter describes a subscription correctly either way.
    expect(kindForEvent("SOMETHING_ELSE")).toBe(EMAIL_KIND.ACTIVATION);
  });

  it("keeps the existing idempotency key byte-identical", () => {
    // Every notification row already in the database was written with the
    // two-part key. A change to its shape would make those rows unfindable
    // and the next sync would send a second copy of an email already sent.
    expect(idempotencyKeyFor("sub-row-1", "SUBSCRIPTION_ACTIVATED")).toBe(
      "sub-row-1:SUBSCRIPTION_ACTIVATED"
    );
    expect(idempotencyKeyFor("sub-row-1", "SUBSCRIPTION_ACTIVATED", null)).toBe(
      "sub-row-1:SUBSCRIPTION_ACTIVATED"
    );
  });

  it("distinguishes one plan change from another", () => {
    expect(
      idempotencyKeyFor("sub-row-1", "SUBSCRIPTION_PLAN_CHANGED", "intelligent")
    ).not.toBe(idempotencyKeyFor("sub-row-1", "SUBSCRIPTION_PLAN_CHANGED", "pro"));
  });

  it("has its own subject", () => {
    expect(subjectFor(EMAIL_KIND.PLAN_CHANGE)).toBe(PLAN_CHANGE_SUBJECT);
    expect(subjectFor(EMAIL_KIND.ACTIVATION)).toBe(SUBJECT);
    expect(subjectFor(undefined)).toBe(SUBJECT);
    // Not "confirmed": nothing was bought today, and a subject line claiming
    // a confirmation would sit in an inbox next to the original one.
    expect(PLAN_CHANGE_SUBJECT).not.toMatch(/confirmed/i);
  });

  const MODEL = {
    kind: EMAIL_KIND.PLAN_CHANGE,
    userName: "Asha",
    recipientEmail: "asha@example.test",
    planName: "Intelligent",
    statusLabel: "Active",
    startDate: "11 Dec 2026",
    renewalDate: "11 Jan 2027",
    renews: true,
    billingCycle: "Monthly",
    renewalCadence: "every month",
    amount: "₹1,299.00",
    currency: "INR",
    paidOn: "11 Dec 2026",
    paymentReference: "pay_test123",
    features: { added: [{ key: "ai.queries", label: "Ask questions of your money" }], inherited: [] },
    links: { dashboard: "https://example.test/dashboard", manage: "https://example.test/settings" },
    supportEmail: "support@example.test",
  };

  it("reports the change as something that has already happened", () => {
    const text = activationText(MODEL);
    expect(text).toMatch(/Your WHealthOS plan is now Intelligent/);
    expect(text).toMatch(/has taken effect at the end of your billing period/i);
    // Not a thank-you for a purchase. No purchase was made today.
    expect(text).not.toMatch(/Thank you for choosing WHealthOS/);
  });

  it("still carries every figure the activation letter does", () => {
    const text = activationText(MODEL);
    for (const value of ["Intelligent", "Monthly", "₹1,299.00", "pay_test123", "11 Jan 2027"]) {
      expect(text, `${value} missing from the plan-change email`).toContain(value);
    }
    expect(text).toMatch(/Renews on: 11 Jan 2027/);
  });

  it("leaves the activation letter exactly as it was", () => {
    const text = activationText({ ...MODEL, kind: EMAIL_KIND.ACTIVATION });
    expect(text).toMatch(/Your WHealthOS subscription is now active\./);
    expect(text).toMatch(/Thank you for choosing WHealthOS/);
    // A model with no `kind` at all -- which is every model written before
    // this field existed -- must read as an activation.
    const legacy = activationText({ ...MODEL, kind: undefined });
    expect(legacy).toMatch(/Your WHealthOS subscription is now active\./);
  });

  it("is delivered by the same job, choosing the letter from the stored row", () => {
    const deliver = flat("lib/notifications/deliver.js");
    expect(deliver).toMatch(/kindForEvent\(notification\.event\)/);
    expect(deliver).toMatch(/subject: subjectFor\(kind\)/);
    // Read from the row, not from the job payload: a replayed Inngest event
    // must not be able to pick the wrong letter.
    expect(deliver).not.toMatch(/event\.data\?\.kind|payload\.kind/);
  });

  it("is swept for when it never reaches the job runner", () => {
    const queue = flat("lib/notifications/subscription-activated.js");
    expect(queue).toMatch(/NOTIFICATION_EVENT\.SUBSCRIPTION_PLAN_CHANGED,\s*\],/);
  });
});
