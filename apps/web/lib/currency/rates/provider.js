import { CONVERTIBLE_CODES, RATE_BASE } from "../registry.js";

// Where exchange rates come from.
//
// One adapter shape, so the provider can be replaced without anything
// downstream knowing: a provider takes a date (or nothing, for the latest)
// and returns rates quoted against RATE_BASE, dated by the provider itself.
// The store, the conversion service and every caller above them are written
// against that shape and not against anybody's JSON.
//
// The provider in use is the European Central Bank's daily reference rates,
// served by Frankfurter. Chosen because it needs no API key, no account and
// no credential in the environment -- a rate source that cannot be
// configured cannot be misconfigured, and there is nothing here to leak.
//
// What these rates are NOT: a dealing price, a card rate, or what a bank
// would settle at. They are the ECB's daily reference fixing. Anything
// showing a converted figure has to say it is indicative.

export const PROVIDER = "ecb.frankfurter";

// api.frankfurter.app redirects here permanently; naming the canonical host
// avoids paying for the hop on every refresh.
const ENDPOINT = "https://api.frankfurter.dev/v1";

// The ECB publishes once per working day, around 16:00 CET. A request is
// either answered quickly or is not worth waiting for: this runs in a cron,
// and a refresh that hangs is a job that holds a slot for nothing.
const TIMEOUT_MS = 8_000;

const isRateLike = (value) => Number.isFinite(value) && value > 0;

/**
 * Fetches rates quoted against RATE_BASE.
 *
 * @param {object} [options]
 * @param {string} [options.on]  An ISO date (YYYY-MM-DD) for a historical
 *                               fixing. Omit for the most recent one.
 * @returns {Promise<{ base: string, asOf: string, source: string, rates: Record<string, number> }>}
 */
export async function fetchRates({ on = null, fetchImpl = fetch } = {}) {
  const symbols = CONVERTIBLE_CODES.filter((code) => code !== RATE_BASE);
  const path = on ? `/${on}` : "/latest";
  const url = `${ENDPOINT}${path}?base=${RATE_BASE}&symbols=${symbols.join(",")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let payload;
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`rate provider answered ${response.status}`);
    }
    payload = await response.json();
  } finally {
    clearTimeout(timer);
  }

  // Everything below validates rather than trusts. This is a third-party
  // response being turned into numbers that multiply somebody's net worth:
  // a null, a string, a zero or a negative that got written to the store
  // would corrupt every figure derived from it, quietly.
  if (!payload || typeof payload !== "object") {
    throw new Error("rate provider returned a non-object");
  }
  if (String(payload.base).toUpperCase() !== RATE_BASE) {
    throw new Error(`rate provider quoted against ${payload.base}, expected ${RATE_BASE}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date ?? ""))) {
    throw new Error("rate provider returned no usable date");
  }
  if (!payload.rates || typeof payload.rates !== "object") {
    throw new Error("rate provider returned no rates");
  }

  const rates = {};
  for (const [code, value] of Object.entries(payload.rates)) {
    const upper = String(code).toUpperCase();
    // Only currencies this application knows. A provider adding a currency
    // must not cause rows to appear for something nothing can display.
    if (!CONVERTIBLE_CODES.includes(upper)) continue;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!isRateLike(numeric)) continue;
    rates[upper] = numeric;
  }

  if (Object.keys(rates).length === 0) {
    throw new Error("rate provider returned nothing usable");
  }

  return { base: RATE_BASE, asOf: payload.date, source: PROVIDER, rates };
}
