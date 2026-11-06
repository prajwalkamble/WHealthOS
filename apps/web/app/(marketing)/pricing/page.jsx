import { auth } from "@clerk/nextjs/server";
import { plansAreOnSale } from "@/lib/billing/availability";
import { readCheckoutParams } from "@/lib/billing/checkout-url";
import PlanPricing from "./_components/plan-pricing";
import FreePricing from "./_components/free-pricing";

export const metadata = {
  title: "Pricing · WHealthOS",
  description:
    "Start free and upgrade when you need more capacity, more control and AI-powered insight into your finances.",
};

// Two pricing pages, one switch.
//
// plansAreOnSale() is the same flag /billing, /api/billing/checkout and the
// Settings plan card read, which is the point: the page that advertises the
// plans and the endpoint that sells them cannot disagree, because there is
// only one thing to disagree with. A page claiming the plans are
// discontinued while checkout takes money -- or offering a plan the endpoint
// refuses -- are both states this makes unreachable.
//
// A server component for auth(): this layout mounts no ClerkProvider for a
// signed-out visitor, so useAuth() in the browser would have nothing to read.
export default async function PricingPage({ searchParams }) {
  const [{ userId }, params] = await Promise.all([auth(), searchParams ?? {}]);

  if (!plansAreOnSale()) {
    return <FreePricing signedIn={Boolean(userId)} />;
  }

  // Only the period is read here. The plan in the URL is for /billing, which
  // this page links to; a visitor coming back from there keeps the billing
  // toggle they were looking at rather than being reset to monthly. Validated
  // against the catalogue, so a hand-edited ?duration= arrives as null.
  const { duration } = readCheckoutParams(params);

  return <PlanPricing signedIn={Boolean(userId)} duration={duration} />;
}
