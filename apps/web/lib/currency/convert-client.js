import { fractionDigitsOf, isConvertible, coerceCurrency } from "./registry.js";

// Converting money in the browser, exactly.
//
// This is the pure core: rates and an amount go in, a converted amount comes
// out, and nothing here touches a database, a network or React. The server
// uses it too (lib/currency/presentation.js), so there is one implementation
// of the arithmetic rather than one per environment that can drift.
//
// Why BigInt rather than `amount * rate`.
//
// A rate is a decimal with twelve places and an amount is money. Multiplying
// them as IEEE doubles gives 0.1 + 0.2 problems at the paisa: two screens
// computing the same total in a different order disagree in the last digit,
// and a sum of three converted subtotals does not equal the conversion of
// their sum. Integer arithmetic has neither property. There is no new
// dependency here -- BigInt is the language.
//
// What this does NOT fix: the amounts arriving from the loaders are already
// JavaScript numbers, because Prisma Decimals are serialised with .toNumber()
// at the boundary. The error that introduces is upstream of this file. What
// this guarantees is that the conversion step adds none of its own.

// Rates are carried as decimal strings and scaled to integers here. Twelve
// places matches the exchange_rates column, so nothing is lost in transit.
const RATE_PLACES = 12;
const RATE_SCALE = 10n ** BigInt(RATE_PLACES);

/**
 * A decimal string to a BigInt scaled by 10^12. Returns null for anything
 * that is not a positive finite decimal -- a rate that cannot be parsed must
 * stop a conversion, never default to 1.
 */
export function parseRate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;

  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "0".repeat(RATE_PLACES)).slice(0, RATE_PLACES);
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(padded || "0");
  return scaled > 0n ? scaled : null;
}

// Half-up rounding on a BigInt quotient, which is what money rounding is.
// BigInt division truncates towards zero, so the remainder decides, and the
// sign has to be carried by hand -- truncation on a negative number rounds
// the wrong way, which is how a refund ends up a paisa off.
const divideRounded = (numerator, denominator) => {
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const rounded = a % b * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
};

/**
 * The rate from one currency to another, derived from a base-quoted table.
 *
 * `rates` is {CODE: "decimal string"} quoted against `base`, exactly as the
 * provider publishes it. A cross-rate is one entry divided by another, which
 * is mathematically valid for reference rates and is why one row per currency
 * per day covers every pair.
 *
 * Returns a scaled BigInt, or null when either side is unavailable. Null is
 * the only honest answer for a missing rate.
 */
export function crossRate(rates, from, to, base = "EUR") {
  const source = coerceCurrency(from, null);
  const target = coerceCurrency(to, null);
  if (!source || !target) return null;
  if (source === target) return RATE_SCALE;
  if (!isConvertible(source) || !isConvertible(target)) return null;

  const numerator = target === base ? RATE_SCALE : parseRate(rates?.[target]);
  const denominator = source === base ? RATE_SCALE : parseRate(rates?.[source]);
  if (!numerator || !denominator) return null;

  return divideRounded(numerator * RATE_SCALE, denominator);
}

/**
 * Converts an amount, rounding to the target currency's own minor unit.
 *
 * The amount is taken to the SOURCE currency's minor unit first -- an exact
 * integer, since that is the precision the figure is actually held at -- and
 * every step after that is integer arithmetic.
 *
 * @param {number|string} amount  In major units.
 * @param {bigint} rate           Scaled by 10^12, from crossRate.
 */
export function convertWithRate(amount, rate, from, to) {
  const value = Number(amount);
  if (!Number.isFinite(value) || rate === null || rate === undefined) return null;

  const fromDigits = fractionDigitsOf(from);
  const toDigits = fractionDigitsOf(to);

  // Major -> minor, as an exact integer at the source currency's precision.
  const minor = BigInt(Math.round(value * 10 ** fromDigits));

  // minorOut = minor * rate * 10^toDigits / (RATE_SCALE * 10^fromDigits)
  const numerator = minor * rate * 10n ** BigInt(toDigits);
  const denominator = RATE_SCALE * 10n ** BigInt(fromDigits);
  const converted = divideRounded(numerator, denominator);

  // Back to major units for Intl, now at the target's own precision and so
  // exactly representable.
  return Number(converted) / 10 ** toDigits;
}

/**
 * The inverse of a scaled rate.
 *
 * For turning a figure a person typed in the currency they are READING back
 * into the currency the records are held in -- the guest demo does this when
 * somebody adds a transaction while viewing in yen.
 */
export function invertRate(rate) {
  if (!rate || rate <= 0n) return null;
  return divideRounded(RATE_SCALE * RATE_SCALE, rate);
}

export const CONVERSION = {
  EXACT: "exact",
  CONVERTED: "converted",
  NO_RATE: "no-rate",
  NOT_CONVERTIBLE: "not-convertible",
  MIXED_LEDGER: "mixed-ledger",
};

/**
 * The whole presentation decision, as a pure function of data the client
 * already holds.
 *
 * Identical on the server and in the browser, which is what lets a currency
 * change be a local state update: the client does not need to ask anybody
 * what to do, because it has the same inputs the server had.
 *
 * @param {object} input
 * @param {string[]} input.ledger   Currencies the person's accounts are in.
 * @param {string}   input.target   The currency they want to read in.
 * @param {object}   input.rates    {CODE: "decimal string"}, quoted against base.
 */
export function presentationFor({ ledger, target, rates, base = "EUR", asOf = null, stale = false }) {
  const to = coerceCurrency(target);
  const held = (ledger?.length ? ledger : [to]).map((code) => coerceCurrency(code));

  const refuse = (reason) => ({
    applies: false,
    // Format in what the records are actually in, never in what was asked
    // for. This is the line that separates converting from relabelling.
    currency: held[0],
    rate: null,
    from: held[0],
    target: to,
    exact: false,
    stale: false,
    asOf: null,
    reason,
    ledger: held,
  });

  // One scalar cannot convert a ledger holding two currencies.
  if (new Set(held).size > 1) return refuse(CONVERSION.MIXED_LEDGER);

  const from = held[0];

  if (from === to) {
    return {
      applies: true, currency: to, rate: RATE_SCALE, from, target: to,
      exact: true, stale: false, asOf: null, reason: null, ledger: held,
    };
  }

  if (!isConvertible(from) || !isConvertible(to)) {
    return refuse(CONVERSION.NOT_CONVERTIBLE);
  }

  const rate = crossRate(rates, from, to, base);
  if (!rate) return refuse(CONVERSION.NO_RATE);

  return {
    applies: true, currency: to, rate, from, target: to,
    exact: false, stale: Boolean(stale), asOf: asOf ?? null, reason: null, ledger: held,
  };
}
