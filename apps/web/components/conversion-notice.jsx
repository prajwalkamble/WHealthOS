"use client";

import { Info } from "lucide-react";
import { useCurrency } from "@/components/currency-provider";

// One line, and only when something needs explaining.
//
// It renders in exactly one situation: a currency was chosen that could not
// be converted to, so the figures are still in the ledger's own currency.
// Without it the selector looks broken -- you pick yen, nothing changes, and
// nothing says why.
//
// It does NOT announce a successful conversion. That banner sat above every
// dashboard restating the rate and its date on every page view, which is
// noise once you have chosen a currency deliberately. The disclosure that
// converted amounts are indicative, at a reference rate rather than a dealing
// one, is in Settings -> Currency, where somebody looking for it will look
// and where it is not repeated forty times a day.
//
// Silent whenever the figures are simply what is stored, or are converted
// successfully -- which between them is the common case.
export default function ConversionNotice() {
  const { locked, selected, currency, ledger, conversionReason } = useCurrency();

  if (!locked) return null;

  const line = () => {
    if (conversionReason === "mixed-ledger") {
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
    return (
      <>
        No exchange rate is available for {selected} yet, so these figures are
        shown in {currency}, which is the currency they are held in. They are
        not being relabelled.
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
