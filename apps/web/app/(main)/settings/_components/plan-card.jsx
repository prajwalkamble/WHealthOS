"use client";

import { useState } from "react";
import PrefetchLink from "@/components/navigation/prefetch-link";
import { BILLING_PERIODS } from "@/data/pricing";
import { paidPlans, rankOf, rupeesFor } from "@/lib/billing/plans";
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

const titleCase = (value) =>
  `${String(value)[0]?.toUpperCase() ?? ""}${String(value).slice(1)}`;

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
  // Whether the development entitlement override is unlocking this account.
  // Resolved on the server -- the override's variables are not NEXT_PUBLIC_ --
  // and used for nothing but the statement below. It is not the
  // authorisation, so a browser setting it to true gets the paragraph and
  // nothing else.
  devAccess = false,
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
  // change, and a change goes through cancellation or, upwards, through the
  // one-step upgrade below.
  const hasLive = Boolean(current);

  // The period this subscription is actually billed on, for the upgrade links.
  // The column is an enum (MONTHLY / YEARLY); the URL and the catalogue speak
  // lowercase. Falls back to the toggle only when there is no subscription to
  // read it from, which is the case where the links are not rendered anyway.
  const currentInterval =
    BILLING_PERIODS.find(
      (period) => period.id === String(current?.interval ?? "").toLowerCase()
    )?.id ?? interval;

  // Plans above this one, offered as a one-step move. Empty unless there is an
  // ACTIVE subscription with nothing already scheduled on it -- an upgrade that
  // has been asked for is reported in the panel above instead, because offering
  // the same button again would only produce a refusal.
  const upgrades =
    current && current.status === "ACTIVE" && !current.scheduledPlanId
      ? PLANS.filter((plan) => rankOf(plan.id) > rankOf(current.planId))
      : [];

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
          ) : hasLive ? (
            // Plans withdrawn while this account still has a live
            // subscription. The branch below says "there is nothing to pay",
            // which was being shown to somebody with a renewal date and a
            // Cancel button directly underneath it -- the rest of this file
            // already separates these two cases (see the notices below), the
            // description did not.
            <>
              New subscriptions are not being sold at the moment. Your existing
              subscription is unaffected and continues on the terms you agreed
              to; you can cancel it below at any time.{" "}
              <PrefetchLink href="/pricing" className="underline underline-offset-4">
                What it covers
              </PrefetchLink>
              .
            </>
          ) : enforced ? (
            // Plans withdrawn, nothing live on the account, and enforcement
            // on. The branch below would tell this person every feature is
            // included, which stopped being true on 2026-11-10 -- and with
            // nothing on sale there is no way for them to change that, so
            // saying so plainly is the least they are owed.
            <>
              New subscriptions are not being sold at the moment, so this
              account stays on the free plan and keeps the features that plan
              includes.{" "}
              <PrefetchLink href="/pricing" className="underline underline-offset-4">
                What that covers
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
        {/* First, because it explains everything under it.

            An account using features it has not paid for is owed an
            explanation, and this is the only place that can give it one. It
            names no plan on purpose: the override grants capabilities, not a
            subscription, and the panels below go on reporting the real plan --
            which for this account is Free. Those two statements look like a
            contradiction unless something says why they are not, so this
            says it rather than quietly suppressing one of them. */}
        {devAccess && (
          <div className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">Development access</p>
            <p className="mt-1">
              Every feature is unlocked on this account by a development
              override set in this environment&rsquo;s configuration, not by a
              payment. Anything below about your plan is accurate and
              unchanged: no subscription exists, nothing has been charged, and
              no payment record was created or modified. The override is
              switched off by removing{" "}
              <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
                DEV_FEATURE_OVERRIDE
              </code>{" "}
              and cannot operate on a deployment.
            </p>
          </div>
        )}

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
            {/* A plan change already asked for. Said here as well as on
                /billing because this is the card somebody opens to ask "did
                that work?", and a scheduled upgrade is otherwise invisible:
                the status above still says Pro, correctly, because Pro is
                what they are still being charged for. */}
            {current.scheduledPlanId && (
              <p className="mt-2 text-sm">
                Changing to {titleCase(current.scheduledPlanId)}
                {current.scheduledChangeAt
                  ? ` on ${day.format(new Date(current.scheduledChangeAt))}`
                  : " at the end of this period"}
                . You keep {titleCase(current.planId)} until then, and nothing
                further has been charged.
              </p>
            )}

            {(current.status === "ACTIVE" || current.status === "PAST_DUE") && (
              <div className="mt-3">
                <CancelSubscription />
              </div>
            )}
          </div>
        )}

        {/* Moving UP, in one step.
        
            This is the whole of the upgrade entry point, and what it is not
            matters as much as what it is: it is a link to the review screen,
            not a control that changes anything. /billing resolves the account's
            real subscription again, prices the target plan again, and only
            then offers a button -- so a hand-edited href reaches a review
            screen and buys nothing, exactly as the purchase links beside it do.
        
            Offered only from ACTIVE, and only for a plan above the current one.
            Both conditions are requestPlanChange()'s, repeated here so the card
            cannot advertise a move the service will refuse: a downgrade and a
            change of billing period are proration questions with no published
            policy, and a subscription that is PENDING, PAST_DUE, PAUSED or
            already stopping has no reliable cycle to schedule onto. Those
            still go through cancellation, which is the button above. */}
        {onSale && upgrades.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm font-semibold">Move to a higher plan</p>
            <p className="mt-1 text-sm text-muted-foreground">
              In one step, and without cancelling first. Nothing is charged
              today: your current period stays at the price you have paid, and
              the new plan starts when it renews.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {upgrades.map((plan) => {
                const amount = rupeesFor(plan, currentInterval);
                return (
                  <li key={plan.id}>
                    {availability === null ||
                    canSell(availability, plan.id, currentInterval) ? (
                      <Button asChild variant="outline" className="w-full font-semibold">
                        {/* The subscriber's OWN billing period, not whichever
                            one the toggle above happens to be showing -- an
                            upgrade keeps the period they are already on unless
                            they deliberately change it on the review screen. */}
                        <PrefetchLink
                          href={checkoutUrl(plan.id, currentInterval)}
                          intent="none"
                        >
                          Upgrade to {plan.name} — {rupees.format(amount)}
                          {currentInterval === "yearly" ? "/year" : "/month"}
                        </PrefetchLink>
                      </Button>
                    ) : (
                      <Button type="button" disabled className="w-full font-semibold">
                        {plan.name} not available yet
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* The free state. Nothing to pick, so no period toggle and no plan
            tiles -- and no disabled buttons either, which would only invite
            somebody to wonder what they are missing. An account that still
            has a live subscription keeps the panel above this, including the
            way to cancel it. */}
        {!onSale && !hasLive && !enforced && (
          <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            Every feature is included at no cost — budgets, goals, analytics,
            exports and the AI features. There is no plan to choose and no card
            on file.
          </p>
        )}

        {/* The same state with enforcement on: it names what the free plan
            does not include rather than claiming everything is in it. Both
            are gated on `enforced` so that neither can be the one on screen
            while the other is true. */}
        {!onSale && !hasLive && enforced && (
          <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            The free plan covers your accounts, transactions, cards, the
            dashboard and the financial overview, with no card on file. Budgets,
            goals, analytics, exports, the customisation settings and the AI
            features belong to the paid plans, which are not on sale at the
            moment.
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
