"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CurrencySelector from "@/components/currency-selector";
import { useCurrency } from "@/components/currency-provider";
import { CURRENCY_SOURCE } from "@/lib/currency/resolve";

// Where the display currency is explained, as opposed to the header, where it
// is merely changed.
//
// Two things belong here that will not fit in a toolbar control. The first is
// the distinction the whole feature turns on: this changes what you READ, not
// what any account holds. The second is where the current choice came from --
// somebody who has never touched this is looking at a guess made from their
// IP address, and saying so is the difference between a sensible default and
// an unexplained one.
const EXPLANATION = {
  [CURRENCY_SOURCE.MANUAL]: "You chose this currency.",
  [CURRENCY_SOURCE.ACCOUNT]: "Saved to your account, so it follows you to any device.",
  [CURRENCY_SOURCE.WORKSPACE]: "From your workspace's reporting currency.",
  [CURRENCY_SOURCE.GEO]: "Suggested from where you appear to be. Change it any time.",
  [CURRENCY_SOURCE.DEFAULT]: "The default, because we could not tell where you are.",
};

export default function CurrencyCard() {
  const {
    currency,
    name,
    symbol,
    source,
    country,
    convertible,
    locked,
    selected,
    converted,
    conversionReason,
    ledger,
    rateAsOf,
  } = useCurrency();

  return (
    <Card id="currency">
      <CardHeader>
        <CardTitle>Currency</CardTitle>
        <CardDescription>
          The currency your figures are shown in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              <span aria-hidden="true" className="text-muted-foreground">{symbol}</span>{" "}
              {currency} — {name}
            </p>
            <p className="text-sm text-muted-foreground">
              {EXPLANATION[source] ?? EXPLANATION[CURRENCY_SOURCE.DEFAULT]}
              {source === CURRENCY_SOURCE.GEO && country ? ` (${country})` : ""}
            </p>
          </div>
          {/* The same control as the header. On a phone the header hides it,
              so this is where it lives. */}
          <CurrencySelector align="end" />
        </div>

        {/* The sentence this whole feature depends on being understood. */}
        <p className="text-sm text-muted-foreground">
          This changes what you read, not what you hold. Your accounts and
          transactions keep their own currencies, and nothing stored is
          rewritten when you change this.
        </p>

        {/* Said plainly rather than hidden. A choice that is saved but not
            applied is fine; one that silently does nothing is not. */}
        {locked && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            You have chosen <strong>{selected}</strong>, and it is saved.
            {conversionReason === "mixed-ledger" ? (
              <>
                {" "}
                Your accounts are held in more than one currency
                {ledger?.length ? ` (${ledger.join(", ")})` : ""}, so there is
                no single rate that converts them all. Your figures stay in
                the currency each is held in.
              </>
            ) : (
              <>
                {" "}
                There is no exchange rate available for it yet, so your figures
                are shown in {currency} — the currency they are held in.
                Relabelling them would leave the numbers unchanged and the
                amounts wrong.
              </>
            )}
          </p>
        )}

        {converted && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Your figures are converted into {currency} at the European Central
            Bank reference rate{rateAsOf ? ` of ${rateAsOf}` : ""}. That is an
            indicative rate, not a dealing rate: treat the converted amounts as
            estimates, and the amounts your accounts actually hold as the real
            ones.
          </p>
        )}

        {!convertible && (
          <p className="text-sm text-muted-foreground">
            Exchange rates come from the European Central Bank, which does not
            publish {currency}. Totals that mix {currency} with another
            currency are shown per currency rather than converted — we will not
            invent a rate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
