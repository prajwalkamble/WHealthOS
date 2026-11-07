import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock,
  Headphones,
  Repeat,
  ShieldCheck,
} from "lucide-react";
import { requireBillingAccount } from "@/lib/billing/account-gate";
import { checkoutState } from "@/lib/billing/service";
import { displayEntry } from "@/lib/billing/plans";
import { publicAvailability, plansAreOnSale } from "@/lib/billing/availability";
import { readCheckoutParams, checkoutUrl, pricingUrl } from "@/lib/billing/checkout-url";
import { enforcementEnabled } from "@/lib/billing/entitlements";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import PayButton from "./_components/pay-button";

export const metadata = {
  title: "Review your subscription · WHealthOS",
  // Not a page a search engine should hold: it is per-account, it is behind
  // sign-in, and an indexed checkout URL is a confusing thing to arrive at
  // from a search result.
  robots: { index: false, follow: false },
};

// Nothing here may be cached. Which of the states below applies depends on
// the account's live subscription and its open checkout attempt, and a cached
// "ready to pay" served to somebody who has already paid is the one mistake
// this page must not make.
export const dynamic = "force-dynamic";

// Deliberately not useCurrency(): this is the only screen in the app that
// must NOT follow the viewer's display currency. Plans are priced in INR and
// Razorpay charges in INR, so the figure here is the amount that will leave
// the account. Converting it to whatever the viewer happens to be reading in
// would misstate the charge on the one screen where that matters.
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const DURATIONS = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

const titleCase = (value) => `${String(value)[0].toUpperCase()}${String(value).slice(1)}`;

// A panel for every state that is not "ready to pay". One shape, so each of
// them gets the same explanation-then-way-out treatment rather than one being
// a dead end because it was written last.
const Panel = ({ icon: Icon, title, children, actions }) => (
  <Card className="mx-auto max-w-xl">
    <CardHeader>
      <Icon className="h-7 w-7 text-muted-foreground" aria-hidden />
      <CardTitle className="mt-2">{title}</CardTitle>
      <CardDescription className="text-sm leading-6">{children}</CardDescription>
    </CardHeader>
    {actions && (
      <CardContent className="flex flex-wrap gap-2">{actions}</CardContent>
    )}
  </Card>
);

export default async function BillingPage({ searchParams }) {
  // Before the parameters are even read. While the plans are discontinued
  // this page has nothing to show: there is no price to confirm and no terms
  // to state, because nothing is being sold. Somebody arriving on an old
  // checkout link is sent to the page that explains why, rather than to a
  // panel apologising for a product decision.
  //
  // This is the courtesy; /api/billing/checkout is the enforcement.
  if (!plansAreOnSale()) redirect("/pricing");

  const params = (await searchParams) ?? {};
  // Validated against the catalogue before anything is done with it. A plan
  // or a duration this application does not sell arrives here as null, and
  // `invalid` tells the difference between a broken link and an ordinary
  // visit to /billing with nothing chosen.
  const { plan, duration, invalid } = readCheckoutParams(params);

  // A link that names a plan but no period is a reasonable link; one that
  // names a period we do not offer is not, and is handled above.
  const interval = duration ?? "monthly";

  const availability = publicAvailability();

  if (invalid) {
    return (
      <Panel
        icon={CircleAlert}
        title="That link does not name a plan we sell"
        actions={
          <Button asChild>
            <Link href="/pricing">See the plans</Link>
          </Button>
        }
      >
        The address asked for something that is not in our catalogue, so
        nothing has been set up and nothing has been charged. Choose a plan
        from the pricing page and you will come straight back here.
      </Panel>
    );
  }

  if (!plan) {
    return (
      <Panel
        icon={CircleAlert}
        title="Choose a plan first"
        actions={
          <>
            <Button asChild>
              <Link href="/pricing">Compare the plans</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to WHealthOS</Link>
            </Button>
          </>
        }
      >
        This page reviews a subscription before you pay for it, so it needs to
        know which one. Nothing has been charged.
      </Panel>
    );
  }

  // Signed in, but is there an account to bill? If not, the consent step
  // comes first and the selection travels with them.
  const [userId, user] = await Promise.all([
    requireBillingAccount(checkoutUrl(plan, interval)),
    // Deliberately swallowed. This call buys one thing -- a prefilled email in
    // Razorpay's form -- and Clerk's backend API being slow, rate limited or
    // briefly unreachable is not a reason that nobody can pay. It also must
    // not reject before the gate beside it: requireBillingAccount works by
    // throwing a redirect, and in a Promise.all the first rejection wins, so
    // an unhandled failure here would swallow the redirect and show an error
    // boundary to somebody who simply needed to sign in.
    currentUser().catch(() => null),
  ]);
  // Prefilled into Razorpay's form for convenience, and treated as nothing
  // more than that: it is not verified identity and it decides no entitlement.
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const resolved = await checkoutState({ userId, planId: plan, interval, availability });
  const entry = displayEntry(resolved.entry);

  if (resolved.state === "no-selection") {
    return (
      <Panel
        icon={CircleAlert}
        title="That plan is not one we sell"
        actions={
          <Button asChild>
            <Link href="/pricing">See the plans</Link>
          </Button>
        }
      >
        Nothing has been set up and nothing has been charged.
      </Panel>
    );
  }

  if (resolved.state === "unavailable") {
    return (
      <Panel
        icon={Clock}
        title={`${entry.name} is not available yet`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/pricing">See the plans</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/contact">Contact us</Link>
            </Button>
          </>
        }
      >
        This deployment cannot take a payment for {entry.name} right now, so
        the checkout has not been opened. Nothing has been charged.
        {availability.developmentHint && (
          <span className="mt-3 block rounded-md border bg-muted/50 p-3 text-xs">
            {availability.developmentHint}
          </span>
        )}
      </Panel>
    );
  }

  if (resolved.state === "confirming") {
    return (
      <Panel
        icon={Clock}
        title="This subscription is being set up"
        actions={
          <>
            <Button asChild>
              <Link href="/billing/success">Check the status</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Go to WHealthOS</Link>
            </Button>
          </>
        }
      >
        Your payment has been authorised and Razorpay has not confirmed the
        first charge yet. There is nothing more to pay and nothing to do here —
        it will appear on your account on its own.
      </Panel>
    );
  }

  if (resolved.state === "already-on-plan") {
    return (
      <Panel
        icon={Check}
        title={`You are already on ${entry.name}`}
        actions={
          <>
            <Button asChild>
              <Link href="/dashboard">Go to WHealthOS</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/settings#plan">Manage plan</Link>
            </Button>
          </>
        }
      >
        Billed {entry.intervalLabel?.toLowerCase()}. Nothing further has been
        charged, and paying again is not something this page will let you do.
      </Panel>
    );
  }

  if (resolved.state === "other-plan") {
    const current = resolved.subscription;
    return (
      <Panel
        icon={Repeat}
        title={`You are on ${titleCase(current.planId)}`}
        actions={
          <>
            <Button asChild>
              <Link href="/settings#plan">Manage plan</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </>
        }
      >
        One subscription at a time. Moving to {entry.name} is a change to the
        one you have rather than a second purchase — it is made in Settings,
        and it takes effect at the end of the period you have already paid for,
        so you are never charged twice over for the same month.
      </Panel>
    );
  }

  // --- Ready to pay ---------------------------------------------------------

  const { added, inherited } = entry.features;
  const amountLabel = rupees.format(entry.amountRupees);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={pricingUrl(entry.planId, entry.interval)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to plans
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
        Review your subscription
      </h1>
      <p className="mt-2 text-muted-foreground">
        Check what you are getting and what it costs. Nothing is charged until
        you continue to Razorpay.
      </p>

      {/* Two columns from lg, where there is room for the summary to sit
          beside the detail rather than under a page of it. Below that the
          summary comes FIRST in the source so the thing being bought and its
          price are what a phone shows without scrolling -- order-last puts it
          back on the right at desktop widths. */}
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* --- The plan ---------------------------------------------------- */}
        <div className="order-2 space-y-6 lg:order-1">
          <Card>
            {/* No interval badge here. It said "Monthly" directly above a
                billing-period control whose selected option said "Monthly",
                beside a summary whose second row said "Billed Monthly" --
                three times, and on a phone the badge wrapped onto its own
                line between the two it was repeating. */}
            <CardHeader>
              <CardTitle className="text-2xl">{entry.name}</CardTitle>
              <CardDescription className="mt-1">{entry.tagline}</CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* The billing period, as two links rather than a toggle.
                  The URL is what decides the purchase, so changing the period
                  changes the URL -- there is no client state here that could
                  come to disagree with what the server priced. */}
              <fieldset>
                <legend className="text-sm font-semibold">Billing period</legend>
                <div
                  className="mt-2 inline-flex items-center gap-1 rounded-full border bg-muted/50 p-1"
                  role="group"
                  aria-label="Billing period"
                >
                  {DURATIONS.map(({ id, label }) => {
                    const active = id === entry.interval;
                    return (
                      <Link
                        key={id}
                        href={checkoutUrl(entry.planId, id)}
                        aria-current={active ? "true" : undefined}
                        className={
                          active
                            ? "rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm"
                            : "rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        }
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
                {entry.savingRupees && (
                  <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                    Yearly saves {rupees.format(entry.savingRupees)} against
                    paying monthly for twelve months.
                  </p>
                )}
              </fieldset>

              <div>
                <h2 className="text-sm font-semibold">
                  What {entry.name} adds
                </h2>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {added.map((feature) => (
                    <li key={feature.key} className="flex gap-2 text-sm">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                      <span>{feature.label}</span>
                    </li>
                  ))}
                </ul>
                {inherited.length > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Plus everything in the plans below it —{" "}
                    {inherited.length} further{" "}
                    {inherited.length === 1 ? "feature" : "features"}, including{" "}
                    {inherited
                      .slice(0, 3)
                      .map((feature) => feature.label.toLowerCase())
                      .join(", ")}
                    .{" "}
                    <Link
                      href="/pricing"
                      className="underline underline-offset-4"
                    >
                      See the full comparison
                    </Link>
                    .
                  </p>
                )}
                <p className="mt-3 text-sm">
                  <span className="font-medium">Transactions per day:</span>{" "}
                  {entry.transactionLimit}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-6">
                <h2 className="font-semibold">How the billing works</h2>
                <ul className="mt-2 space-y-1.5 text-muted-foreground">
                  <li>
                    {amountLabel} is charged now, and then {entry.renewal}{" "}
                    until you cancel.
                  </li>
                  <li>
                    You can cancel at any time from Settings. The subscription
                    then runs to the end of the period you have paid for and
                    does not renew.
                  </li>
                  <li>
                    Changing plans takes effect at the end of the current
                    period, so you are never charged twice over for the same
                    month. We do not calculate part-period refunds.
                  </li>
                  <li>{entry.tax.note}</li>
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  By continuing you agree to the{" "}
                  <Link href="/terms#plans" className="underline underline-offset-4">
                    Terms of Service
                  </Link>{" "}
                  and the{" "}
                  <Link href="/privacy" className="underline underline-offset-4">
                    Privacy Policy
                  </Link>
                  , including the billing terms in section 6.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --- Order summary ----------------------------------------------- */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium">{entry.name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Billed</dt>
                  <dd className="font-medium">{entry.intervalLabel}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Renews</dt>
                  <dd className="font-medium">{entry.renewal}</dd>
                </div>
                {entry.savingRupees && (
                  <div className="flex items-baseline justify-between gap-4 text-emerald-700 dark:text-emerald-400">
                    <dt>Yearly saving</dt>
                    <dd className="font-medium tabular-nums">
                      −{rupees.format(entry.savingRupees)}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-4 border-t pt-3">
                  <dt className="font-semibold">Due now</dt>
                  <dd className="text-2xl font-bold tabular-nums">
                    {amountLabel}
                  </dd>
                </div>
              </dl>

              {!enforcementEnabled() && (
                // The sentence somebody about to pay is entitled to read
                // before they do, said on the screen that takes the money and
                // not only in the Terms.
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-900 dark:text-amber-200">
                  <span className="font-semibold">Before you pay:</span> plan
                  limits are not enforced for anyone yet, so subscribing does
                  not change what you can do today. It starts a real recurring
                  subscription. You can cancel it at any time, and if you would
                  rather not pay for something that unlocks nothing, please
                  don&rsquo;t.
                </p>
              )}

              <PayButton
                planId={entry.planId}
                interval={entry.interval}
                label={`WHealthOS ${entry.name} — ${entry.intervalLabel}`}
                amountLabel={amountLabel}
                email={email}
                resumable={Boolean(resolved.attempt)}
              />

              <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                <p className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Razorpay is our payment processor. WHealthOS never sees or
                    stores your card, UPI or bank details.
                  </span>
                </p>
                <p className="flex items-start gap-1.5">
                  <Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Something wrong with a charge?{" "}
                    <Link
                      href="/contact"
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      Billing support
                    </Link>
                    .
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
