import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@whealthos/database";
import { randomUUID } from "node:crypto";

// How a signed-in page decides what to show.
//
// The question this answers is the one the whole feature turns on: given what
// this person's accounts are held in and what they want to read in, do we
// convert, and if not, what do we show instead? Getting it wrong in the
// permissive direction relabels a balance.

let currentClerkId = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: currentClerkId }),
  currentUser: async () => null,
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn) => fn,
}));

const { displayConversion, ledgerCurrencies } = await import("@/lib/currency/presentation");
const { convertWithRate, presentationFor } = await import("@/lib/currency/convert-client");
const { putRates } = await import("@/lib/currency/rates/store");
const { PROVIDER } = await import("@/lib/currency/rates/provider");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

const today = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

const FIXING = { USD: 1.1224, INR: 106.0395, JPY: 177.85, GBP: 0.83393 };

let user;

const makeUser = () =>
  admin.user.create({
    data: {
      clerkUserId: `clerk_pres_${randomUUID()}`,
      email: `pres-${randomUUID()}@example.test`,
      name: "Presentation",
      imageUrl: "https://example.test/a.png",
    },
  });

const account = (currency, balance = 1000) =>
  admin.account.create({
    data: { name: `${currency} account`, type: "CURRENT", balance, currency, userId: user.id },
  });

beforeEach(async () => {
  await admin.exchangeRate.deleteMany({});
  await admin.account.deleteMany({ where: { user: { email: { contains: "@example.test" } } } });
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
  user = await makeUser();
  currentClerkId = user.clerkUserId;
});

afterAll(async () => {
  await admin.exchangeRate.deleteMany({});
  await admin.account.deleteMany({ where: { user: { email: { contains: "@example.test" } } } });
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
  await admin.$disconnect();
  const { db, adminDb } = await import("@/lib/prisma");
  await db.$disconnect();
  await adminDb.$disconnect();
});

const seed = () => putRates({ base: "EUR", asOf: today(), source: PROVIDER, rates: FIXING }, admin);

describe("what the ledger is held in", () => {
  it("defaults to the application currency when there are no accounts", async () => {
    expect(await ledgerCurrencies(user.id)).toEqual(["INR"]);
  });

  it("reports one currency when every account shares it", async () => {
    await account("INR");
    await account("INR");
    expect(await ledgerCurrencies(user.id)).toEqual(["INR"]);
  });

  it("reports each distinct currency when they differ", async () => {
    await account("INR");
    await account("USD");
    expect((await ledgerCurrencies(user.id)).sort()).toEqual(["INR", "USD"]);
  });
});

describe("deciding whether to convert", () => {
  it("converts when there is one ledger currency and a rate", async () => {
    await account("INR");
    await seed();
    const result = await displayConversion(user.id, "USD");

    expect(result.applies).toBe(true);
    expect(result.currency).toBe("USD");
    expect(result.exact).toBe(false);
    expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Asserted through convert() rather than a scale factor. The arithmetic is
  // integer now -- there is deliberately no float multiplier to reach for --
  // and what matters is the figure that comes out, not how it was reached.
  it("converts a balance correctly", async () => {
    await account("INR", 50000);
    await seed();
    const { convert } = await displayConversion(user.id, "USD");
    expect(convert(50000)).toBeCloseTo(50000 * (1.1224 / 106.0395), 2);
  });

  // Server and browser run the same pure decision over the same data, so a
  // server-rendered figure and the one the client re-renders must agree.
  it("agrees with the conversion the browser would compute", async () => {
    await account("INR", 50000);
    await seed();
    const { convert } = await displayConversion(user.id, "JPY");

    const local = presentationFor({
      ledger: ["INR"],
      target: "JPY",
      rates: { INR: "106.0395", JPY: "177.85" },
    });
    expect(convert(50000)).toBe(
      convertWithRate(50000, local.rate, local.from, local.currency)
    );
  });

  it("needs no rate and no conversion when it is already that currency", async () => {
    await account("INR");
    const result = await displayConversion(user.id, "INR");
    expect(result.applies).toBe(true);
    expect(result.exact).toBe(true);
    // Exact means untouched, not multiplied by one.
    expect(result.convert(1234.56)).toBe(1234.56);
    expect(result.asOf).toBeNull();
  });
});

// Every one of these must format in the LEDGER's currency, never the chosen
// one. That is the difference between converting and relabelling.
describe("refusing to convert", () => {
  it("refuses, and formats in the ledger currency, when no rate is stored", async () => {
    await account("INR");
    const result = await displayConversion(user.id, "USD");

    expect(result.applies).toBe(false);
    expect(result.reason).toBe("no-rate");
    // Refusing must leave the figure untouched, not scale it by something.
    expect(result.convert(50000)).toBe(50000);
    // The guard: NOT "USD".
    expect(result.currency).toBe("INR");
    expect(result.target).toBe("USD");
  });

  it("refuses for a currency the rate provider does not publish", async () => {
    await account("INR");
    await seed();
    const result = await displayConversion(user.id, "AED");
    expect(result.applies).toBe(false);
    expect(result.currency).toBe("INR");
  });

  // A single scalar cannot convert a mixed ledger. Approximating one would be
  // the most expensive kind of wrong: a confident total.
  it("refuses when the accounts are held in more than one currency", async () => {
    await account("INR");
    await account("USD");
    await seed();
    const result = await displayConversion(user.id, "GBP");

    expect(result.applies).toBe(false);
    expect(result.reason).toBe("mixed-ledger");
    expect(result.convert(50000)).toBe(50000);
    expect(result.ledger.sort()).toEqual(["INR", "USD"]);
  });

  it("never changes a number when it refuses", async () => {
    await account("INR");
    await account("JPY");
    for (const target of ["USD", "GBP", "AED", "JPY"]) {
      const result = await displayConversion(user.id, target);
      if (!result.applies) expect(result.convert(1234.56), target).toBe(1234.56);
    }
  });

  it("falls back safely for an unsupported currency code", async () => {
    await account("INR");
    await seed();
    const result = await displayConversion(user.id, "XXX");
    // Coerced to the default, which the ledger already is, so it is exact.
    expect(result.currency).toBe("INR");
  });
});

describe("staleness", () => {
  it("passes the rate's age through so a page can say so", async () => {
    await account("INR");
    const old = new Date(today().getTime() - 10 * 86_400_000);
    await putRates({ base: "EUR", asOf: old, source: PROVIDER, rates: FIXING }, admin);

    const result = await displayConversion(user.id, "USD");
    expect(result.applies).toBe(true);
    expect(result.stale).toBe(true);
  });
});
