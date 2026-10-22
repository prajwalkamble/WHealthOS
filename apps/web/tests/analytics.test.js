import { describe, it, expect } from "vitest";

const {
  change,
  periodTotals,
  categoryBreakdown,
  monthlyFlow,
  monthWindow,
  keyOf,
} = await import("@/lib/analytics");

const tx = (type, amount, category, date) => ({ type, amount, category, date: new Date(date) });

describe("percentage change", () => {
  it("reports a rise and a fall", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
  });

  it("reports no change as zero", () => {
    expect(change(100, 100)).toBe(0);
  });

  // The whole reason this helper exists. 0 -> 500 is not "infinite percent"
  // and it is certainly not 0%; it is a question with no numeric answer.
  it("returns null against a zero baseline rather than Infinity", () => {
    expect(change(500, 0)).toBeNull();
    expect(Number.isFinite(change(500, 0))).toBe(false);
  });

  it("returns null for a missing or non-numeric input", () => {
    expect(change(undefined, 100)).toBeNull();
    expect(change(100, undefined)).toBeNull();
    expect(change(NaN, 100)).toBeNull();
  });

  it("uses the magnitude of the baseline, so a negative one does not flip the sign", () => {
    expect(change(-50, -100)).toBe(50);
  });
});

describe("period totals", () => {
  it("separates income from expenses and nets them", () => {
    const t = periodTotals([
      tx("INCOME", 90000, "salary", "2026-10-01"),
      tx("EXPENSE", 24000, "housing", "2026-10-02"),
      tx("EXPENSE", 6000, "groceries", "2026-10-03"),
    ]);
    expect(t.income).toBe(90000);
    expect(t.expenses).toBe(30000);
    expect(t.net).toBe(60000);
    expect(t.savingsRate).toBeCloseTo(66.667, 2);
  });

  // Spending with no earnings is not a 0% savings rate.
  it("reports savings rate as null when there is no income", () => {
    const t = periodTotals([tx("EXPENSE", 5000, "food", "2026-10-02")]);
    expect(t.savingsRate).toBeNull();
    expect(t.net).toBe(-5000);
  });

  it("handles no transactions without producing NaN", () => {
    const t = periodTotals([]);
    expect(t).toMatchObject({ income: 0, expenses: 0, net: 0, savingsRate: null });
  });

  it("allows a negative savings rate when spending exceeds income", () => {
    const t = periodTotals([
      tx("INCOME", 10000, "salary", "2026-10-01"),
      tx("EXPENSE", 15000, "housing", "2026-10-02"),
    ]);
    expect(t.savingsRate).toBe(-50);
  });
});

describe("category breakdown", () => {
  const current = [
    tx("EXPENSE", 8000, "housing", "2026-10-02"),
    tx("EXPENSE", 2000, "groceries", "2026-10-03"),
    tx("EXPENSE", 2000, "groceries", "2026-10-04"),
    tx("INCOME", 50000, "salary", "2026-10-01"),
  ];
  const previous = [
    tx("EXPENSE", 10000, "housing", "2026-09-02"),
    tx("EXPENSE", 1500, "travel", "2026-09-06"),
  ];

  it("counts only expenses and sorts by amount", () => {
    const rows = categoryBreakdown(current, previous);
    expect(rows[0]).toMatchObject({ category: "housing", amount: 8000 });
    expect(rows.find((r) => r.category === "salary")).toBeUndefined();
  });

  it("sums repeated categories and counts their transactions", () => {
    const groceries = categoryBreakdown(current, previous).find(
      (r) => r.category === "groceries"
    );
    expect(groceries.amount).toBe(4000);
    expect(groceries.count).toBe(2);
  });

  it("shares sum to 100 across the period", () => {
    const rows = categoryBreakdown(current, previous).filter((r) => r.amount > 0);
    const total = rows.reduce((s, r) => s + r.share, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("keeps a category that stopped, so the comparison is not silently shorter", () => {
    const travel = categoryBreakdown(current, previous).find((r) => r.category === "travel");
    expect(travel.amount).toBe(0);
    expect(travel.previousAmount).toBe(1500);
    expect(travel.changePercent).toBe(-100);
  });

  it("gives a new category a null change rather than a fabricated one", () => {
    const groceries = categoryBreakdown(current, previous).find(
      (r) => r.category === "groceries"
    );
    expect(groceries.previousAmount).toBe(0);
    expect(groceries.changePercent).toBeNull();
  });

  it("does not divide by zero when nothing was spent", () => {
    const rows = categoryBreakdown([], previous);
    for (const row of rows) expect(Number.isNaN(row.share)).toBe(false);
  });
});

describe("monthly flow", () => {
  it("keeps quiet months in the series instead of dropping them", () => {
    const window = monthWindow(3, new Date("2026-10-15T00:00:00Z"));
    const rows = monthlyFlow(window, [tx("INCOME", 1000, "salary", "2026-10-05T06:00:00Z")]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => Number.isFinite(r.income) && Number.isFinite(r.expenses))).toBe(true);
  });

  it("nets income against expenses per month", () => {
    const window = monthWindow(1, new Date("2026-10-15T00:00:00Z"));
    const [row] = monthlyFlow(window, [
      tx("INCOME", 5000, "salary", "2026-10-05T06:00:00Z"),
      tx("EXPENSE", 2000, "food", "2026-10-06T06:00:00Z"),
    ]);
    expect(row.net).toBe(3000);
  });

  it("ignores a transaction outside the window", () => {
    const window = monthWindow(1, new Date("2026-10-15T00:00:00Z"));
    const [row] = monthlyFlow(window, [tx("EXPENSE", 999, "food", "2025-01-05T06:00:00Z")]);
    expect(row.expenses).toBe(0);
  });

  it("returns the window oldest first", () => {
    const window = monthWindow(3, new Date("2026-10-15T00:00:00Z"));
    expect(window.map(keyOf)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

// ---------------------------------------------------------------------------
// Cashflow

const {
  CASHFLOW_RANGES,
  DEFAULT_CASHFLOW_RANGE,
  DRAWN_FROM_BALANCES,
  POOL,
  SURPLUS,
  UNCATEGORIZED,
  cashflowDiagram,
  cashflowSummary,
  resolveCashflowRange,
} = await import("@/lib/analytics");

const { dayWindowBounds } = await import("@/lib/time");

const known = new Set(["salary", "freelance", "housing", "food"]);

describe("cashflow range", () => {
  it("accepts the ranges it offers", () => {
    for (const key of Object.keys(CASHFLOW_RANGES)) {
      expect(resolveCashflowRange(key)).toBe(key);
    }
  });

  // The key arrives from the query string, so it is whatever someone typed.
  it("falls back to the default for anything else", () => {
    expect(resolveCashflowRange("99Y")).toBe(DEFAULT_CASHFLOW_RANGE);
    expect(resolveCashflowRange(undefined)).toBe(DEFAULT_CASHFLOW_RANGE);
    expect(resolveCashflowRange("__proto__")).toBe(DEFAULT_CASHFLOW_RANGE);
    expect(resolveCashflowRange("constructor")).toBe(DEFAULT_CASHFLOW_RANGE);
  });
});

describe("cashflow window", () => {
  // Whole days on the app's clock, today included: 7D is today and the six
  // days before it, not a rolling 168 hours.
  it("covers whole days ending today", () => {
    const { from, to } = dayWindowBounds(7, new Date("2026-10-15T09:00:00Z"));
    expect(to.getTime() - from.getTime() + 1).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rolls back into the previous month", () => {
    const { from } = dayWindowBounds(7, new Date("2026-03-03T09:00:00Z"));
    expect(from.toISOString()).toBe("2026-02-24T18:30:00.000Z");
  });
});

describe("cashflow summary", () => {
  const rows = [
    tx("INCOME", 90000, "salary", "2026-10-05T06:00:00Z"),
    tx("INCOME", 10000, "freelance", "2026-10-07T06:00:00Z"),
    tx("EXPENSE", 30000, "housing", "2026-10-08T06:00:00Z"),
    tx("EXPENSE", 12000, "food", "2026-10-09T06:00:00Z"),
  ];

  it("groups each side by category, largest first", () => {
    const out = cashflowSummary(rows, { knownCategories: known });
    expect(out.sources.map((s) => s.key)).toEqual(["salary", "freelance"]);
    expect(out.destinations.map((d) => d.key)).toEqual(["housing", "food"]);
    expect(out.income).toBe(100000);
    expect(out.expenses).toBe(42000);
  });

  it("reports what was not spent as surplus", () => {
    const out = cashflowSummary(rows, { knownCategories: known });
    expect(out.net).toBe(58000);
    expect(out.surplus).toBe(58000);
    expect(out.drawnFromBalances).toBe(0);
  });

  // The period did not fund itself, and the chart must not say it did.
  it("reports a deficit as money drawn rather than as a negative surplus", () => {
    const out = cashflowSummary(
      [
        tx("INCOME", 10000, "salary", "2026-10-05T06:00:00Z"),
        tx("EXPENSE", 25000, "housing", "2026-10-08T06:00:00Z"),
      ],
      { knownCategories: known }
    );
    expect(out.net).toBe(-15000);
    expect(out.surplus).toBe(0);
    expect(out.drawnFromBalances).toBe(15000);
  });

  it("files an unknown or missing category as uncategorised", () => {
    const out = cashflowSummary(
      [
        tx("EXPENSE", 500, "not-a-category", "2026-10-08T06:00:00Z"),
        tx("EXPENSE", 300, "", "2026-10-08T06:00:00Z"),
        tx("EXPENSE", 200, null, "2026-10-08T06:00:00Z"),
      ],
      { knownCategories: known }
    );
    expect(out.destinations).toEqual([{ key: UNCATEGORIZED, amount: 1000 }]);
  });

  // A ribbon has no negative width, and quietly dropping the money would make
  // the two sides disagree with each other.
  it("excludes a category that nets to zero or less and keeps the sides balanced", () => {
    const out = cashflowSummary(
      [
        tx("INCOME", 5000, "salary", "2026-10-05T06:00:00Z"),
        tx("INCOME", 400, "freelance", "2026-10-06T06:00:00Z"),
        tx("INCOME", -400, "freelance", "2026-10-07T06:00:00Z"),
      ],
      { knownCategories: known }
    );
    expect(out.sources).toEqual([{ key: "salary", amount: 5000 }]);
    expect(out.excluded).toEqual([{ key: "freelance", amount: 0 }]);
    expect(out.income).toBe(5000);
  });

  it("has nothing to draw for an empty period", () => {
    const out = cashflowSummary([], { knownCategories: known });
    expect(out).toMatchObject({ income: 0, expenses: 0, net: 0, surplus: 0 });
    expect(cashflowDiagram(out)).toEqual({ nodes: [], links: [] });
  });
});

describe("cashflow diagram", () => {
  const diagramOf = (rows) =>
    cashflowDiagram(cashflowSummary(rows, { knownCategories: known }));

  it("routes every source into one pool and every expense out of it", () => {
    const { nodes, links } = diagramOf([
      tx("INCOME", 90000, "salary", "2026-10-05T06:00:00Z"),
      tx("INCOME", 10000, "freelance", "2026-10-06T06:00:00Z"),
      tx("EXPENSE", 30000, "housing", "2026-10-08T06:00:00Z"),
    ]);

    const pool = nodes.findIndex((n) => n.key === POOL);
    expect(nodes.map((n) => n.key)).toEqual([
      "salary",
      "freelance",
      POOL,
      "housing",
      SURPLUS,
    ]);
    // No link skips the pool: nothing claims a source paid a destination.
    for (const link of links) {
      expect(link.source === pool || link.target === pool).toBe(true);
    }
  });

  it("balances: what flows into the pool flows out of it", () => {
    const { nodes, links } = diagramOf([
      tx("INCOME", 70000, "salary", "2026-10-05T06:00:00Z"),
      tx("EXPENSE", 30000, "housing", "2026-10-08T06:00:00Z"),
      tx("EXPENSE", 12000, "food", "2026-10-09T06:00:00Z"),
    ]);
    const pool = nodes.findIndex((n) => n.key === POOL);
    const into = links.filter((l) => l.target === pool).reduce((s, l) => s + l.value, 0);
    const outOf = links.filter((l) => l.source === pool).reduce((s, l) => s + l.value, 0);
    expect(into).toBe(70000);
    expect(outOf).toBe(70000);
    expect(nodes[pool].amount).toBe(70000);
  });

  it("draws the shortfall as its own inflow and no surplus", () => {
    const { nodes, links } = diagramOf([
      tx("INCOME", 10000, "salary", "2026-10-05T06:00:00Z"),
      tx("EXPENSE", 25000, "housing", "2026-10-08T06:00:00Z"),
    ]);
    expect(nodes.map((n) => n.key)).toEqual([
      "salary",
      DRAWN_FROM_BALANCES,
      POOL,
      "housing",
    ]);
    const pool = nodes.findIndex((n) => n.key === POOL);
    const into = links.filter((l) => l.target === pool).reduce((s, l) => s + l.value, 0);
    expect(into).toBe(25000);
  });

  it("sends everything to surplus when there are no expenses", () => {
    const { nodes, links } = diagramOf([
      tx("INCOME", 8000, "salary", "2026-10-05T06:00:00Z"),
    ]);
    expect(nodes.map((n) => n.key)).toEqual(["salary", POOL, SURPLUS]);
    expect(links.every((l) => l.value === 8000)).toBe(true);
  });

  it("never emits a link with no width", () => {
    const { links } = diagramOf([
      tx("INCOME", 5000, "salary", "2026-10-05T06:00:00Z"),
      tx("EXPENSE", 5000, "housing", "2026-10-08T06:00:00Z"),
    ]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.value).toBeGreaterThan(0);
  });
});
