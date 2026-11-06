import {
  DEFAULT_CURRENCY,
  coerceCurrency,
  fractionDigitsOf,
  localeOf,
} from "./registry.js";

// Formatting money, for every surface.
//
// One rule underneath all of it: a number and a currency code go in, Intl
// decides what comes out. Nothing here concatenates a symbol onto a number,
// because that is how "₹" ends up in front of a dollar amount, and how a
// German user gets "€25,000.00" when their own convention is "25.000,00 €".
//
// Formatters are cached. Constructing an Intl.NumberFormat is expensive
// enough to matter when a transactions table formats six hundred cells on
// every render, and the set of (locale, currency, style) combinations in use
// is tiny and bounded by the registry.

const cache = new Map();

const formatter = (currency, locale, extra = {}, key = "plain") => {
  const code = coerceCurrency(currency);
  const resolved = locale || localeOf(code);
  const id = `${key}:${resolved}:${code}`;
  let found = cache.get(id);
  if (!found) {
    found = new Intl.NumberFormat(resolved, {
      style: "currency",
      currency: code,
      ...extra,
    });
    cache.set(id, found);
  }
  return found;
};

// What a non-number becomes.
//
// Zero, deliberately, and the same zero everywhere: a dashboard tile reading
// "—" where a total should be looks like a bug to the person reading it,
// whereas a genuinely absent figure is omitted by its caller rather than
// passed in here. `formatMoney` below is the one that answers null, for
// receipts, where "we do not know" must not render as "nothing".
const numeric = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * An amount in a currency, in that currency's own convention.
 *
 * @param {number|string} value  The amount, in MAJOR units.
 * @param {string} [currency]    ISO 4217. Defaults to the application default.
 * @param {string} [locale]      Overrides the currency's own locale.
 */
export function formatCurrency(value, currency = DEFAULT_CURRENCY, locale = null) {
  return formatter(currency, locale).format(numeric(value));
}

/**
 * The same, shortened for tight spaces: ₹1.2L, $120K, ¥12万.
 *
 * Compact notation is locale-specific and that is the point -- Indian
 * compacting goes lakh/crore, which is what a rupee user expects on a chart
 * axis and what nothing else produces.
 */
export function formatCompactCurrency(value, currency = DEFAULT_CURRENCY, locale = null) {
  return formatter(
    currency,
    locale,
    { notation: "compact", maximumFractionDigits: 1 },
    "compact"
  ).format(numeric(value));
}

/**
 * An amount, or null when there is nothing trustworthy to show.
 *
 * The strict counterpart to formatCurrency, for documents where a figure is
 * checked against a bank statement: a missing amount must be absent, never
 * rendered as zero. A confirmation email that says "Amount paid: ₹0.00"
 * because a field was null is worse than one with no amount line at all.
 */
export function formatMoney(value, currency) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!currency) return null;
  return formatCurrency(n, currency);
}

/**
 * An amount held in MINOR units -- paise, cents -- as the payment provider
 * works in.
 *
 * The divisor is the currency's own minor-unit exponent, so a yen amount is
 * not divided at all and a dinar is divided by a thousand. A hard-coded /100
 * understates a JPY figure by a factor of a hundred.
 */
export function formatMinorUnits(minor, currency) {
  if (minor === null || minor === undefined || minor === "") return null;
  const amount = Number(minor);
  if (!Number.isFinite(amount)) return null;
  if (!currency) return null;
  const code = coerceCurrency(currency, null);
  if (!code) return null;
  return formatCurrency(amount / 10 ** fractionDigitsOf(code), code);
}

/** Just the number, no symbol -- for inputs and CSV cells. */
export function formatAmount(value, currency = DEFAULT_CURRENCY) {
  const code = coerceCurrency(currency);
  const digits = fractionDigitsOf(code);
  return new Intl.NumberFormat(localeOf(code), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric(value));
}
