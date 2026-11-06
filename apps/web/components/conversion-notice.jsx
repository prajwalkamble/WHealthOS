"use client";

import { Info } from "lucide-react";
import { useCurrency } from "@/components/currency-provider";

// One line saying what the figures on this page are.
//
// It renders in exactly two situations, and nothing in between:
//
//   converted -- the amounts have been multiplied by a published rate, so
//                they are estimates and the date behind them matters;
//   refused   -- a currency was chosen that could not be converted to, so the
//                figures are still in the ledger's own currency and the
//                selector would otherwise look broken.
//
// Silent when the figures are simply what is stored, which is the common case
// and needs no explanation.
export default function ConversionNotice() {
  const {
    converted,
    locked,
    selected,
    currency,
    ledger,
    conversionReason,
    rateAsOf,
    rateStale,
  } = useCurrency();

  if (!converted && !locked) return null;

  const line = () => {
    if (locked && conversionReason === "mixed-ledger") {
      return (
        <>
          Your accounts are held in more than one currency
          {ledger?.length ? ` (${ledger.join(", ")})` : ""}, so these figures
          are not converted into {selected}. A single total across different
          currencies would need a rate for each, and showing one without that
          would misstate it.
        </>
      );
    }
    if (locked) {
      return (
        <>
          No exchange rate is available for {selected} yet, so these figures
          are shown in {currency}, which is the currency they are held in.
          They are not being relabelled.
        </>
      );
    }
    return (
      <>
        Converted to {currency} at the European Central Bank reference rate
        {rateAsOf ? ` of ${rateAsOf}` : ""}. Indicative only — not a dealing
        rate, and not what a bank would settle at.
        {rateStale ? " This rate is older than usual; a newer one has not been published or retrieved." : ""}
      </>
    );
  };

  return (
    <p
      // Informational, not an alert: nothing is wrong, and a finance
      // dashboard that cries wolf about its own formatting trains people to
      // ignore the line that will one day matter.
      className="flex items-start gap-2 text-xs text-muted-foreground"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{line()}</span>
    </p>
  );
}
