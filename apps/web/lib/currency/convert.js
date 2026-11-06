import { Prisma } from "@whealthos/database";
import { coerceCurrency, fractionDigitsOf, isConvertible } from "./registry.js";
import { rateFor } from "./rates/store.js";

const { Decimal } = Prisma;

// Converting money, and refusing to when it cannot be done honestly.
//
// The rule this file exists to hold: a converted figure is only ever shown
// when there is a real rate behind every part of it. There is no fallback
// rate, no "assume parity", and no dropping the components that could not be
// converted and totalling the rest -- a total that silently omits a yen
// account is worse than no total, because it looks right.
//
// So a mixed-currency sum has two possible answers: one converted figure, or
// the per-currency breakdown with an explanation. Callers render whichever
// came back; they never have to decide.
//
// All arithmetic is Decimal. §18.8, and the practical version of it: a rate
// applied in floating point gives a net worth ending in .99999999997, and two
// screens computing the same total in different orders disagree.

export const CONVERSION_UNAVAILABLE = {
  NO_RATE: "no-rate",
  UNSUPPORTED_CURRENCY: "unsupported-currency",
  NOT_CONVERTIBLE: "not-convertible",
};

const toDecimal = (value) => {
  if (value instanceof Decimal) return value;
  if (value === null || value === undefined || value === "") return new Decimal(0);
  try {
    return new Decimal(typeof value === "number" ? String(value) : String(value));
  } catch {
    return new Decimal(0);
  }
};

/**
 * One amount, from one currency to another.
 *
 * @returns {Promise<{converted: true, amount: Decimal, rate, asOf, source, stale}
 *                 | {converted: false, reason: string, amount: Decimal, currency: string}>}
 */
export async function convertAmount(amount, from, to, { on = new Date(), client } = {}) {
  const source = coerceCurrency(from, null);
  const target = coerceCurrency(to, null);
  const value = toDecimal(amount);

  if (!source || !target) {
    return { converted: false, reason: CONVERSION_UNAVAILABLE.UNSUPPORTED_CURRENCY, amount: value, currency: from };
  }
  if (source === target) {
    return { converted: true, amount: value, rate: new Decimal(1), asOf: null, source: "identity", stale: false };
  }
  if (!isConvertible(source) || !isConvertible(target)) {
    // AED and SAR today: the ECB does not publish them. Formatting them is
    // fine, converting them would mean inventing the rate.
    return { converted: false, reason: CONVERSION_UNAVAILABLE.NOT_CONVERTIBLE, amount: value, currency: source };
  }

  const found = await rateFor(source, target, { on, ...(client ? { client } : {}) });
  if (!found) {
    return { converted: false, reason: CONVERSION_UNAVAILABLE.NO_RATE, amount: value, currency: source };
  }

  return {
    converted: true,
    // Rounded to the target currency's own minor unit, and rounded once --
    // at the end of this multiplication, not at every step of a sum.
    amount: value.mul(found.rate).toDecimalPlaces(fractionDigitsOf(target), Decimal.ROUND_HALF_UP),
    rate: found.rate,
    asOf: found.asOf,
    source: found.source,
    stale: found.stale,
  };
}

/**
 * A consolidated total over amounts held in several currencies.
 *
 * Components are grouped by currency first, so a thousand transactions in
 * three currencies costs three rate lookups rather than a thousand -- and so
 * each currency is converted once, from its own exact subtotal, rather than
 * accumulating a rounding error per row.
 *
 * @param {Array<{amount: unknown, currency: string}>} entries
 * @param {string} target
 */
export async function sumInCurrency(entries, target, { on = new Date(), client } = {}) {
  const to = coerceCurrency(target);
  const subtotals = new Map();

  for (const entry of entries ?? []) {
    const currency = coerceCurrency(entry?.currency);
    const running = subtotals.get(currency) ?? new Decimal(0);
    subtotals.set(currency, running.plus(toDecimal(entry?.amount)));
  }

  const components = [];
  const unconvertible = [];
  let total = new Decimal(0);
  let complete = true;
  let stale = false;
  let asOf = null;

  for (const [currency, subtotal] of subtotals) {
    const result = await convertAmount(subtotal, currency, to, { on, client });
    if (result.converted) {
      total = total.plus(result.amount);
      stale = stale || result.stale;
      if (result.asOf && (!asOf || result.asOf < asOf)) asOf = result.asOf;
      components.push({
        currency,
        amount: subtotal,
        converted: result.amount,
        rate: result.rate,
        asOf: result.asOf,
      });
    } else {
      complete = false;
      unconvertible.push({ currency, amount: subtotal, reason: result.reason });
      components.push({ currency, amount: subtotal, converted: null, rate: null, asOf: null });
    }
  }

  return {
    target: to,
    // Null unless every component converted. A caller cannot accidentally
    // print a partial sum as if it were the whole.
    total: complete ? total.toDecimalPlaces(fractionDigitsOf(to), Decimal.ROUND_HALF_UP) : null,
    complete,
    components,
    unconvertible,
    // True when any rate used is older than the store's freshness window.
    // The figure is still the best available; the UI says it is not current.
    stale,
    asOf,
    // Nothing to convert at all, or everything already in the target: these
    // are "complete" but no rate was involved, and a freshness note would be
    // meaningless.
    exact: subtotals.size === 0 || (subtotals.size === 1 && subtotals.has(to)),
  };
}

/** True when every amount is already in one currency: no conversion needed. */
export const isSingleCurrency = (entries, target) => {
  const codes = new Set((entries ?? []).map((entry) => coerceCurrency(entry?.currency)));
  return codes.size === 0 || (codes.size === 1 && codes.has(coerceCurrency(target)));
};
