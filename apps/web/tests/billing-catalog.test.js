import { describe, it, expect, afterEach } from "vitest";
import {
  CURRENCY,
  PAISE_PER_RUPEE,
  TAX_POLICY,
  catalogEntry,
  displayEntry,
  intervalLabel,
  planFeatures,
  providerPlanEnvName,
  renewalLabel,
  yearlySavingRupees,
} from "@/lib/billing/plans";
import { FEATURE_GROUPS, PLANS } from "@/data/pricing";

// The four variables a deployment configures. Set here rather than relied on,
// so the suite says the same thing on a machine with no Razorpay set up.
const PLAN_VARS = [
  "RAZORPAY_PLAN_PRO_MONTHLY",
  "RAZORPAY_PLAN_PRO_YEARLY",
  "RAZORPAY_PLAN_INTELLIGENT_MONTHLY",
  "RAZORPAY_PLAN_INTELLIGENT_YEARLY",
];

const configure = () => {
  for (const name of PLAN_VARS) process.env[name] = `plan_${name}`;
};

afterEach(() => {
  for (const name of PLAN_VARS) delete process.env[name];
});

describe("the catalogue entry a checkout page renders", () => {
  it("resolves one plan and interval into everything a review screen needs", () => {
    configure();
    const entry = catalogEntry("pro", "monthly");

    expect(entry).toMatchObject({
      planId: "pro",
      name: "Pro",
      interval: "monthly",
      intervalEnum: "MONTHLY",
      intervalLabel: "Monthly",
      renewal: "every month",
      currency: "INR",
      amountRupees: 399,
      amountPaise: 39900,
      providerPlanId: "plan_RAZORPAY_PLAN_PRO_MONTHLY",
      enabledForSale: true,
    });
    expect(entry.tagline).toBeTruthy();
    expect(entry.transactionLimit).toBeTruthy();
    expect(entry.totalCount).toBeGreaterThan(0);
  });

  // The amount is the one field on this screen that somebody can be charged
  // for being wrong about, so it is checked against the catalogue arithmetic
  // rather than against a number typed into this test twice.
  it.each([
    ["pro", "monthly", 399],
    ["pro", "yearly", 3830],
    ["intelligent", "monthly", 699],
    ["intelligent", "yearly", 6710],
  ])("prices %s %s at ₹%i", (planId, interval, rupees) => {
    configure();
    const entry = catalogEntry(planId, interval);
    expect(entry.amountRupees).toBe(rupees);
    expect(entry.amountPaise).toBe(rupees * PAISE_PER_RUPEE);
    expect(entry.currency).toBe(CURRENCY);
  });

  it("refuses what is not sold at all", () => {
    configure();
    expect(catalogEntry("free", "monthly")).toBeNull();
    expect(catalogEntry("admin", "monthly")).toBeNull();
    expect(catalogEntry("pro", "weekly")).toBeNull();
    expect(catalogEntry(null, null)).toBeNull();
  });

  // The difference the page depends on: "we do not sell that" is a bad URL,
  // "it is not configured" is a deployment that is not finished. Falling back
  // to another plan, or to another price, is not an option in either case.
  it("tells an unknown plan apart from an unconfigured one", () => {
    // Nothing configured: still a real plan, just not purchasable here.
    const entry = catalogEntry("pro", "monthly");
    expect(entry).not.toBeNull();
    expect(entry.enabledForSale).toBe(false);
    expect(entry.providerPlanId).toBeNull();
    // ...and the price is still the catalogue's, not a guess.
    expect(entry.amountRupees).toBe(399);
  });

  it("names the environment variable after the plan and interval", () => {
    expect(providerPlanEnvName("pro", "monthly")).toBe("RAZORPAY_PLAN_PRO_MONTHLY");
    expect(providerPlanEnvName("intelligent", "yearly")).toBe(
      "RAZORPAY_PLAN_INTELLIGENT_YEARLY"
    );
  });
});

describe("what crosses into the browser", () => {
  // The provider's plan id is configuration about this merchant account. It
  // is not a key secret, and leaking it is not a breach -- but a function
  // whose whole job is to drop it is the cheapest way to never find out.
  it("does not carry the provider plan id", () => {
    configure();
    const entry = catalogEntry("pro", "monthly");
    const display = displayEntry(entry);

    expect(entry.providerPlanId).toBe("plan_RAZORPAY_PLAN_PRO_MONTHLY");
    expect(display).not.toHaveProperty("providerPlanId");
    expect(JSON.stringify(display)).not.toContain("plan_RAZORPAY");
  });

  it("keeps everything the screen actually shows", () => {
    configure();
    const display = displayEntry(catalogEntry("intelligent", "yearly"));
    for (const field of [
      "name",
      "tagline",
      "amountRupees",
      "currency",
      "intervalLabel",
      "renewal",
      "features",
      "tax",
    ]) {
      expect(display, `displayEntry dropped ${field}`).toHaveProperty(field);
    }
  });

  it("survives being handed nothing", () => {
    expect(displayEntry(null)).toBeNull();
  });
});

describe("the benefits listed on the review screen", () => {
  // Read from the same feature matrix the pricing table renders and
  // lib/billing/entitlements.js authorises from. A separate list of selling
  // points would be a third place for the three to disagree.
  it("splits what a tier adds from what it inherits", () => {
    const pro = planFeatures("pro");
    const added = pro.added.map((feature) => feature.key);
    const inherited = pro.inherited.map((feature) => feature.key);

    expect(added).toContain("budgets");
    expect(added).toContain("goals");
    // Free has these, so Pro inherits rather than adds them.
    expect(inherited).toContain("dashboard.basic");
    expect(added).not.toContain("dashboard.basic");
    // Intelligent's are not Pro's.
    expect([...added, ...inherited]).not.toContain("ai.queries");
  });

  it("gives Intelligent everything Pro has", () => {
    const pro = planFeatures("pro");
    const intelligent = planFeatures("intelligent");
    const all = new Set([
      ...intelligent.added.map((f) => f.key),
      ...intelligent.inherited.map((f) => f.key),
    ]);

    for (const feature of [...pro.added, ...pro.inherited]) {
      expect(all.has(feature.key), `Intelligent lost ${feature.key}`).toBe(true);
    }
    expect(intelligent.added.map((f) => f.key)).toContain("ai.queries");
  });

  it("accounts for every feature the pricing table lists against a plan", () => {
    for (const plan of PLANS.filter((p) => p.monthly > 0)) {
      const { added, inherited } = planFeatures(plan.id);
      const listed = FEATURE_GROUPS.flatMap((group) =>
        group.features.filter((feature) => feature.plans.includes(plan.id))
      );
      expect(added.length + inherited.length, `${plan.id} feature count`).toBe(
        listed.length
      );
    }
  });

  it("has nothing to say about the free tier", () => {
    expect(planFeatures("free")).toEqual({ added: [], inherited: [] });
    expect(planFeatures("nonsense")).toEqual({ added: [], inherited: [] });
  });
});

describe("the yearly saving, and the tax line", () => {
  it("is the difference against twelve monthly payments", () => {
    // Pro: ₹399 x 12 = ₹4,788, charged at ₹3,830.
    expect(yearlySavingRupees("pro")).toBe(399 * 12 - 3830);
    expect(yearlySavingRupees("intelligent")).toBe(699 * 12 - 6710);
    expect(yearlySavingRupees("free")).toBeNull();
  });

  it("is only claimed on the entry that is actually yearly", () => {
    configure();
    expect(catalogEntry("pro", "yearly").savingRupees).toBe(958);
    expect(catalogEntry("pro", "monthly").savingRupees).toBeNull();
  });

  // No tax is calculated anywhere in this application, so the page must not
  // imply one is. If that ever changes, it changes here and the review page
  // and the order summary both follow.
  it("says the amount shown is the whole of it", () => {
    expect(TAX_POLICY.inclusive).toBe(true);
    expect(TAX_POLICY.note).toMatch(/full amount/i);
    configure();
    expect(catalogEntry("pro", "monthly").tax).toBe(TAX_POLICY);
  });

  it("labels the intervals the way the screen reads them", () => {
    expect(intervalLabel("monthly")).toBe("Monthly");
    expect(intervalLabel("yearly")).toBe("Yearly");
    expect(intervalLabel("weekly")).toBeNull();
    expect(renewalLabel("monthly")).toBe("every month");
    expect(renewalLabel("yearly")).toBe("every 12 months");
    expect(renewalLabel("weekly")).toBeNull();
  });
});
