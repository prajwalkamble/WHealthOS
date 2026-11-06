import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@whealthos/database";
import { convertAmount, sumInCurrency, isSingleCurrency } from "@/lib/currency/convert";
import { MAX_RATE_AGE_DAYS, putRates, rateFor } from "@/lib/currency/rates/store";
import { PROVIDER } from "@/lib/currency/rates/provider";

const { Decimal } = Prisma;
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

// Converting money, against a real database.
//
// The rate table is reference data with its own row-level security, the
// lookup walks backwards to the newest fixing at or before a date, and the
// arithmetic is Decimal. None of that can be demonstrated against a fake, so
// none of it is.

// A day, as the DATE column stores one.
const day = (offsetDays = 0) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
};

// ECB-shaped figures: everything quoted against the euro.
const FIXING = { USD: 1.1267, INR: 106.6318, JPY: 178.3, GBP: 0.8346, KRW: 1500.5 };

const seed = (rates = FIXING, asOf = day(0)) =>
  putRates({ base: "EUR", asOf, source: PROVIDER, rates }, admin);

beforeEach(async () => {
  await admin.exchangeRate.deleteMany({});
});

afterAll(async () => {
  await admin.exchangeRate.deleteMany({});
  await admin.$disconnect();
  const { db, adminDb } = await import("@/lib/prisma");
  await db.$disconnect();
  await adminDb.$disconnect();
});

describe("storing what the provider said", () => {
  it("writes one row per currency per day", async () => {
    const { written } = await seed();
    expect(written.sort()).toEqual(Object.keys(FIXING).sort());
    expect(await admin.exchangeRate.count()).toBe(Object.keys(FIXING).length);
  });

  // The cron runs more often than the ECB publishes, so refetching a stored
  // day is the normal case and must not append a second opinion.
  it("updates rather than duplicating when the same day is fetched again", async () => {
    await seed();
    await seed({ ...FIXING, USD: 1.2 });
    expect(await admin.exchangeRate.count()).toBe(Object.keys(FIXING).length);
    const row = await admin.exchangeRate.findFirst({ where: { quote: "USD" } });
    expect(Number(row.rate)).toBeCloseTo(1.2, 10);
  });

  it("refuses a rate that is zero, negative or not a number", async () => {
    const { written } = await putRates(
      { base: "EUR", asOf: day(0), source: PROVIDER, rates: { USD: 0, INR: -5, JPY: "nonsense", GBP: 0.8346 } },
      admin
    );
    expect(written).toEqual(["GBP"]);
  });
});

describe("finding a rate", () => {
  it("is 1 between a currency and itself, with no row needed", async () => {
    const found = await rateFor("USD", "USD", { client: admin });
    expect(Number(found.rate)).toBe(1);
  });

  it("reads straight off the base currency", async () => {
    await seed();
    const found = await rateFor("EUR", "USD", { client: admin });
    expect(Number(found.rate)).toBeCloseTo(1.1267, 10);
  });

  it("inverts for the other direction", async () => {
    await seed();
    const found = await rateFor("USD", "EUR", { client: admin });
    expect(Number(found.rate)).toBeCloseTo(1 / 1.1267, 9);
  });

  // The case the EUR-based table exists to make cheap: neither side is EUR,
  // so the rate is one row divided by another.
  it("computes a cross-rate through the base currency", async () => {
    await seed();
    const found = await rateFor("INR", "USD", { client: admin });
    expect(Number(found.rate)).toBeCloseTo(1.1267 / 106.6318, 10);
  });

  // The ECB publishes on working days. Asking for a Sunday has to return
  // Friday's fixing, which is the rate that was in force.
  it("falls back to the newest fixing at or before the date asked for", async () => {
    await seed(FIXING, day(-3));
    const found = await rateFor("EUR", "USD", { on: day(0), client: admin });
    expect(found).not.toBeNull();
    expect(found.asOf.toISOString().slice(0, 10)).toBe(day(-3).toISOString().slice(0, 10));
  });

  it("does not use a rate published after the date asked for", async () => {
    await seed(FIXING, day(0));
    expect(await rateFor("EUR", "USD", { on: day(-5), client: admin })).toBeNull();
  });

  it("flags a rate older than the freshness window", async () => {
    await seed(FIXING, day(-(MAX_RATE_AGE_DAYS + 2)));
    const found = await rateFor("EUR", "USD", { client: admin });
    expect(found.stale).toBe(true);
  });

  it("does not flag a rate inside it", async () => {
    await seed(FIXING, day(-1));
    expect((await rateFor("EUR", "USD", { client: admin })).stale).toBe(false);
  });

  // Null, never 1. Falling back to parity would present an unconverted
  // figure as a converted one, which is worse than showing nothing.
  it("returns null rather than a fallback when nothing is stored", async () => {
    expect(await rateFor("INR", "USD", { client: admin })).toBeNull();
  });

  it("returns null for a currency the provider does not publish", async () => {
    await seed();
    expect(await rateFor("INR", "AED", { client: admin })).toBeNull();
    expect(await rateFor("SAR", "USD", { client: admin })).toBeNull();
  });
});

describe("converting one amount", () => {
  it("multiplies by the rate and rounds to the target's minor unit", async () => {
    await seed();
    const result = await convertAmount(50000, "INR", "USD", { client: admin });
    expect(result.converted).toBe(true);
    // 50,000 INR at 1.1267/106.6318 EUR-crossed.
    expect(Number(result.amount)).toBeCloseTo(50000 * (1.1267 / 106.6318), 2);
    expect(result.amount.decimalPlaces()).toBeLessThanOrEqual(2);
  });

  // A currency with no minor unit must not come back with decimals.
  it("rounds to whole units for a zero-decimal currency", async () => {
    await seed();
    const result = await convertAmount(50000, "INR", "JPY", { client: admin });
    expect(result.converted).toBe(true);
    expect(result.amount.decimalPlaces()).toBe(0);
  });

  it("is exact and rate-free between a currency and itself", async () => {
    const result = await convertAmount(1234.56, "INR", "INR", { client: admin });
    expect(Number(result.amount)).toBe(1234.56);
    expect(result.source).toBe("identity");
  });

  it("refuses rather than guessing when there is no rate", async () => {
    const result = await convertAmount(50000, "INR", "USD", { client: admin });
    expect(result.converted).toBe(false);
    expect(result.reason).toBe("no-rate");
    // The original amount comes back untouched, for a caller that will show it
    // in its own currency instead.
    expect(Number(result.amount)).toBe(50000);
  });

  it("refuses for a currency the provider does not publish", async () => {
    await seed();
    const result = await convertAmount(1000, "AED", "USD", { client: admin });
    expect(result.converted).toBe(false);
    expect(result.reason).toBe("not-convertible");
  });

  it("refuses an unsupported currency outright", async () => {
    const result = await convertAmount(1000, "XXX", "USD", { client: admin });
    expect(result.converted).toBe(false);
    expect(result.reason).toBe("unsupported-currency");
  });
});

describe("a consolidated total over several currencies", () => {
  const holdings = [
    { amount: 50000, currency: "INR" },
    { amount: 1000, currency: "USD" },
    { amount: 100000, currency: "JPY" },
  ];

  it("converts every component and sums them", async () => {
    await seed();
    const result = await sumInCurrency(holdings, "USD", { client: admin });
    expect(result.complete).toBe(true);
    const expected =
      50000 * (1.1267 / 106.6318) + 1000 + 100000 * (1.1267 / 178.3);
    expect(Number(result.total)).toBeCloseTo(expected, 1);
  });

  // §8, and the point of the whole exercise: a display currency changes what
  // is SHOWN. The amounts handed in are not touched.
  it("leaves every original amount and currency alone", async () => {
    await seed();
    const before = JSON.parse(JSON.stringify(holdings));
    await sumInCurrency(holdings, "USD", { client: admin });
    expect(holdings).toEqual(before);
  });

  it("reports each currency's own subtotal alongside the total", async () => {
    await seed();
    const result = await sumInCurrency(holdings, "USD", { client: admin });
    const inr = result.components.find((c) => c.currency === "INR");
    expect(Number(inr.amount)).toBe(50000);
    expect(Number(inr.converted)).toBeCloseTo(50000 * (1.1267 / 106.6318), 2);
  });

  // The rule that matters most. A total that silently drops the component it
  // could not convert looks right and is wrong.
  it("returns no total at all when any component cannot be converted", async () => {
    await seed();
    const result = await sumInCurrency(
      [...holdings, { amount: 500, currency: "AED" }],
      "USD",
      { client: admin }
    );
    expect(result.complete).toBe(false);
    expect(result.total).toBeNull();
    expect(result.unconvertible.map((u) => u.currency)).toEqual(["AED"]);
  });

  it("returns no total when the rate table is empty", async () => {
    const result = await sumInCurrency(holdings, "USD", { client: admin });
    expect(result.complete).toBe(false);
    expect(result.total).toBeNull();
  });

  it("needs no rate when everything is already in the target currency", async () => {
    const result = await sumInCurrency(
      [{ amount: 1, currency: "INR" }, { amount: 2, currency: "INR" }],
      "INR",
      { client: admin }
    );
    expect(result.complete).toBe(true);
    expect(Number(result.total)).toBe(3);
    expect(result.exact).toBe(true);
  });

  it("marks a total built from a stale rate", async () => {
    await seed(FIXING, day(-(MAX_RATE_AGE_DAYS + 2)));
    const result = await sumInCurrency(holdings, "USD", { client: admin });
    expect(result.complete).toBe(true);
    expect(result.stale).toBe(true);
  });

  // Grouping first means each currency is converted once from its own exact
  // subtotal, instead of accumulating a rounding error per row.
  it("converts once per currency, not once per row", async () => {
    await seed();
    const many = Array.from({ length: 300 }, () => ({ amount: 100, currency: "INR" }));
    const result = await sumInCurrency(many, "USD", { client: admin });
    expect(result.components).toHaveLength(1);
    expect(Number(result.components[0].amount)).toBe(30000);
  });

  it("knows when no conversion is needed at all", () => {
    expect(isSingleCurrency([{ amount: 1, currency: "INR" }], "INR")).toBe(true);
    expect(isSingleCurrency([{ amount: 1, currency: "USD" }], "INR")).toBe(false);
    expect(isSingleCurrency([], "INR")).toBe(true);
  });

  it("uses Decimal throughout rather than floating point", async () => {
    await seed();
    const result = await sumInCurrency(holdings, "USD", { client: admin });
    expect(result.total).toBeInstanceOf(Decimal);
  });
});
