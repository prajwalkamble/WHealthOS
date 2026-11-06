// The supported currencies, and the one place their facts live.
//
// ISO 4217 codes are the authoritative identifier throughout WHealthOS: a
// currency is stored, compared and validated by code, never by symbol. A
// symbol is a display detail that several currencies share -- "$" is the
// narrow symbol for USD, CAD, AUD and SGD alike -- so anything that decides
// behaviour from a symbol is a bug waiting for a Canadian.
//
// What is NOT in this table: fraction digits and symbols. Those are ICU's to
// know, and Node ships the full dataset (verified: de-DE renders EUR as
// "25.000,00 €", and JPY resolves to zero fraction digits). Restating them
// here would be a second source of truth that drifts -- and the usual way
// that drift shows up is a yen amount rendered with two decimal places and a
// hundredfold error in the minor-unit conversion underneath it.

// The locale each currency is formatted in by default.
//
// Its own home locale rather than the viewer's, so an amount looks the way
// that currency is written: lakh grouping for rupees, a trailing symbol and
// comma decimals for euros. A dashboard labelled EUR that groups in lakhs
// looks broken to the person who chose EUR.
// `convertible` is whether the configured rate provider publishes a rate for
// it, which is NOT the same question as whether WHealthOS supports it.
//
// Rates come from the European Central Bank's daily reference set, and the
// ECB does not publish AED or SAR. Those two format perfectly, can be chosen
// as a display currency, and can be an account's currency -- there is simply
// no rate with which to convert them, so a total mixing them with another
// currency is reported per currency instead of as one converted figure.
// Claiming a converted number there would mean inventing the rate.
const DEFINITIONS = [
  { code: "INR", name: "Indian Rupee", locale: "en-IN", convertible: true },
  { code: "USD", name: "US Dollar", locale: "en-US", convertible: true },
  { code: "EUR", name: "Euro", locale: "de-DE", convertible: true },
  { code: "GBP", name: "British Pound", locale: "en-GB", convertible: true },
  { code: "JPY", name: "Japanese Yen", locale: "ja-JP", convertible: true },
  { code: "CAD", name: "Canadian Dollar", locale: "en-CA", convertible: true },
  { code: "AUD", name: "Australian Dollar", locale: "en-AU", convertible: true },
  { code: "AED", name: "UAE Dirham", locale: "en-AE", convertible: false },
  { code: "SGD", name: "Singapore Dollar", locale: "en-SG", convertible: true },
  { code: "CHF", name: "Swiss Franc", locale: "de-CH", convertible: true },
  { code: "CNY", name: "Chinese Yuan", locale: "zh-CN", convertible: true },
  { code: "KRW", name: "South Korean Won", locale: "ko-KR", convertible: true },
  { code: "SAR", name: "Saudi Riyal", locale: "ar-SA", convertible: false },
];

// The currency every provider rate is quoted against. The ECB publishes
// EUR-based reference rates, so one row per currency per day covers every
// pair: anything else is a cross-rate computed from two of them.
export const RATE_BASE = "EUR";

// The application's fallback, used when nothing better is known. Also the
// currency every existing record is in -- see the migration that added the
// currency columns.
export const DEFAULT_CURRENCY = "INR";

// How many decimal places this currency's minor unit has, from ICU.
//
// Two for INR and USD, none for JPY and KRW, three for a dinar. This is the
// exponent that converts between major and minor units, so getting it from a
// table of our own would eventually understate a yen figure by a factor of a
// hundred.
const digitsFor = (code) => {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency: code })
        .resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
};

// The symbol, for a selector row or a legend. Never for arithmetic, and never
// concatenated onto a number -- formatting is Intl's job.
const symbolFor = (code, locale) => {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
};

export const CURRENCIES = DEFINITIONS.map((definition) => ({
  ...definition,
  symbol: symbolFor(definition.code, definition.locale),
  fractionDigits: digitsFor(definition.code),
  // Every currency in this table is sellable today. The field exists so one
  // can be retired without deleting the row -- records already stored in it
  // still have to format.
  active: true,
}));

const BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export const CURRENCY_CODES = CURRENCIES.map((currency) => currency.code);

/** Codes the rate provider publishes, and so the ones that can be converted. */
export const CONVERTIBLE_CODES = CURRENCIES.filter((c) => c.convertible).map((c) => c.code);

export const isConvertible = (code) => Boolean(currencyOf(code)?.convertible);

/**
 * Is this a currency WHealthOS supports?
 *
 * The validation gate for everything that arrives from outside: a cookie, a
 * query parameter, a geolocation header, a stored preference written by an
 * older version. Nothing downstream has to re-check.
 */
export const isSupported = (code) =>
  typeof code === "string" && BY_CODE.has(code.toUpperCase());

/** The currency's facts, or null. Never a guess. */
export const currencyOf = (code) =>
  isSupported(code) ? BY_CODE.get(String(code).toUpperCase()) : null;

/**
 * A code that is definitely supported.
 *
 * Takes anything and returns a usable code, falling back rather than
 * throwing: a bad cookie should show rupees, not a 500. Callers that need to
 * know whether the input was valid ask isSupported first.
 */
export const coerceCurrency = (code, fallback = DEFAULT_CURRENCY) =>
  isSupported(code) ? String(code).toUpperCase() : fallback;

export const fractionDigitsOf = (code) =>
  currencyOf(code)?.fractionDigits ?? digitsFor(coerceCurrency(code));

export const localeOf = (code) => currencyOf(code)?.locale ?? "en";

export const symbolOf = (code) => currencyOf(code)?.symbol ?? coerceCurrency(code);

export const nameOf = (code) => currencyOf(code)?.name ?? coerceCurrency(code);

/** The multiplier between a currency's major and minor units: 100 for INR, 1 for JPY. */
export const minorUnitScale = (code) => 10 ** fractionDigitsOf(code);
