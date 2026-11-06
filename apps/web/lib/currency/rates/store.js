import { Prisma } from "@whealthos/database";
import { adminDb, db } from "@/lib/prisma";
import { RATE_BASE, coerceCurrency, isConvertible } from "../registry.js";
import { PROVIDER } from "./provider.js";

const { Decimal } = Prisma;

// Reading and writing exchange rates.
//
// Every rate in the table is quoted against RATE_BASE, because that is what
// the provider publishes: one row per currency per day covers every pair, and
// anything else is a cross-rate computed from two rows. Storing all 156
// ordered pairs instead would be 156 chances for two of them to disagree.
//
// Arithmetic is Decimal throughout -- never a JavaScript number. A rate
// multiplied into a balance in floating point is how a net-worth figure ends
// up ending in .9999999997, and how two screens showing the same total
// disagree in the last paisa.

// How old a rate may be before it is called stale.
//
// Four days, not one. The ECB publishes on working days only, so a Monday
// morning is legitimately reading Friday's fixing, and a long weekend
// stretches that further. Shorter than this and every bank holiday looks like
// an outage.
export const MAX_RATE_AGE_DAYS = 4;

const DAY_MS = 86_400_000;

// Midnight UTC for a date, which is how a DATE column compares.
const dayOf = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/**
 * Writes one provider response.
 *
 * Upserts rather than inserts: refetching a day that is already stored is
 * normal -- the cron runs more often than the ECB publishes -- and must
 * update the row rather than fail or append a second opinion.
 */
export async function putRates({ base, asOf, source, rates }, client = adminDb) {
  const day = dayOf(asOf);
  if (!day) throw new Error("putRates: unusable date");

  const written = [];
  for (const [quote, value] of Object.entries(rates)) {
    if (!isConvertible(quote)) continue;
    // Decimal THROWS on an unparseable value rather than yielding NaN, so
    // the guard below would never have run for a string like "nonsense" --
    // and one bad entry would have aborted the whole refresh instead of
    // being skipped. The provider validates too; this defends the store,
    // which is a public function and the last gate before a number that
    // multiplies somebody's net worth is written down.
    let rate;
    try {
      rate = new Decimal(String(value));
    } catch {
      continue;
    }
    if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) continue;

    await client.exchangeRate.upsert({
      where: {
        base_quote_asOf_source: { base, quote, asOf: day, source },
      },
      update: { rate, fetchedAt: new Date() },
      create: { base, quote, rate, source, asOf: day, fetchedAt: new Date() },
    });
    written.push(quote);
  }
  return { asOf: day, written };
}

// The newest stored rate for a pair at or before a date.
//
// `lte` rather than an exact match on purpose: asking for Sunday's rate
// should return Friday's fixing, which is the rate that was in force, rather
// than nothing.
const lookup = async (quote, on, client) => {
  const row = await client.exchangeRate.findFirst({
    where: { base: RATE_BASE, quote, source: PROVIDER, asOf: { lte: on } },
    orderBy: { asOf: "desc" },
    select: { rate: true, asOf: true, source: true },
  });
  return row ?? null;
};

/**
 * The rate to multiply a `from` amount by to get `to`, as a Decimal.
 *
 * Returns null -- never a guess, never 1 -- when there is no rate. A missing
 * rate has to stop a conversion: silently falling back to 1 would present an
 * unconverted figure as a converted one, which is worse than showing nothing.
 *
 * @returns {Promise<{rate: import("@prisma/client").Prisma.Decimal, asOf: Date, source: string, stale: boolean} | null>}
 */
export async function rateFor(from, to, { on = new Date(), client = db } = {}) {
  const base = coerceCurrency(from, null);
  const quote = coerceCurrency(to, null);
  if (!base || !quote) return null;

  const day = dayOf(on) ?? dayOf(new Date());

  if (base === quote) {
    return { rate: new Decimal(1), asOf: day, source: "identity", stale: false };
  }
  if (!isConvertible(base) || !isConvertible(quote)) return null;

  // EUR is the base everything is quoted against, so one of the two sides is
  // often a straight read.
  const [fromRow, toRow] = await Promise.all([
    base === RATE_BASE ? null : lookup(base, day, client),
    quote === RATE_BASE ? null : lookup(quote, day, client),
  ]);

  if (base !== RATE_BASE && !fromRow) return null;
  if (quote !== RATE_BASE && !toRow) return null;

  // rate(from → to) = rate(EUR → to) / rate(EUR → from).
  const numerator = quote === RATE_BASE ? new Decimal(1) : new Decimal(toRow.rate);
  const denominator = base === RATE_BASE ? new Decimal(1) : new Decimal(fromRow.rate);
  if (denominator.isZero()) return null;

  const asOf = [fromRow?.asOf, toRow?.asOf].filter(Boolean).sort((a, b) => a - b)[0] ?? day;

  return {
    // Twelve places matches the column. Enough that a JPY/KRW cross-rate
    // keeps its significant digits, which a money-scaled Decimal would round
    // away before the multiplication ever happened.
    rate: numerator.div(denominator).toDecimalPlaces(12),
    asOf,
    source: PROVIDER,
    stale: Date.now() - asOf.getTime() > MAX_RATE_AGE_DAYS * DAY_MS,
  };
}

/** The most recent fixing stored, for a freshness indicator. */
export async function latestAsOf(client = db) {
  const row = await client.exchangeRate.findFirst({
    where: { source: PROVIDER },
    orderBy: { asOf: "desc" },
    select: { asOf: true, fetchedAt: true },
  });
  return row ?? null;
}

/**
 * Every current rate, as plain serialisable data for the browser.
 *
 * This is what makes a currency change a local state update rather than a
 * round trip: the client is handed the same table the server would consult,
 * once per page load, and can then derive any cross-rate itself.
 *
 * It is small -- ten currencies, one decimal string each -- and it is public
 * reference data, not anybody's financial information. Rates are returned as
 * STRINGS so the twelve decimal places survive JSON intact; a Decimal
 * serialised as a float would lose digits before the browser ever saw it.
 *
 * `asOf` is the newest fixing stored. Rates from different days are not
 * mixed: a cross-rate computed from Monday's EUR/USD and Friday's EUR/INR
 * would be a number no provider ever published.
 */
export async function rateTable({ on = new Date(), client = db } = {}) {
  const day = dayOf(on) ?? dayOf(new Date());

  const newest = await client.exchangeRate.findFirst({
    where: { base: RATE_BASE, source: PROVIDER, asOf: { lte: day } },
    orderBy: { asOf: "desc" },
    select: { asOf: true },
  });

  if (!newest) {
    return { base: RATE_BASE, rates: {}, asOf: null, source: PROVIDER, stale: true };
  }

  const rows = await client.exchangeRate.findMany({
    where: { base: RATE_BASE, source: PROVIDER, asOf: newest.asOf },
    select: { quote: true, rate: true },
  });

  return {
    base: RATE_BASE,
    rates: Object.fromEntries(rows.map((row) => [row.quote, row.rate.toString()])),
    asOf: newest.asOf.toISOString().slice(0, 10),
    source: PROVIDER,
    stale: Date.now() - newest.asOf.getTime() > MAX_RATE_AGE_DAYS * DAY_MS,
  };
}
