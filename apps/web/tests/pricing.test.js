import { describe, it, expect } from "vitest";
import { PLANS, YEARLY_DISCOUNT } from "@/data/pricing";
import { priceFor } from "@/app/(marketing)/pricing/_components/pricing-plans";

const plan = (id) => PLANS.find((p) => p.id === id);

describe("plan catalogue", () => {
  it("has the three tiers, with Pro highlighted", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "intelligent"]);
    expect(PLANS.map((p) => p.name)).toEqual(["Free", "Pro", "Intelligent"]);
    expect(PLANS.filter((p) => p.popular).map((p) => p.id)).toEqual(["pro"]);
  });

  it("only references plan ids that exist", async () => {
    const { FEATURE_GROUPS } = await import("@/data/pricing");
    const ids = new Set(PLANS.map((p) => p.id));
    for (const group of FEATURE_GROUPS) {
      for (const feature of group.features) {
        for (const id of feature.plans) {
          expect(ids.has(id), `${feature.label} -> ${id}`).toBe(true);
        }
      }
    }
  });
});

describe("priceFor", () => {
  it("shows the monthly price per month", () => {
    expect(priceFor(plan("pro"), "monthly")).toMatchObject({
      amount: 399,
      suffix: "/ month",
    });
    expect(priceFor(plan("intelligent"), "monthly")).toMatchObject({
      amount: 699,
      suffix: "/ month",
    });
  });

  it("charges twelve months less the discount, yearly", () => {
    const pro = priceFor(plan("pro"), "yearly");
    expect(pro.full).toBe(399 * 12); // 4788
    expect(pro.amount).toBe(3830); // 4788 less 20%
    expect(pro.suffix).toBe("/ year");

    const intelligent = priceFor(plan("intelligent"), "yearly");
    expect(intelligent.full).toBe(699 * 12); // 8388
    expect(intelligent.amount).toBe(6710); // 8388 less 20%
  });

  it("saves exactly the advertised percentage", () => {
    for (const id of ["pro", "intelligent"]) {
      const { full, amount } = priceFor(plan(id), "yearly");
      expect((full - amount) / full).toBeCloseTo(YEARLY_DISCOUNT, 3);
    }
  });

  it("strikes nothing through on the free plan", () => {
    const free = priceFor(plan("free"), "yearly");
    expect(free.amount).toBe(0);
    expect(free.full).toBeNull();
  });

  it("no longer spells the sum out", () => {
    // The multiplication used to be printed under the price; it is not any
    // more, so nothing should be carrying it.
    for (const id of ["free", "pro", "intelligent"]) {
      expect(priceFor(plan(id), "yearly").workings).toBeUndefined();
    }
  });
});
