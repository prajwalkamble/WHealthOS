"use client";

import { useCurrency } from "@/components/currency-provider";

// The only part of the hero's backdrop that carries money.
//
// It exists as a client component for one structural reason, which
// tests/currency.test.js enforces: every surface that formats an amount goes
// through the provider or through serverCurrency, so that an amount can never
// keep its value and change its symbol. The backdrop converted with the raw
// helpers instead, and the test caught it -- correctly. serverCurrency is the
// wrong path here because it resolves a signed-in user's own ledger, and
// nobody reading the landing page has one; the provider is already mounted
// around the whole page by app/(marketing)/page.jsx for the walkthrough, so
// this reads the same decision the dashboard below it reads, and the two
// cannot disagree.
//
// Everything else about the drawing -- the path, the grid, the guides, the
// dot -- stays in the server component. This is text, not geometry.

// Rounded to two significant figures before formatting.
//
// Compact notation only abbreviates from a thousand up, so once the ladder was
// converted out of rupees the lower rungs stopped being round: a dollar axis
// read 1.6K, 1.3K, 952.6, 635.1, 317.6, 0. An axis is a ladder of round
// numbers by construction, and 952.6 is a measurement.
const nice = (value) => {
  if (!value) return 0;
  const magnitude = 10 ** (Math.floor(Math.log10(Math.abs(value))) - 1);
  return Math.round(value / magnitude) * magnitude;
};

// The ladder's own compact formatter rather than the provider's formatCompact.
// That one sets maximumFractionDigits to 1, which in compact notation also
// pins the minimum, so the rungs came out "90.0K" and the bottom one "0.0".
// Right for a column of figures that should agree on their decimals, wrong for
// an axis whose every rung is round by construction.
const compact = (value, currency, locale) => {
  const rounded = nice(value);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(rounded) >= 1000 ? 1 : 0,
  }).format(rounded);
};

/** The value axis labels. `rungs` is [[y, amountInLedgerCurrency], ...]. */
export const HeroChartAxisLabels = ({ rungs }) => {
  const { convert, currency, locale } = useCurrency();

  return rungs.map(([y, value]) => (
    <text key={y} x="58" y={y} dominantBaseline="middle">
      {compact(convert(value), currency, locale)}
    </text>
  ));
};

/**
 * The callout's two money values.
 *
 * Fixed decoration, and deliberately so: the card was asked for explicitly
 * after the alternative was put and declined, so it stays. Nobody should read
 * these as a reading of anything -- lib/demo/data.js drifts each month, so the
 * dashboard a few hundred pixels below will not always agree with them. What
 * they are not is wrong about the currency.
 */
export const HeroChartCalloutFigures = ({ x, changeX, y }) => {
  const { format, convert, currency, locale } = useCurrency();

  return (
    <>
      <text className="hero-chart-callout-value" x={x} y={y}>
        {format(108215)}
      </text>
      <text className="hero-chart-callout-change" x={changeX} y={y}>
        {`+${compact(convert(5420), currency, locale)} (+5.3%)`}
      </text>
    </>
  );
};
