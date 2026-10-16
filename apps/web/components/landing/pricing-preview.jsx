import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BILLING_PERIODS, HEADLINE_FEATURE, PLANS } from "@/data/pricing";
import Section from "./section";
import { cn } from "@/lib/utils";

// The three tiers, read from data/pricing.js.
//
// Not a second pricing table. Every name, price, tagline, daily cap and button
// below comes out of the same module the /pricing page is built from, so a
// price cannot be changed there and left stale here. What this page shows is
// the shape of the ladder and the one number that separates the tiers; the
// full feature comparison -- six groups of it -- stays on /pricing, which is
// where someone comparing tiers is going anyway.
//
// NOTE, carried over from data/pricing.js and still true: there is no billing
// integration behind these prices and the daily transaction cap is not
// enforced anywhere yet. Every button goes to /sign-up, which is what the
// plans' own cta fields say, so nothing here leads to a checkout that does not
// exist. That is a gap in the product, not in this component -- but it is the
// reason this section does not say "upgrade" or "subscribe".

// Same options as the /pricing table's own formatter, so ₹299 is rendered
// identically on both pages.
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const yearly = BILLING_PERIODS.find(({ id }) => id === "yearly");

const PricingPreview = () => (
  <Section
    id="pricing"
    eyebrow="Pricing"
    title="Start free. Pay when you outgrow it."
    lead={`Three plans, one flat monthly price each, and nothing charged per transaction.${
      yearly?.note ? ` Billed yearly instead and the price drops — ${yearly.note.toLowerCase()}.` : ""
    }`}
  >
    <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-3">
      {PLANS.map((plan) => (
        <li
          key={plan.id}
          className={cn(
            "flex flex-col bg-card p-6 md:p-7",
            // The middle tier is marked by a tinted surface and a pill, not by
            // a colour of its own: the pricing table makes the same choice, so
            // a visitor who picked a different accent in the theme customiser
            // gets their accent on both pages.
            plan.popular && "bg-primary/[0.06]"
          )}
        >
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold tracking-tight">{plan.name}</h3>
            {plan.popular && (
              <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Most popular
              </span>
            )}
          </div>

          <p className="mt-4 flex items-baseline gap-1.5">
            <span className="text-4xl font-bold tabular-nums tracking-tight">
              {plan.monthly === 0 ? "Free" : rupees.format(plan.monthly)}
            </span>
            {plan.monthly > 0 && (
              <span className="text-sm text-muted-foreground">/ month</span>
            )}
          </p>

          <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.tagline}</p>

          {/* The one figure that actually differs tier to tier, called out on
              its own in the pricing table too. */}
          <p className="mt-5 flex items-start gap-2 text-sm">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">{plan.limit}</span>{" "}
              <span className="text-muted-foreground">
                {HEADLINE_FEATURE.label.toLowerCase()}
              </span>
            </span>
          </p>

          <Button
            asChild
            variant={plan.popular ? "default" : "outline"}
            className="mt-6 w-full"
          >
            <Link href={plan.cta.href}>{plan.cta.label}</Link>
          </Button>
        </li>
      ))}
    </ul>

    <p className="mt-6 text-sm text-muted-foreground">
      <Link
        href="/pricing"
        className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Compare every feature side by side
      </Link>{" "}
      — budgets, goals, analytics, export, appearance and the AI work, plan by
      plan.
    </p>
  </Section>
);

export default PricingPreview;
