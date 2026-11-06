import { CURRENCY_CODES, DEFAULT_CURRENCY, coerceCurrency } from "./registry.js";

// Which currency to suggest for a visitor in a given country.
//
// Written currency-first rather than as a flat country map, because that is
// how the facts actually group: twenty countries share the euro, and listing
// "EUR" twenty times is twenty chances to typo one of them. The flat lookup
// is derived below, once.
//
// A suggestion, never a restriction. Someone in Germany who keeps their
// accounts in dollars changes it once and is never asked again -- see
// lib/currency/resolve.js for the order preferences are applied in.
//
// ISO 3166-1 alpha-2 throughout, upper case. A country that is not listed is
// not an error: it falls back, and lib/currency/detect.js says so rather
// than pretending it recognised it.
const COUNTRIES_BY_CURRENCY = {
  INR: ["IN", "BT"],
  USD: ["US", "PR", "GU", "VI", "AS", "MP", "EC", "SV", "PA", "TL", "ZW", "BQ"],
  // The 20 euro-area members, then the microstates and the two unilateral
  // adopters. Kept in that order and alphabetised within it so a missing
  // member is visible -- Spain was omitted from the first draft of this list
  // and only a test that named the large economies caught it.
  EUR: [
    "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV",
    "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
    "AD", "MC", "SM", "VA", "ME", "XK",
  ],
  GBP: ["GB", "IM", "JE", "GG"],
  JPY: ["JP"],
  CAD: ["CA"],
  AUD: ["AU", "CX", "CC", "NF", "NR", "TV", "KI"],
  AED: ["AE"],
  SGD: ["SG"],
  CHF: ["CH", "LI"],
  CNY: ["CN"],
  KRW: ["KR"],
  SAR: ["SA"],
};

// The flat lookup, built once at module load.
//
// Built rather than written out, and checked while building: a country that
// appeared under two currencies would otherwise resolve to whichever happened
// to be enumerated last, silently.
const BY_COUNTRY = new Map();
for (const [currency, countries] of Object.entries(COUNTRIES_BY_CURRENCY)) {
  if (!CURRENCY_CODES.includes(currency)) {
    throw new Error(
      `lib/currency/countries.js maps countries to ${currency}, which is not in the registry.`
    );
  }
  for (const country of countries) {
    if (BY_COUNTRY.has(country)) {
      throw new Error(
        `${country} is mapped to both ${BY_COUNTRY.get(country)} and ${currency}.`
      );
    }
    BY_COUNTRY.set(country, currency);
  }
}

export const COUNTRY_CURRENCY = COUNTRIES_BY_CURRENCY;

export const isCountryCode = (value) =>
  typeof value === "string" && /^[A-Za-z]{2}$/.test(value);

/**
 * The currency to suggest for a country, or null when the country is unknown.
 *
 * Null rather than the default on purpose. "We do not recognise this country"
 * and "this country uses rupees" are different facts, and the caller that
 * reports which one happened is the caller that can be debugged.
 */
export function currencyForCountry(country) {
  if (!isCountryCode(country)) return null;
  const mapped = BY_COUNTRY.get(country.toUpperCase());
  return mapped ? coerceCurrency(mapped, DEFAULT_CURRENCY) : null;
}

/** Every country this mapping knows, for tests and for the selector's hints. */
export const KNOWN_COUNTRIES = [...BY_COUNTRY.keys()].sort();

export const countriesFor = (currency) => COUNTRIES_BY_CURRENCY[currency] ?? [];
