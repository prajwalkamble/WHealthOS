import EverythingIncluded from "./everything-included";
import PricingCta from "./pricing-cta";
import PricingFaq from "./pricing-faq";
import { FREE_FAQS } from "@/data/pricing";

// /pricing while the plans are discontinued.
//
// The other half of this is plan-pricing.jsx, and which one renders is
// decided by plansAreOnSale() in page.jsx. Keeping both means the switch is a
// configuration change rather than a rewrite, in either direction.
const FreePricing = ({ signedIn }) => {
  return (
    // No top padding: the marketing layout reserves the fixed header's space
    // for every page at once.
    <div className="container mx-auto px-4 pb-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-block rounded-full border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pricing
        </span>

        <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-5xl">
          Pay nothing.{" "}
          <span className="gradient-title">Every feature, for everyone.</span>
        </h1>

        <p className="mt-4 text-muted-foreground">
          The paid plans are discontinued. Everything that used to sit behind
          Pro or Intelligent — budgets, goals, analytics, exports and the AI
          work — is open to every account, at no cost and with no card.
        </p>

        {/* Which buttons these are depends on whether somebody is signed in,
            part-way through the demo, or here for the first time -- see
            PricingCta. The sample-data route leads for the first-time case
            deliberately: it is the only one that asks for nothing at all, no
            account, no email and nothing of theirs to type in. */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <PricingCta signedIn={signedIn} size="lg" />
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          The demo runs on sample data in your browser. Anything you add there
          stays in this browser, never reaches an account, and is not carried
          over if you sign up.
        </p>
      </div>

      <div className="mt-14">
        <EverythingIncluded />
      </div>

      <div className="mt-8">
        <PricingFaq
          faqs={FREE_FAQS}
          subtitle="What being free does and does not mean."
        />
      </div>

      <section className="mt-8 flex flex-col items-center justify-between gap-6 rounded-xl border bg-muted/40 p-6 md:flex-row md:p-8">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Ready to take control of your finances?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with sample data, or create an account and use your own.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <PricingCta signedIn={signedIn} />
        </div>
      </section>
    </div>
  );
};

export default FreePricing;
