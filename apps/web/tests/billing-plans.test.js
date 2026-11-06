import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PLANS } from "@/data/pricing";
import { priceFor } from "@/app/(marketing)/pricing/_components/pricing-plans";
import {
  CURRENCY,
  FREE_PLAN_ID,
  INTERVALS,
  PAISE_PER_RUPEE,
  amountPaiseFor,
  intervalEnum,
  isPurchasable,
  paidPlanIds,
  planById,
  providerPlanEnvName,
  rankOf,
  resolvePurchase,
  rupeesFor,
  totalCountFor,
} from "@/lib/billing/plans";

const ENV = [
  "RAZORPAY_PLAN_PRO_MONTHLY",
  "RAZORPAY_PLAN_PRO_YEARLY",
  "RAZORPAY_PLAN_INTELLIGENT_MONTHLY",
  "RAZORPAY_PLAN_INTELLIGENT_YEARLY",
];

let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
  for (const key of ENV) process.env[key] = `plan_${key.toLowerCase()}`;
});
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("what is sold", () => {
  it("sells the paid tiers and not the free one", () => {
    expect(paidPlanIds()).toEqual(["pro", "intelligent"]);
    expect(planById(FREE_PLAN_ID)).toBeNull();
    expect(planById("nonsense")).toBeNull();
  });

  it("offers both intervals the pricing page offers", () => {
    expect(INTERVALS).toEqual(["monthly", "yearly"]);
    expect(intervalEnum("monthly")).toBe("MONTHLY");
    expect(intervalEnum("yearly")).toBe("YEARLY");
  });

  it("ranks the tiers so an upgrade is recognisable", () => {
    expect(rankOf(FREE_PLAN_ID)).toBe(0);
    expect(rankOf("pro")).toBe(1);
    expect(rankOf("intelligent")).toBe(2);
    expect(rankOf("nonsense")).toBe(-1);
    expect(rankOf("intelligent")).toBeGreaterThan(rankOf("pro"));
  });

  it("prices in rupees", () => {
    expect(CURRENCY).toBe("INR");
  });
});

// The guard against the one real duplication in this integration: the price a
// person is SHOWN comes from the pricing page's client component, and the
// price they are CHARGED comes from the server. They cannot share an
// implementation, so they are checked against each other.
describe("the server charges what the page displays", () => {
  it.each(PLANS.filter((plan) => plan.monthly > 0).flatMap((plan) =>
    INTERVALS.map((interval) => [plan.id, interval])
  ))("agrees for %s %s", (planId, interval) => {
    const plan = PLANS.find((p) => p.id === planId);
    expect(rupeesFor(plan, interval)).toBe(priceFor(plan, interval).amount);
  });

  it("converts to whole paise", () => {
    for (const planId of paidPlanIds()) {
      for (const interval of INTERVALS) {
        const paise = amountPaiseFor(planId, interval);
        expect(Number.isSafeInteger(paise)).toBe(true);
        expect(paise).toBe(rupeesFor(planById(planId), interval) * PAISE_PER_RUPEE);
      }
    }
  });

  it("refuses a plan or interval it does not sell", () => {
    expect(amountPaiseFor(FREE_PLAN_ID, "monthly")).toBeNull();
    expect(amountPaiseFor("pro", "weekly")).toBeNull();
    expect(amountPaiseFor("nonsense", "monthly")).toBeNull();
    expect(rupeesFor(null, "monthly")).toBeNull();
  });
});

describe("the provider's plan ids are configuration, not guesses", () => {
  it("names one variable per plan and interval", () => {
    expect(providerPlanEnvName("pro", "monthly")).toBe("RAZORPAY_PLAN_PRO_MONTHLY");
    expect(providerPlanEnvName("intelligent", "yearly")).toBe(
      "RAZORPAY_PLAN_INTELLIGENT_YEARLY"
    );
  });

  it("resolves everything commercially significant in one lookup", () => {
    const purchase = resolvePurchase("pro", "yearly");
    expect(purchase).toMatchObject({
      planId: "pro",
      interval: "yearly",
      intervalEnum: "YEARLY",
      currency: "INR",
      providerPlanId: "plan_razorpay_plan_pro_yearly",
    });
    expect(purchase.amount).toBe(rupeesFor(planById("pro"), "yearly") * PAISE_PER_RUPEE);
  });

  // The failure that matters: an unconfigured plan must be unbuyable, not
  // billable at whatever Razorpay plan happens to be lying around.
  it("makes a plan with no provider id unbuyable", () => {
    delete process.env.RAZORPAY_PLAN_PRO_MONTHLY;
    expect(isPurchasable("pro", "monthly")).toBe(false);
    expect(resolvePurchase("pro", "monthly")).toBeNull();
    // And does not take the others down with it.
    expect(isPurchasable("pro", "yearly")).toBe(true);
  });

  it("never sells the free plan whatever is configured", () => {
    process.env.RAZORPAY_PLAN_FREE_MONTHLY = "plan_free";
    expect(isPurchasable(FREE_PLAN_ID, "monthly")).toBe(false);
    expect(resolvePurchase(FREE_PLAN_ID, "monthly")).toBeNull();
    delete process.env.RAZORPAY_PLAN_FREE_MONTHLY;
  });
});

describe("the plan-creation script and the server agree", () => {
  // scripts/development/razorpay-plans.mjs creates the Razorpay Plans the
  // subscriptions bill against. It cannot import lib/billing/plans.js -- that
  // resolves through the "@/" alias, which only Next and vitest know about --
  // so it repeats the yearly arithmetic.
  //
  // Which is exactly the kind of duplication that drifts. If the script
  // created a plan at one price and the server quoted another, the person
  // would be shown one figure and charged the other, and nothing else would
  // notice.
  it("derives the same amount for every plan and interval", async () => {
    const { planSpecs } = await import(
      "../../../scripts/development/razorpay-plans.mjs"
    );

    const specs = planSpecs();
    expect(specs).toHaveLength(paidPlanIds().length * INTERVALS.length);

    for (const spec of specs) {
      expect(spec.amountPaise, `${spec.planId} ${spec.interval}`).toBe(
        rupeesFor(planById(spec.planId), spec.interval) * PAISE_PER_RUPEE
      );
    }
  });

  it("names the variables the server reads", async () => {
    const { planSpecs } = await import(
      "../../../scripts/development/razorpay-plans.mjs"
    );
    for (const spec of planSpecs()) {
      expect(spec.envName).toBe(providerPlanEnvName(spec.planId, spec.interval));
    }
  });

  it("never offers to create a plan for the free tier", async () => {
    const { planSpecs } = await import(
      "../../../scripts/development/razorpay-plans.mjs"
    );
    expect(planSpecs().map((spec) => spec.planId)).not.toContain(FREE_PLAN_ID);
  });
});

describe("the subscription horizon", () => {
  it("is a real number of cycles, not a pretence of forever", () => {
    expect(totalCountFor("monthly")).toBe(120);
    expect(totalCountFor("yearly")).toBe(10);
    // Ten years either way, so neither interval quietly ends sooner.
    expect(totalCountFor("monthly") / 12).toBe(totalCountFor("yearly"));
  });
});
