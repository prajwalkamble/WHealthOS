import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FEATURE_GROUPS, PLANS } from "@/data/pricing";
import {
  ENTITLEMENT_KEYS,
  EntitlementError,
  enforcementEnabled,
  entitlementSummary,
  entitlementsFor,
  planGrants,
  requireEntitlement,
  smallestPlanWith,
} from "@/lib/billing/entitlements";

const FEATURES = FEATURE_GROUPS.flatMap((group) => group.features);

let saved;
beforeEach(() => {
  saved = process.env.BILLING_ENFORCEMENT;
  process.env.BILLING_ENFORCEMENT = "on";
});
afterEach(() => {
  if (saved === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = saved;
});

describe("the feature matrix is the source of truth", () => {
  it("gives every published feature a key", () => {
    for (const feature of FEATURES) {
      expect(feature.key, feature.label).toBeTruthy();
      expect(feature.key, feature.label).toMatch(/^[a-z][a-z0-9.-]*$/);
    }
  });

  it("never reuses a key", () => {
    expect(new Set(ENTITLEMENT_KEYS).size).toBe(ENTITLEMENT_KEYS.length);
  });

  it("covers every feature on the pricing page", () => {
    expect(ENTITLEMENT_KEYS.length).toBe(FEATURES.length);
  });
});

describe("tiers are cumulative", () => {
  const free = entitlementsFor("free");
  const pro = entitlementsFor("pro");
  const intelligent = entitlementsFor("intelligent");

  it("Pro includes everything Free includes", () => {
    for (const key of free) expect(pro.has(key), key).toBe(true);
  });

  it("Intelligent includes everything Free and Pro include", () => {
    for (const key of free) expect(intelligent.has(key), key).toBe(true);
    for (const key of pro) expect(intelligent.has(key), key).toBe(true);
  });

  it("each tier adds something the one below does not have", () => {
    expect(pro.size).toBeGreaterThan(free.size);
    expect(intelligent.size).toBeGreaterThan(pro.size);
  });

  it("Intelligent is the whole matrix", () => {
    expect(intelligent.size).toBe(FEATURES.length);
  });

  it("Free does not get the paid ones", () => {
    expect(planGrants("free", "budgets")).toBe(false);
    expect(planGrants("free", "goals")).toBe(false);
    expect(planGrants("free", "analytics")).toBe(false);
    expect(planGrants("free", "data.export")).toBe(false);
    expect(planGrants("free", "ai.queries")).toBe(false);
  });

  it("Pro gets the Pro ones and none of the Intelligent ones", () => {
    expect(planGrants("pro", "budgets")).toBe(true);
    expect(planGrants("pro", "goals")).toBe(true);
    expect(planGrants("pro", "analytics")).toBe(true);
    expect(planGrants("pro", "data.export")).toBe(true);
    expect(planGrants("pro", "ai.queries")).toBe(false);
    expect(planGrants("pro", "ai.insights")).toBe(false);
  });

  it("Intelligent gets all three tiers", () => {
    expect(planGrants("intelligent", "dashboard.basic")).toBe(true);
    expect(planGrants("intelligent", "budgets")).toBe(true);
    expect(planGrants("intelligent", "ai.queries")).toBe(true);
  });
});

describe("an unknown plan gets nothing", () => {
  it.each([["nonsense"], [""], [null], [undefined], ["PRO"], ["intelligent "]])(
    "grants no entitlement for %s",
    (planId) => {
      expect(entitlementsFor(planId).size).toBe(0);
      expect(planGrants(planId, "dashboard.basic")).toBe(false);
    }
  );

  it("refuses a protected feature for an unknown plan", () => {
    expect(() => requireEntitlement("nonsense", "budgets")).toThrow(EntitlementError);
  });

  // The whole point: a plan id arriving from anywhere untrusted is not a plan.
  it("does not grant anything for an object pretending to be a plan", () => {
    expect(planGrants({ id: "intelligent" }, "ai.queries")).toBe(false);
  });
});

describe("the gate", () => {
  it("passes a plan that includes the feature", () => {
    expect(() => requireEntitlement("pro", "budgets")).not.toThrow();
  });

  it("throws a 403 for one that does not", () => {
    try {
      requireEntitlement("pro", "ai.queries");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EntitlementError);
      expect(error.status).toBe(403);
      expect(error.entitlement).toBe("ai.queries");
    }
  });

  // A typo in a key must be loud. The dangerous alternative is a key nobody
  // has, which silently denies everyone -- or, after someone "fixes" that
  // with a default-allow, silently grants everyone.
  it("throws on an unknown key rather than guessing", () => {
    expect(() => requireEntitlement("intelligent", "budgetz")).toThrow(/Unknown entitlement key/);
  });

  it("does not deny while enforcement is off", () => {
    process.env.BILLING_ENFORCEMENT = "off";
    expect(() => requireEntitlement("free", "ai.queries")).not.toThrow();
    expect(enforcementEnabled()).toBe(false);
  });

  it.each([["on"], ["ON"], ["On"]])("enforces when set to %s", (value) => {
    process.env.BILLING_ENFORCEMENT = value;
    expect(enforcementEnabled()).toBe(true);
    expect(() => requireEntitlement("free", "ai.queries")).toThrow(EntitlementError);
  });

  it.each([["true"], ["1"], ["yes"], [""], ["off"]])(
    "does not enforce for the near-miss value %s",
    (value) => {
      process.env.BILLING_ENFORCEMENT = value;
      expect(enforcementEnabled()).toBe(false);
    }
  );
});

describe("upgrade prompts", () => {
  it("names the cheapest plan that includes a feature", () => {
    expect(smallestPlanWith("dashboard.basic")).toBe("free");
    expect(smallestPlanWith("budgets")).toBe("pro");
    expect(smallestPlanWith("ai.queries")).toBe("intelligent");
  });

  it("summarises a plan for the browser without being trusted by it", () => {
    const summary = entitlementSummary("pro");
    expect(summary.planId).toBe("pro");
    expect(summary.entitlements).toContain("budgets");
    expect(summary.entitlements).not.toContain("ai.queries");
    expect(typeof summary.enforced).toBe("boolean");
  });

  it("treats no plan as Free", () => {
    expect(entitlementSummary(null).planId).toBe("free");
  });
});

describe("the published table and the catalogue agree", () => {
  it("only references plan ids that exist", () => {
    const ids = new Set(PLANS.map((plan) => plan.id));
    for (const feature of FEATURES) {
      for (const id of feature.plans) {
        expect(ids.has(id), `${feature.key} -> ${id}`).toBe(true);
      }
    }
  });
});
