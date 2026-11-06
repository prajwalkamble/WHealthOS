"use client";

import { useState } from "react";
import PrefetchLink from "@/components/navigation/prefetch-link";
import { BILLING_PERIODS } from "@/data/pricing";
import { paidPlans, rupeesFor } from "@/lib/billing/plans";
import { canSell } from "@/lib/billing/availability";
import { checkoutUrl } from "@/lib/billing/checkout-url";
import { Button } from "@/components/ui/button";
import CancelSubscription from "./cancel-subscription";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

const PLANS = paidPlans();

// What each normalised status means to the person reading it. The vocabulary
// is lib/billing/status.js's; the sentences are for someone who has just paid
// money and wants to know whether it worked.
const STATE = {
  PENDING: {
    tone: "warn",
    title: "Waiting for your first payment",
    body: "The subscription is set up but has not been charged yet. Paid features stay locked until it is.",
  },
  ACTIVE: { tone: "good", title: "Active", body: null },
  PAST_DUE: {
    tone: "bad",
    title: "A payment did not go through",
    body: "Razorpay is retrying. Your access runs to the end of the period you have already paid for.",
  },
  CANCEL_SCHEDULED: {
    tone: "warn",
    title: "Stopping at the end of the period",
    body: "You keep everything until then. Nothing further will be charged.",
  },
  CANCELLED: { tone: "muted", title: "Cancelled", body: null },
  COMPLETED: { tone: "muted", title: "Finished", body: null },
  EXPIRED: { tone: "muted", title: "Expired", body: null },
  PAUSED: { tone: "warn", title: "Paused", body: "Paid features are locked while it is paused." },
};

const TONES = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  bad: "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200",
  muted: "border-border bg-muted/50 text-muted-foreground",
};

// Where a signed-in person sees, changes or stops a plan.
//
// It does not take the payment. This card used to open the Razorpay modal
// itself, which made two surfaces in the application capable of charging
// somebody -- and the one in Settings showed no renewal terms, no
// cancellation policy and nothing to agree to. Both now link to /billing,
// which is the single review-and-pay screen.
const PlanCard = ({
  summary,
  enforced,
  // Whether plans are offered at all. Read on the server -- the switch is a
  // plain environment variable, not a NEXT_PUBLIC_ one, so the browser cannot
  // see it and must be told.
  onSale = false,
  availability = null,
  initialPlanId = null,
  initialInterval = null,
}) => {
  // The period someone was looking at on /pricing, if they came from there.
  // Validated against the catalogue rather than used as given: a query string
  // is not a source of truth even for which toggle is highlighted.
  const [interval, setInterval] = useState(
    BILLING_PERIODS.some((period) => period.id === initialInterval)
      ? initialInterval
      : "monthly"
  );

  const highlighted = PLANS.some((plan) => plan.id === initialPlanId) ? initialPlanId : null;

  const subscription = summary?.subscription ?? null;
  const pending = summary?.pending ?? null;
  const current = subscription ?? pending;
  const state = current ? STATE[current.status] ?? null : null;

  // One live subscription at a time, enforced by the database. While one
  // exists the other plans are not offered as a second purchase -- that is a
  // change, and a change goes through cancellation.
  const hasLive = Boolean(current);

  return (
    <Card id="plan">
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <CardDescription>
          {onSale ? (
            <>
              Payments are taken by Razorpay — card, UPI and bank details are
              entered on Razorpay&rsquo;s own checkout and never reach
              WHealthOS.{" "}
              <PrefetchLink href="/pricing" className="underline underline-offset-4">
                Compare what each plan includes
              </PrefetchLink>
              .
            </>
          ) : (
            <>
              WHealthOS is free and every feature is included in your account.
              There is nothing to choose and nothing to pay.{" "}
              <PrefetchLink href="/pricing" className="underline underline-offset-4">
                What that covers
              </PrefetchLink>
              .
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {current && state && (
          <div className={cn("rounded-lg border p-4", TONES[state.tone])}>
            <p className="text-sm font-semibold">
              {current.planId[0].toUpperCase()}
              {current.planId.slice(1)} — {state.title}
            </p>
            {state.body && <p className="mt-1 text-sm">{state.body}</p>}
            {current.currentEnd && (
              <p className="mt-1 text-sm">
                {current.status === "ACTIVE"
                  ? `Renews on ${day.format(new Date(current.currentEnd))}.`
                  : `Access until ${day.format(new Date(current.currentEnd))}.`}
              </p>
            )}
            {(current.status === "ACTIVE" || current.status === "PAST_DUE") && (
              <div className="mt-3">
                <CancelSubscription />
              </div>
            )}
          </div>
        )}

        {/* The free state. Nothing to pick, so no period toggle and no plan
            tiles -- and no disabled buttons either, which would only invite
            somebody to wonder what they are missing. An account that still
            has a live subscription keeps the panel above this, including the
            way to cancel it. */}
        {!onSale && !hasLive && (
          <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            Every feature is included at no cost — budgets, goals, analytics,
            exports and the AI features. There is no plan to choose and no card
            on file.
          </p>
        )}

        {onSale && !hasLive && (
          <>
            <div
              role="radiogroup"
              aria-label="Billing period"
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 p-1"
            >
              {BILLING_PERIODS.map(({ id, label, note }) => {
                const active = interval === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setInterval(id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                    {note && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          active
                            ? "bg-white/20"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        )}
                      >
                        {note}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {PLANS.map((plan) => {
                const amount = rupeesFor(plan, interval);
                return (
                  <li
                    key={plan.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-lg border p-4",
                      plan.id === highlighted && "border-primary ring-1 ring-primary/40"
                    )}
                  >
                    <div>
                      <p className="font-semibold">{plan.name}</p>
                      <p className="text-sm text-muted-foreground">{plan.tagline}</p>
                    </div>
                    <p className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold tabular-nums">
                        {rupees.format(amount)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {interval === "monthly" ? "/ month" : "/ year"}
                      </span>
                    </p>
                    {availability === null || canSell(availability, plan.id, interval) ? (
                      <Button asChild className="mt-auto w-full font-semibold">
                        <PrefetchLink href={checkoutUrl(plan.id, interval)} intent="none">
                          Choose {plan.name} — {rupees.format(amount)}
                        </PrefetchLink>
                      </Button>
                    ) : (
                      // Disabled rather than absent. This card used to be
                      // hidden entirely when Razorpay was unconfigured, which
                      // left the operator with no card and no explanation --
                      // the same dead end as the pricing page's button, just
                      // quieter.
                      <Button type="button" disabled className="mt-auto w-full font-semibold">
                        Not available yet
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* Only while there is a checkout to misconfigure. */}
        {onSale && availability?.developmentHint && (
          <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            {availability.developmentHint}
          </p>
        )}

        {/* Said here rather than only in the Terms. While enforcement is off
            every account keeps every feature whatever it has paid, so a
            subscription buys a subscription and nothing else -- and somebody
            about to pay is entitled to know that before they do. */}
        {/* Shown to the two people it concerns: somebody who could subscribe,
            and somebody who already has. With the plans discontinued and no
            subscription on the account there is nothing to warn about, and a
            warning about buying something you cannot buy reads as a fault. */}
        {!enforced && (onSale || hasLive) && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            Paid features are not yet locked for anyone, so subscribing does not
            change what you can do today. Billing is live and verified end to
            end; the switch that starts enforcing plans has not been thrown.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default PlanCard;
