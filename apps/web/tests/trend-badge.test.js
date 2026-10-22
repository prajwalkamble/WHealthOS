import { describe, it, expect } from "vitest";

const { trendLabel, percentChange } = await import("@/components/dashboard/widget");

// The badge on every dashboard stat card. By default it is a percentage, the
// way it has always been. A caller opts in to `multiplier` when its value is a
// ratio that keeps its meaning past a doubling, so that a big rise reads as
// "4.9×" rather than "394%", which invites being read as a share of something.
describe("trendLabel", () => {
  it("treats a rounding artefact as no change", () => {
    expect(trendLabel(0)).toBe("0%");
    expect(trendLabel(0.04)).toBe("0%");
    expect(trendLabel(-0.04)).toBe("0%");
  });

  it("keeps ordinary changes as percentages, with one decimal", () => {
    expect(trendLabel(42.08)).toBe("42.1%");
    expect(trendLabel(-8.3)).toBe("8.3%");
    expect(trendLabel(99.9)).toBe("99.9%");
  });

  it("stays on percentages by default, however large the rise", () => {
    expect(trendLabel(107.6)).toBe("108%");
    expect(trendLabel(393.67)).toBe("394%");
    expect(trendLabel(1500)).toBe(">999%");
  });

  it("honours a custom suffix", () => {
    expect(trendLabel(12.5, { suffix: " pts" })).toBe("12.5 pts");
  });

  it("is defensive about a non-finite value", () => {
    expect(trendLabel(Number.NaN)).toBe("0%");
    expect(trendLabel(Number.POSITIVE_INFINITY)).toBe("0%");
  });
});

describe("trendLabel with multiplier", () => {
  const m = (value) => trendLabel(value, { multiplier: true });

  it("leaves anything below a doubling as a percentage", () => {
    expect(m(42.08)).toBe("42.1%");
    expect(m(99.9)).toBe("99.9%");
    expect(m(100)).toBe("100%");
  });

  it("switches to a multiple past a doubling", () => {
    expect(m(100.5)).toBe("2.0×");
    expect(m(150)).toBe("2.5×");
    expect(m(1150)).toBe("12.5×");
  });

  // The case that prompted this: October's ₹15,600 against September's ₹3,160.
  it("renders the expenses card's real figures as a multiple, not 394%", () => {
    const change = percentChange(15600, 3160);
    expect(change).toBeCloseTo(393.67, 1);
    expect(m(change)).toBe("4.9×");
  });

  it("never shows a percentage above 100 for a rise", () => {
    for (const value of [100.01, 120, 250, 999, 5000, 250000]) {
      const label = m(value);
      expect(label.endsWith("×"), `${value} -> ${label}`).toBe(true);
      expect(label).not.toMatch(/%/);
    }
  });

  it("drops the decimal once the multiple is large, and caps it", () => {
    expect(m(12400)).toBe("125×");
    expect(m(99800)).toBe("999×");
    expect(m(1000000)).toBe(">999×");
  });

  it("leaves a fall as a percentage, since a drop has no sensible multiple", () => {
    expect(m(-100)).toBe("100%");
    expect(m(-62.5)).toBe("62.5%");
    expect(m(-600)).toBe("600%");
  });
});

// Which card opts in is the whole behaviour here, so it is pinned. Expenses is
// the only ratio against the same measure last month; Total Balance is growth
// against the 1st, and Savings Rate's value is a difference in percentage
// points, where a multiple would be measuring the wrong thing entirely.
describe("stat cards wiring", () => {
  const read = async () => {
    const fs = await import("node:fs/promises");
    return fs.readFile(
      new URL("../app/(main)/dashboard/_components/stat-cards.jsx", import.meta.url),
      "utf8"
    );
  };

  // The badge builder for one card, from its function down to the next one.
  const badgeFor = (src, fn) => {
    const start = src.indexOf(`function ${fn}(`);
    expect(start, `${fn} not found`).toBeGreaterThan(-1);
    const next = src.indexOf("\nfunction ", start + 1);
    return src.slice(start, next === -1 ? src.length : next);
  };

  it("opts Expenses in", async () => {
    expect(badgeFor(await read(), "expensesBadge")).toMatch(/multiplier/);
  });

  for (const [card, fn] of [
    ["Total Balance", "balanceBadge"],
    ["Income", "incomeBadge"],
    ["Savings Rate", "savingsBadge"],
  ]) {
    it(`leaves ${card} on percentages`, async () => {
      expect(badgeFor(await read(), fn)).not.toMatch(/multiplier/);
    });
  }
});
