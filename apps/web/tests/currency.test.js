import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENCIES,
  CURRENCY_CODES,
  CONVERTIBLE_CODES,
  DEFAULT_CURRENCY,
  coerceCurrency,
  fractionDigitsOf,
  isConvertible,
  isSupported,
  minorUnitScale,
} from "@/lib/currency/registry";
import {
  KNOWN_COUNTRIES,
  countriesFor,
  currencyForCountry,
} from "@/lib/currency/countries";
import { countryFromHeaders, detectCurrency } from "@/lib/currency/detect";
import {
  CURRENCY_SOURCE,
  decodePreference,
  encodePreference,
  resolveCurrency,
} from "@/lib/currency/resolve";
import {
  formatAmount,
  formatCompactCurrency,
  formatCurrency,
  formatMinorUnits,
  formatMoney,
} from "@/lib/currency/format";

// A request's headers, as the edge would present them.
const headers = (map = {}) => ({
  get: (name) => map[name.toLowerCase()] ?? null,
});

// --- The registry ------------------------------------------------------------

describe("the currency registry", () => {
  it("carries every currency the brief names", () => {
    for (const code of ["INR", "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "AED", "SGD", "CHF", "CNY", "KRW", "SAR"]) {
      expect(CURRENCY_CODES, code).toContain(code);
    }
  });

  it("validates codes rather than trusting them", () => {
    expect(isSupported("USD")).toBe(true);
    expect(isSupported("usd")).toBe(true);
    expect(isSupported("XXX")).toBe(false);
    expect(isSupported("")).toBe(false);
    expect(isSupported(null)).toBe(false);
    expect(isSupported({ code: "USD" })).toBe(false);
  });

  it("falls back rather than throwing on an unusable code", () => {
    expect(coerceCurrency("XXX")).toBe(DEFAULT_CURRENCY);
    expect(coerceCurrency(undefined)).toBe(DEFAULT_CURRENCY);
    expect(coerceCurrency("jpy")).toBe("JPY");
  });

  // §6: do not assume every currency has two decimal places. These come from
  // ICU, not from a table maintained here, which is why they are right.
  it.each([
    ["INR", 2],
    ["USD", 2],
    ["EUR", 2],
    ["GBP", 2],
    ["JPY", 0],
    ["KRW", 0],
  ])("knows %s has %i fraction digits", (code, digits) => {
    expect(fractionDigitsOf(code)).toBe(digits);
  });

  it("derives the minor-unit scale from those digits", () => {
    expect(minorUnitScale("INR")).toBe(100);
    expect(minorUnitScale("JPY")).toBe(1);
  });

  // The ECB publishes neither. Saying so in the registry is what stops a
  // conversion inventing one.
  it("marks the currencies the rate provider does not publish", () => {
    expect(isConvertible("INR")).toBe(true);
    expect(isConvertible("AED")).toBe(false);
    expect(isConvertible("SAR")).toBe(false);
    expect(CONVERTIBLE_CODES).not.toContain("AED");
    expect(CONVERTIBLE_CODES).not.toContain("SAR");
  });

  it("gives every currency a symbol and a locale", () => {
    for (const currency of CURRENCIES) {
      expect(currency.symbol, currency.code).toBeTruthy();
      expect(currency.locale, currency.code).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    }
  });
});

// --- Country to currency -----------------------------------------------------

describe("country to currency", () => {
  it.each([
    ["IN", "INR"],
    ["US", "USD"],
    ["JP", "JPY"],
    ["GB", "GBP"],
    ["DE", "EUR"],
    ["FR", "EUR"],
    ["CA", "CAD"],
    ["AU", "AUD"],
    ["AE", "AED"],
    ["SG", "SGD"],
    ["CH", "CHF"],
    ["CN", "CNY"],
    ["KR", "KRW"],
    ["SA", "SAR"],
  ])("maps %s to %s", (country, currency) => {
    expect(currencyForCountry(country)).toBe(currency);
  });

  it("is not case sensitive", () => {
    expect(currencyForCountry("in")).toBe("INR");
  });

  // Null, not the default. "We do not recognise this country" and "this
  // country uses rupees" are different facts and the caller reports which.
  it("returns null for a country it does not map", () => {
    expect(currencyForCountry("BR")).toBeNull();
    expect(currencyForCountry("ZZ")).toBeNull();
    expect(currencyForCountry("")).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
    expect(currencyForCountry("USA")).toBeNull();
  });

  it("covers the euro area under one currency", () => {
    const euro = countriesFor("EUR");
    for (const country of ["DE", "FR", "IT", "ES", "NL", "IE", "PT", "FI"]) {
      expect(euro, country).toContain(country);
    }
  });

  it("maps every country to exactly one currency", () => {
    expect(new Set(KNOWN_COUNTRIES).size).toBe(KNOWN_COUNTRIES.length);
  });
});

// --- Detection ---------------------------------------------------------------

describe("detecting a country from a request", () => {
  it("reads the hosting provider's header", () => {
    expect(countryFromHeaders(headers({ "x-vercel-ip-country": "JP" }))).toBe("JP");
  });

  it("accepts Cloudflare's as well", () => {
    expect(countryFromHeaders(headers({ "cf-ipcountry": "GB" }))).toBe("GB");
  });

  it("prefers the hosting provider's over the others", () => {
    const found = countryFromHeaders(
      headers({ "x-vercel-ip-country": "IN", "cf-ipcountry": "US" })
    );
    expect(found).toBe("IN");
  });

  // Cloudflare's "we could not place this request" -- a valid two-letter
  // string that would otherwise be looked up as a country.
  it("treats XX as unplaced rather than as a country", () => {
    expect(countryFromHeaders(headers({ "cf-ipcountry": "XX" }))).toBeNull();
  });

  it.each([["USA"], ["1"], [""], ["   "], ["<script>"]])(
    "ignores a malformed country header (%s)",
    (value) => {
      expect(countryFromHeaders(headers({ "x-vercel-ip-country": value }))).toBeNull();
    }
  );

  // §2: do not trust arbitrary client-supplied country codes. Only the edge
  // headers are read, so a browser-settable one changes nothing.
  it("ignores a header a browser could set itself", () => {
    expect(
      countryFromHeaders(headers({ "x-forwarded-country": "JP", "x-geo-country": "JP" }))
    ).toBeNull();
  });

  it("copes with no headers at all", () => {
    expect(countryFromHeaders(null)).toBeNull();
    expect(countryFromHeaders({})).toBeNull();
    expect(countryFromHeaders(headers())).toBeNull();
  });

  it("suggests a currency and says whether it recognised the country", () => {
    expect(detectCurrency(headers({ "x-vercel-ip-country": "JP" }))).toMatchObject({
      currency: "JPY",
      country: "JP",
      detected: true,
    });
  });

  // A VPN exit in a country we do not map, and a request with no geolocation
  // at all, are different situations and report differently -- one is fixed
  // by adding a row to the map, the other cannot be fixed at all.
  it("distinguishes an unmapped country from a missing header", () => {
    expect(detectCurrency(headers({ "x-vercel-ip-country": "BR" }))).toMatchObject({
      currency: DEFAULT_CURRENCY,
      country: "BR",
      detected: false,
      reason: "country-not-mapped",
    });
    expect(detectCurrency(headers())).toMatchObject({
      currency: DEFAULT_CURRENCY,
      country: null,
      detected: false,
      reason: "no-country-header",
    });
  });
});

// --- Preference resolution ---------------------------------------------------

describe("the preference cookie", () => {
  it("round-trips a choice", () => {
    const raw = encodePreference("JPY", CURRENCY_SOURCE.MANUAL);
    expect(decodePreference(raw)).toEqual({
      currency: "JPY",
      source: CURRENCY_SOURCE.MANUAL,
    });
  });

  it("remembers whether it was chosen or merely suggested", () => {
    expect(decodePreference(encodePreference("USD", CURRENCY_SOURCE.GEO)).source).toBe(
      CURRENCY_SOURCE.GEO
    );
  });

  // A cookie written by an older version must never be able to break a page.
  it.each([["garbage"], ["XXX:m"], [":m"], [""], [null], [{}]])(
    "treats an unusable cookie (%s) as absent",
    (raw) => {
      expect(decodePreference(raw)).toBeNull();
    }
  );
});

describe("which currency wins", () => {
  const india = headers({ "x-vercel-ip-country": "IN" });
  const germany = headers({ "x-vercel-ip-country": "DE" });

  it("suggests from the country when nothing has been chosen", () => {
    expect(resolveCurrency({ headers: germany })).toMatchObject({
      currency: "EUR",
      source: CURRENCY_SOURCE.GEO,
    });
  });

  it("falls back to the default when the country is unknown", () => {
    expect(resolveCurrency({ headers: headers() })).toMatchObject({
      currency: DEFAULT_CURRENCY,
      source: CURRENCY_SOURCE.DEFAULT,
    });
  });

  it("uses a signed-in account's saved currency over the country", () => {
    expect(resolveCurrency({ account: "USD", headers: india })).toMatchObject({
      currency: "USD",
      source: CURRENCY_SOURCE.ACCOUNT,
    });
  });

  // §3, stated outright: an explicit choice is never overwritten because the
  // person travelled. This is the rule the whole precedence exists for.
  it("keeps an explicit choice when the request comes from another country", () => {
    const resolution = resolveCurrency({
      cookie: encodePreference("USD", CURRENCY_SOURCE.MANUAL),
      headers: germany,
    });
    expect(resolution.currency).toBe("USD");
    expect(resolution.source).toBe(CURRENCY_SOURCE.MANUAL);
  });

  // A guest picks yen, then creates an account. The account has no preference
  // yet, and their choice has to survive signing in.
  it("keeps a choice made before signing in", () => {
    expect(
      resolveCurrency({
        cookie: encodePreference("JPY", CURRENCY_SOURCE.MANUAL),
        account: null,
        headers: india,
      })
    ).toMatchObject({ currency: "JPY", source: CURRENCY_SOURCE.MANUAL });
  });

  // ...but a merely SUGGESTED cookie is not a choice, so the account wins.
  it("lets the account override a cookie that was only a suggestion", () => {
    expect(
      resolveCurrency({
        cookie: encodePreference("EUR", CURRENCY_SOURCE.GEO),
        account: "GBP",
        headers: germany,
      })
    ).toMatchObject({ currency: "GBP", source: CURRENCY_SOURCE.ACCOUNT });
  });

  it("ignores an account preference naming an unsupported currency", () => {
    expect(resolveCurrency({ account: "XXX", headers: india })).toMatchObject({
      currency: "INR",
      source: CURRENCY_SOURCE.GEO,
    });
  });

  // The slot exists, is wired, and is never reached: WHealthOS has no
  // workspaces. Pinned so the ordering is already right when one exists.
  it("would place a workspace currency below an account's own", () => {
    expect(
      resolveCurrency({ account: "USD", workspace: "EUR", headers: india }).currency
    ).toBe("USD");
    expect(resolveCurrency({ workspace: "EUR", headers: india }).currency).toBe("EUR");
  });

  it("reports the detected country alongside whatever it chose", () => {
    const resolution = resolveCurrency({
      cookie: encodePreference("USD", CURRENCY_SOURCE.MANUAL),
      headers: germany,
    });
    expect(resolution.country).toBe("DE");
    expect(resolution.detected).toBe(true);
  });
});

// --- Formatting --------------------------------------------------------------

describe("formatting money", () => {
  it.each([
    [25000, "INR", "₹25,000.00"],
    [25000, "USD", "$25,000.00"],
    [25000, "GBP", "£25,000.00"],
    [25000, "JPY", "￥25,000"],
  ])("formats %i %s as %s", (value, currency, expected) => {
    expect(formatCurrency(value, currency)).toBe(expected);
  });

  // Each currency in its own convention: euros group with dots, put the
  // symbol last, and use a comma for the decimal.
  it("formats euros the way euros are written", () => {
    // The space before the symbol is a NON-BREAKING space, which is correct
    // and is also why asserting the literal string fails in a way that looks
    // like the two are identical.
    expect(formatCurrency(25000, "EUR")).toBe("25.000,00\u00a0€");
  });

  // Lakh grouping, which is the whole reason the currency's own locale is
  // used rather than the viewer's.
  it("groups rupees in lakhs", () => {
    expect(formatCurrency(1234567, "INR")).toBe("₹12,34,567.00");
  });

  it.each([
    [-5000, "USD"],
    [0, "USD"],
    [999999999, "USD"],
  ])("handles %i %s", (value, currency) => {
    expect(typeof formatCurrency(value, currency)).toBe("string");
  });

  it("formats a negative amount as a negative, not as a missing one", () => {
    expect(formatCurrency(-5000, "USD")).toContain("5,000.00");
    expect(formatCurrency(-5000, "USD")).toMatch(/^-|\(/);
  });

  it("renders zero rather than nothing", () => {
    expect(formatCurrency(0, "JPY")).toBe("￥0");
  });

  it("treats an unusable amount as zero rather than throwing", () => {
    expect(formatCurrency(null, "USD")).toBe("$0.00");
    expect(formatCurrency(undefined, "USD")).toBe("$0.00");
    expect(formatCurrency("not a number", "USD")).toBe("$0.00");
  });

  it("falls back to the default currency rather than throwing", () => {
    expect(formatCurrency(100, "XXX")).toBe(formatCurrency(100, DEFAULT_CURRENCY));
  });

  // The strict counterpart, for receipts: a missing amount must be absent,
  // never rendered as zero.
  it("returns null from formatMoney when there is nothing to show", () => {
    expect(formatMoney(null, "USD")).toBeNull();
    expect(formatMoney(100, null)).toBeNull();
    expect(formatMoney(100, "USD")).toBe("$100.00");
  });

  it("divides minor units by the currency's own exponent", () => {
    expect(formatMinorUnits(39900, "INR")).toBe("₹399.00");
    expect(formatMinorUnits(1999, "USD")).toBe("$19.99");
    // Not divided at all: a hard-coded /100 understates this a hundredfold.
    expect(formatMinorUnits(123456, "JPY")).toBe("￥123,456");
  });

  it("compacts for a chart axis in the currency's own convention", () => {
    expect(formatCompactCurrency(120000, "INR")).toMatch(/L|lakh/i);
    expect(formatCompactCurrency(120000, "USD")).toMatch(/K/i);
  });

  it("formats a bare amount with the right precision for CSV and inputs", () => {
    expect(formatAmount(1234.5, "USD")).toBe("1,234.50");
    expect(formatAmount(1234.5, "JPY")).toBe("1,235");
  });
});

// --- Billing isolation -------------------------------------------------------

// §13: the display currency and the billing currency are different systems
// and must stay that way. Changing a dashboard to dollars does not mean
// Razorpay can charge dollars, and a crafted preference must not be able to
// influence what somebody is billed.
//
// Asserted by reading the source rather than by exercising a flow, because
// the property is "there is no path at all", and the way that regresses is
// somebody adding an import.
const read = (file) => readFileSync(join(process.cwd(), file), "utf8");

const billingSources = readdirSync(join(process.cwd(), "lib/billing"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => [`lib/billing/${name}`, read(`lib/billing/${name}`)]);

describe("billing is insulated from the display currency", () => {
  it("never reads the viewer's display currency", () => {
    for (const [file, source] of billingSources) {
      expect(source, file).not.toContain("currency/server");
      expect(source, file).not.toContain("currency/resolve");
      expect(source, file).not.toContain("useCurrency");
      expect(source, file).not.toContain("currentCurrency");
    }
  });

  it("never converts a billing amount", () => {
    for (const [file, source] of billingSources) {
      expect(source, file).not.toContain("convertAmount");
      expect(source, file).not.toContain("sumInCurrency");
      expect(source, file).not.toContain("rateFor");
    }
  });

  // The payment adapter likewise: a settlement currency is the provider's
  // business and has nothing to do with what the dashboard is set to.
  it("keeps the payment provider out of it too", () => {
    for (const name of readdirSync(join(process.cwd(), "lib/payments"))) {
      if (!name.endsWith(".js")) continue;
      const source = read(`lib/payments/${name}`);
      expect(source, name).not.toContain("currency/server");
      expect(source, name).not.toContain("convertAmount");
    }
  });

  // The subscription price comes from the server-side catalogue, never from
  // anything the browser sent.
  it("prices a subscription from the catalogue, in the billing currency", () => {
    const plans = read("lib/billing/plans.js");
    expect(plans).toContain('export const CURRENCY = "INR"');
    expect(plans).toContain("amountPaiseFor");
  });

  // The currency action writes a reading preference and nothing else. If it
  // ever touches an account, a transaction or a subscription, that is a
  // display setting rewriting stored money.
  it("lets the currency endpoint change nothing but the preference", () => {
    const action =
      read("app/api/currency/route.js") + read("lib/currency/preference.js");
    expect(action).toContain("displayCurrency");
    for (const forbidden of [
      "account.update",
      "transaction.update",
      "subscription.update",
      "budget.update",
      "goal.update",
      "card.update",
    ]) {
      expect(action, forbidden).not.toContain(forbidden);
    }
  });
});

// --- No relabelling -----------------------------------------------------------

// The failure this whole design exists to prevent: an amount keeping its
// value and changing its symbol. It regresses the moment a component imports
// the raw formatter and passes the display currency to it, so that is what is
// checked -- the property is structural, and structure is what a test can
// hold onto.
describe("nothing formats money outside the conversion path", () => {
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(rel));
      else if (/\.(js|jsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
  };

  const surfaces = [...walk("app/(main)"), ...walk("components")].filter(
    (file) =>
      // The provider and the server-side formatter ARE the conversion path.
      !file.endsWith("components/currency-provider.jsx")
  );

  it("routes every signed-in surface through the provider or serverCurrency", () => {
    const offenders = [];
    for (const file of surfaces) {
      const source = read(file);
      if (!/formatCurrency|formatCompactCurrency/.test(source)) continue;
      const viaProvider = source.includes("useCurrency(");
      const viaServer = source.includes("serverCurrency(");
      if (!viaProvider && !viaServer) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  // The provider converts before it formats. Without that it is a formatter
  // with extra steps, and every figure under (main) is relabelled.
  it("converts before formatting", () => {
    const provider = read("components/currency-provider.jsx");
    expect(provider).toContain("format: (amount) => formatCurrency(convert(amount), code)");
    expect(provider).toContain(
      "formatCompact: (amount) => formatCompactCurrency(convert(amount), code)"
    );
  });

  // And when it refuses, it formats in the ledger's currency -- not in the
  // one that was asked for. The single most important line in the whole
  // feature; it moved into the shared pure core when conversion moved to the
  // browser, so this follows it rather than being dropped.
  it("formats in the ledger currency when conversion is refused", () => {
    const core = read("lib/currency/convert-client.js");
    expect(core).toContain("const refuse = (reason) => ({");
    expect(core).toContain("currency: held[0]");
    expect(core).toContain("rate: null");
  });
});

// --- The development-only country override ------------------------------------

describe("the dev country override", () => {
  // It exists so the geolocation behaviour can be seen on localhost, where
  // the edge header does not exist. It must not be able to exist in a
  // production build -- asserted structurally, because the guard is one
  // condition and conditions get edited.
  it("is guarded on NODE_ENV", () => {
    const server = read("lib/currency/server.js");
    expect(server).toContain("whealth-dev-country");
    expect(server).toContain('process.env.NODE_ENV === "production"');
    // The production branch must use the real headers, untouched.
    expect(server).toMatch(/NODE_ENV === "production"\s*\?\s*rawHeaders/);
  });
});
