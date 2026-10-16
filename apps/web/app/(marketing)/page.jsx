import HeroSection from "@/components/hero";
import Capabilities from "@/components/landing/capabilities";
import Workflow from "@/components/landing/workflow";
import Trust from "@/components/landing/trust";
import PricingPreview from "@/components/landing/pricing-preview";
import Faq from "@/components/landing/faq";
import { buildStatTiles } from "@/lib/stat-tiles";
import { getLandingStats } from "@/lib/stats";

export const metadata = {
  description:
    "Track your accounts, record what you spend, plan against a budget and see where the month actually went. WHealthOS is a personal financial workspace — no bank connection, no card number.",
  alternates: { canonical: "/" },
};

// The public landing page.
//
// A server component from top to bottom. The only client JavaScript it needs is
// the dashboard walkthrough in the hero, which is its own island -- the
// statistics, the capability grid, the workflow, the trust list, the pricing
// preview and the FAQ all render on the server and ship nothing. The FAQ opens
// and closes with <details>, not state.
//
// The order is an argument rather than a list of panels:
//
//   hero          what this is, and the product itself doing it
//   numbers       four figures out of our own database, as evidence
//   features      what you can actually do, with the benefit leading
//   workflow      how you get from an empty account to a month that reads
//   trust         what is verified about handling the data, and what is not
//   pricing       what it costs, read from the pricing page's own module
//   faq           the questions none of the above answered
//
// There is no closing call-to-action section, deliberately. The footer opens
// with one -- "Take control of your finances" and a Get Started button, on
// every page -- and a page-level CTA immediately above it was removed earlier
// precisely because two of them stacked said the same thing twice. The FAQ
// closes with a single line pointing at the demo instead.
//
// The band drops a figure it cannot compute rather than showing a gap; the
// About page renders the same tiles and shows the gap. Labels and formatting
// are shared, so the two cannot drift.
const buildStats = (stats) =>
  buildStatTiles(stats).filter(({ value }) => value !== null);

// Literal class names so Tailwind generates them; the column count follows how
// many stats are shown.
const STAT_COLUMNS = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

export default async function Home() {
  // The landing page must render even when the database is unreachable, so a
  // failed lookup hides the stats instead of taking the page down with it.
  const statsData = buildStats(
    await getLandingStats().catch((error) => {
      console.error("Failed to load landing stats:", error);
      return null;
    })
  );

  return (
    // pt clears the fixed header, which the marketing layout does not reserve
    // space for. The same values the About and pricing pages use -- it was
    // mt-40 here, 160px, which left a third of the first viewport empty above
    // a headline whose job is to be read immediately.
    <div className="pb-24 pt-28 md:pt-32">
      <HeroSection />

      {/* The statistics band, kept exactly as it was: a full-bleed muted
          slab of centred figures in the primary colour. It is the one part of
          this page the redesign leaves alone, by instruction -- the figures,
          their labels, the layout and the colour are all the originals. It is
          also the only full-width band on the page, so it breaks out of the
          content shell the sections below use rather than sitting inside it. */}
      {statsData.length > 0 && (
        <section className="mt-20 py-20 bg-muted">
          <div className="container mx-auto px-4">
            <div
              className={`grid grid-cols-2 gap-8 ${STAT_COLUMNS[statsData.length]}`}
            >
              {statsData.map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="mb-2 text-4xl font-bold tabular-nums tracking-tight text-primary">
                    {stat.value}
                  </div>
                  <div className="text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <Capabilities />
      <Workflow />
      <Trust />
      <PricingPreview />
      <Faq />
    </div>
  );
}
