import Link from "next/link";
import { landingActions } from "@/lib/landing/cta";
import { Button } from "@/components/ui/button";
import { publicAvailability } from "@/lib/billing/availability";
import { enforcementEnabled } from "@/lib/billing/entitlements";
import { PLAN_FAQS } from "@/data/pricing";
import PricingPlans from "./pricing-plans";
import PricingFaq from "./pricing-faq";

// /pricing while the plans are on sale.
//
// The three-column comparison, the monthly/yearly toggle and a paid CTA per
// plan. The other half of this is free-pricing.jsx; page.jsx picks between
// them on plansAreOnSale().
//
// No payment window opens here. Each paid CTA is a link to /billing, where
// the plan is priced on the server and the renewal and cancellation terms are
// stated before anybody is charged -- tests/checkout-url.test.js asserts that
// /billing's pay button is the only surface that can open one.
//
// The notice below is the third copy of one sentence, and the reason there are
// three is that this is the page people decide on. /billing says it on the
// screen that takes the money and the Settings plan card says it to somebody
// already paying, but both are downstream of the choice: a visitor who reads
// a comparison table, picks Pro and clicks through has already decided by the
// time either of those appears. The audit of 2026-11-10 recorded its absence
// here as the one place a live checkout was advertised without it.
//
// Conditional on enforcementEnabled(), exactly as the other two are, so it is
// not a sentence anybody has to remember to delete: the day plans are enforced
// it stops rendering on all three surfaces at once. That day was 2026-11-10,
// so it no longer renders.
//
// A second banner used to sit beneath it, covering the one claim enforcement
// did not settle: the comparison table prints a transactions-per-day figure
// for each plan and nothing applies it, because BILLING_QUOTA_ENFORCEMENT is
// a separate switch and is still off. It was removed on the operator's
// instruction. The disclosure itself is still on the page -- the FAQ answer
// for "What are the transactions-per-day figures?" says they are not applied
// to anyone today, and tests/pricing-copy.test.js asserts that an answer says
// so for as long as the quota stays off. That assertion reads PLAN_FAQS, not
// this file, which is why removing the banner does not fail it.
const PlanPricing = ({ signedIn, duration }) => {
  // The session is resolved by the page and handed down; the rule itself is
  // lib/landing/cta.js, shared with the landing page and /about.
  const { primary, secondary } = landingActions(signedIn, {
    signUp: "Get Started Free",
    demo: "Explore WHealthOS",
  });

  return (
  <div className="container mx-auto px-4 pb-20">
    <div className="mx-auto max-w-2xl text-center">
      <span className="inline-block rounded-full border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Pricing
      </span>

      <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-5xl">
        Simple pricing.{" "}
        <span className="gradient-title">Smarter financial management.</span>
      </h1>

      <p className="mt-4 text-muted-foreground">
        Start for free. Upgrade when you need more control, more capacity, and
        deeper insights into your finances.
      </p>
    </div>

    {!enforcementEnabled() && (
      <p
        role="status"
        className="mx-auto mt-8 max-w-2xl rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-center text-sm leading-6 text-amber-900 dark:text-amber-200"
      >
        <span className="font-semibold">Worth knowing before you compare:</span>{" "}
        plan limits are not enforced for anyone yet, so every feature below is
        already included in the free account. Subscribing starts a real
        recurring payment and does not change what you can do today.
      </p>
    )}

    <div className="mt-10">
      <PricingPlans
        signedIn={signedIn}
        initialDuration={duration}
        availability={publicAvailability()}
      />
    </div>

    <div className="mt-14">
      <PricingFaq faqs={PLAN_FAQS} />
    </div>

    <section className="mt-8 flex flex-col items-center justify-between gap-6 rounded-xl border bg-muted/40 p-6 md:flex-row md:p-8">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          Ready to take control of your finances?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Start with WHealthOS for free, or explore it first with sample data.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-3">
        {/* Somebody signed in already has the free account this offers to
            create, and does not need the sample data either. */}
        <Button asChild>
          <Link href={primary.href}>{primary.label}</Link>
        </Button>
        {secondary && (
          <Button variant="outline" asChild>
            <Link href={secondary.href}>{secondary.label}</Link>
          </Button>
        )}
      </div>
    </section>
  </div>
  );
};

export default PlanPricing;
