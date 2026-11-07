import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  convertWithRate,
  crossRate,
  invertRate,
  parseRate,
  presentationFor,
} from "@/lib/currency/convert-client";
import { formatCurrency } from "@/lib/currency/format";

// Switching currency without touching the network.
//
// Two halves. The arithmetic has to be exact, because it now runs in the
// browser on every render rather than once on a server; and the switch has to
// stay local, which is a structural property of the code and is asserted as
// one -- a stray revalidatePath would put the round trip straight back.

const read = (file) => readFileSync(join(process.cwd(), file), "utf8");

// A real ECB fixing, EUR-quoted, as the table carries it: decimal strings.
const RATES = {
  USD: "1.1224",
  INR: "106.0395",
  JPY: "177.85",
  GBP: "0.83393",
  KRW: "1509.28",
};

describe("rates survive the trip to the browser", () => {
  it("parses a decimal string without losing places", () => {
    expect(parseRate("106.0395")).toBe(106039500000000n);
    expect(parseRate("1")).toBe(1000000000000n);
    expect(parseRate("0.000000000001")).toBe(1n);
  });

  // A rate that cannot be read must stop a conversion, never default to 1.
  it.each([["0"], ["-1"], ["abc"], [""], ["1e3"], [null], [undefined], [{}]])(
    "refuses %s rather than defaulting",
    (value) => {
      expect(parseRate(value)).toBeNull();
    }
  );
});

describe("cross-rates are derived locally", () => {
  it("needs no rate between a currency and itself", () => {
    expect(crossRate({}, "INR", "INR")).toBe(10n ** 12n);
  });

  it("reads straight off the base currency", () => {
    expect(crossRate(RATES, "EUR", "USD")).toBe(parseRate("1.1224"));
  });

  // The whole reason one row per currency covers every pair.
  it("derives a pair neither side of which is the base", () => {
    const rate = crossRate(RATES, "INR", "USD");
    expect(Number(rate) / 1e12).toBeCloseTo(1.1224 / 106.0395, 10);
  });

  it("returns null when a side is missing, rather than guessing", () => {
    expect(crossRate({ USD: "1.1224" }, "INR", "USD")).toBeNull();
    expect(crossRate(RATES, "INR", "AED")).toBeNull();
  });
});

// §5: decimal-safe arithmetic, correct rounding, each currency's own minor
// unit. These are the cases floating point gets wrong.
describe("conversion is exact", () => {
  it("converts a balance to the target's minor unit", () => {
    const rate = crossRate(RATES, "INR", "USD");
    expect(convertWithRate(50000, rate, "INR", "USD")).toBeCloseTo(529.24, 2);
  });

  it("gives a zero-decimal currency no decimals", () => {
    const rate = crossRate(RATES, "INR", "JPY");
    const yen = convertWithRate(50000, rate, "INR", "JPY");
    expect(Number.isInteger(yen)).toBe(true);
  });

  // The property floating point does not have: converting a sum equals the
  // sum of the conversions, so a total never disagrees with its rows.
  it("is additive, so a total agrees with the rows it sums", () => {
    const rate = crossRate(RATES, "INR", "USD");
    const rows = [1999.99, 4500.5, 33.33, 120000, 0.01];
    const converted = rows.map((r) => convertWithRate(r, rate, "INR", "USD"));
    const sumThenConvert = convertWithRate(
      rows.reduce((a, b) => a + b, 0),
      rate,
      "INR",
      "USD"
    );
    const convertThenSum = Number(converted.reduce((a, b) => a + b, 0).toFixed(2));
    expect(Math.abs(convertThenSum - sumThenConvert)).toBeLessThanOrEqual(0.05);
  });

  it("rounds half away from zero in both directions", () => {
    const half = parseRate("0.005");
    expect(convertWithRate(1, half, "INR", "USD")).toBe(0.01);
    expect(convertWithRate(-1, half, "INR", "USD")).toBe(-0.01);
  });

  it("handles a negative amount as a negative", () => {
    const rate = crossRate(RATES, "INR", "USD");
    expect(convertWithRate(-50000, rate, "INR", "USD")).toBeLessThan(0);
  });

  it("handles zero and very large amounts", () => {
    const rate = crossRate(RATES, "INR", "KRW");
    expect(convertWithRate(0, rate, "INR", "KRW")).toBe(0);
    expect(Number.isFinite(convertWithRate(1e9, rate, "INR", "KRW"))).toBe(true);
  });

  it("refuses rather than returning a number when there is no rate", () => {
    expect(convertWithRate(100, null, "INR", "USD")).toBeNull();
  });

  // Round-tripping is how a guest's typed amount gets back into the ledger's
  // currency. It must land within one minor unit of where it started.
  it("round-trips a typed amount back to the ledger currency", () => {
    const rate = crossRate(RATES, "INR", "USD");
    const typed = 600;
    const inLedger = convertWithRate(typed, invertRate(rate), "USD", "INR");
    const backAgain = convertWithRate(inLedger, rate, "INR", "USD");
    expect(Math.abs(backAgain - typed)).toBeLessThanOrEqual(0.01);
  });
});

describe("the presentation decision, computed in the browser", () => {
  const ledger = ["INR"];

  it("converts when a rate is there", () => {
    const d = presentationFor({ ledger, target: "USD", rates: RATES, asOf: "2026-11-05" });
    expect(d.applies).toBe(true);
    expect(d.currency).toBe("USD");
    expect(d.exact).toBe(false);
  });

  it("is exact, and rate-free, for the currency already held", () => {
    const d = presentationFor({ ledger, target: "INR", rates: RATES });
    expect(d.applies).toBe(true);
    expect(d.exact).toBe(true);
  });

  // Each of these must format in the LEDGER's currency. This is what stops a
  // local state update turning into a relabelling.
  it.each([
    ["no rate for the target", { target: "USD", rates: {} }, "no-rate"],
    ["a currency the provider does not publish", { target: "AED", rates: RATES }, "not-convertible"],
  ])("refuses on %s and keeps the ledger currency", (_label, input, reason) => {
    const d = presentationFor({ ledger, ...input });
    expect(d.applies).toBe(false);
    expect(d.reason).toBe(reason);
    expect(d.currency).toBe("INR");
  });

  it("refuses a mixed ledger, which one scalar cannot convert", () => {
    const d = presentationFor({ ledger: ["INR", "USD"], target: "GBP", rates: RATES });
    expect(d.applies).toBe(false);
    expect(d.reason).toBe("mixed-ledger");
  });

  // The guarantee that makes switching instant: the same inputs give the same
  // answer wherever it runs, so the server's first paint and the browser's
  // next render cannot disagree.
  it("is deterministic, so server and client agree", () => {
    const once = presentationFor({ ledger, target: "JPY", rates: RATES, asOf: "2026-11-05" });
    const twice = presentationFor({ ledger, target: "JPY", rates: RATES, asOf: "2026-11-05" });
    expect(once).toEqual(twice);
  });

  it("formats a converted figure in the target's own convention", () => {
    const d = presentationFor({ ledger, target: "JPY", rates: RATES });
    const shown = formatCurrency(convertWithRate(50000, d.rate, d.from, d.currency), d.currency);
    expect(shown).toMatch(/^￥[\d,]+$/);
  });
});

// §2, §8 and §12: structural, because this is how the regression comes back.
describe("switching stays local", () => {
  it("never reloads, navigates or refreshes the route", () => {
    for (const file of [
      "components/currency-provider.jsx",
      "components/currency-selector.jsx",
      "app/api/currency/route.js",
      "lib/currency/preference.js",
    ]) {
      const source = read(file);
      for (const forbidden of [
        "location.reload",
        "location.href",
        "router.refresh",
        "router.push",
        "router.replace",
      ]) {
        expect(source, `${file} uses ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  // The specific line that caused it: it re-rendered the whole signed-in
  // tree on the server for a change the browser had already made.
  // Checked by IMPORT, not by searching the text: these files explain the
  // history in comments, and a blunt string match would flag the
  // explanation. What cannot be called is what has not been imported.
  it("does not revalidate a path when the preference is saved", () => {
    for (const file of ["app/api/currency/route.js", "lib/currency/preference.js"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/^import .*from "next\/cache"/m);
      const calls = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(calls, file).not.toMatch(/\brevalidate(Path|Tag)\s*\(/);
    }
  });

  // THE one that matters, and the one I got wrong first time.
  //
  // Next re-renders the current route's server components after ANY Server
  // Action resolves. That is the protocol, independent of revalidatePath. So
  // persisting the preference through an action re-rendered the entire
  // signed-in tree a moment after every change -- which is precisely what
  // "the whole site reloads" looked like. Removing revalidatePath did not
  // fix it; moving off Server Actions did.
  it("persists through a route handler, never a Server Action", () => {
    // Checked as a DIRECTIVE, not as a substring: a directive only has
    // effect as the first statement of the file, and both of these explain
    // in a comment why they are not one. A blunt match flags the
    // explanation -- which it duly did.
    const directive = (file) => read(file).trimStart().split("\n")[0].trim();
    expect(directive("lib/currency/preference.js")).not.toMatch(/^["']use server["']/);
    expect(directive("app/api/currency/route.js")).not.toMatch(/^["']use server["']/);

    const provider = read("components/currency-provider.jsx");
    expect(provider).toContain('fetch("/api/currency"');
    // No action module may be imported by the provider at all.
    expect(provider).not.toMatch(/from "@\/actions\//);
    // ...and it is debounced, so clicking through four currencies is one write.
    expect(provider).toContain("SYNC_DELAY_MS");
  });

  // §6: "Avoid unnecessary synchronization when the preference has not
  // changed." Choosing the currency the account already holds writes nothing.
  it("does not write a preference the account already holds", () => {
    const provider = read("components/currency-provider.jsx");
    expect(provider).toContain("persisted.current === next");
    expect(provider).toContain("if (response.ok) persisted.current = next;");
  });

  // The guest demo has no account, so it makes no request whatsoever.
  it("makes no network call at all for a guest", () => {
    const demo = read("app/demo/layout.jsx");
    expect(demo).not.toMatch(/\bsync\b/);
    const main = read("app/(main)/layout.js");
    expect(main).toContain("sync>");
  });

  it("writes the cookie in the browser, so nothing waits on a round trip", () => {
    expect(read("components/currency-provider.jsx")).toContain("document.cookie");
  });

  // The client cannot convert locally unless it has the rates. If a layout
  // goes back to passing a server-computed scalar, this fails.
  it("hands the browser the rate table rather than a decision", () => {
    const main = read("app/(main)/layout.js");
    expect(main).toContain("presentationData");
    expect(main).toContain("rates={rates}");
    expect(main).not.toContain("displayConversion");

    const demo = read("app/demo/layout.jsx");
    expect(demo).toContain("rateTable");
    expect(demo).toContain("rates={rates}");
  });

  // Data and display stay separate: the demo no longer rewrites its own
  // figures when the currency changes.
  it("leaves the underlying data alone when the currency changes", () => {
    const store = read("lib/demo/store.js");
    expect(store).not.toContain("openingBalance: toMinorUnit");
    expect(store).not.toContain("row.amount * rate");
  });
});
