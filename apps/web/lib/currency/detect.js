import { currencyForCountry, isCountryCode } from "./countries.js";
import { DEFAULT_CURRENCY } from "./registry.js";

// Working out roughly where a request came from, from headers the edge put
// there.
//
// No GeoIP database, no third-party lookup, no browser geolocation prompt.
// The platform already resolved the IP to a country before this code ran, and
// asking anybody else would mean sending a visitor's IP address to a service
// that has no business with it -- for a hint about which currency symbol to
// show first.
//
// Three consequences worth stating plainly:
//
//   It is approximate. A VPN, a corporate proxy or a mobile carrier routing
//   through another country all produce a confident, wrong answer. That is
//   acceptable because the answer is only ever a SUGGESTION: it is the lowest
//   priority in lib/currency/resolve.js, below anything the person has
//   actually chosen, and one click overrides it forever.
//
//   It is free. No request, no key, no latency, nothing to be down. §14's
//   "do not block rendering on geolocation" is satisfied by there being
//   nothing to wait for.
//
//   It is never read from the client. A header a browser can set is a header
//   an attacker can set; these come from the edge, and the only thing a
//   forged one could achieve is showing the forger the wrong currency.

// Headers that carry a country code, in the order they are trusted.
//
// Vercel is where this deploys, so x-vercel-ip-country is the real one.
// Cloudflare's is accepted because a deployment behind it would otherwise
// silently lose detection, and the generic one is what a self-hosted proxy
// is usually configured to send.
const COUNTRY_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country-code",
];

// Cloudflare sends this for requests it cannot place -- Tor exits, some
// satellite ranges. It is a valid two-letter string and would otherwise be
// looked up as a country.
const UNKNOWN_COUNTRY = "XX";

/**
 * The country for a request, or null.
 *
 * @param {Headers | Map | {get(name: string): string | null}} headers
 */
export function countryFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return null;

  for (const name of COUNTRY_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;
    const value = String(raw).trim().toUpperCase();
    if (value === UNKNOWN_COUNTRY) continue;
    if (!isCountryCode(value)) continue;
    return value;
  }
  return null;
}

/**
 * What to suggest for a request, and why.
 *
 * Always returns a usable currency. `detected` says whether the country was
 * actually recognised, which is what lets the UI distinguish "we think you
 * are in Japan" from "we have no idea, here is the default" -- and what stops
 * a confident-looking suggestion being made from nothing.
 */
export function detectCurrency(headers) {
  const country = countryFromHeaders(headers);
  const currency = currencyForCountry(country);

  if (!country) {
    return { currency: DEFAULT_CURRENCY, country: null, detected: false, reason: "no-country-header" };
  }
  if (!currency) {
    // The edge placed them, we just do not sell a currency for it. Worth
    // keeping distinct from "no header": it is the case that is fixed by
    // adding a row to the country map.
    return { currency: DEFAULT_CURRENCY, country, detected: false, reason: "country-not-mapped" };
  }
  return { currency, country, detected: true, reason: "geo" };
}
