import Link from "next/link";
import { Button } from "@/components/ui/button";
import { publicAvailability } from "@/lib/billing/availability";
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
const PlanPricing = ({ signedIn, duration }) => (
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
            create. */}
        {signedIn ? (
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/sign-up">Get Started Free</Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/demo">Explore WHealthOS</Link>
        </Button>
      </div>
    </section>
  </div>
);

export default PlanPricing;
