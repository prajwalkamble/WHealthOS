import dynamic from "next/dynamic";
import HeroSection from "@/components/hero";
import StatCounter from "@/components/landing/stat-counter";
import Capabilities from "@/components/landing/capabilities";
import Workflow from "@/components/landing/workflow";
import Trust from "@/components/landing/trust";
import Writing from "@/components/landing/writing";
import Faq from "@/components/landing/faq";
import FinalCta from "@/components/landing/final-cta";
import { buildStatTiles } from "@/lib/stat-tiles";
import { getLandingStats } from "@/lib/stats";

// The heaviest thing below the fold, split out of the initial bundle.
//
// Solutions renders four of the signed-in dashboard's own components, which
// pulls in Recharts. It is not visible in the first viewport and is not needed
// to understand what WHealthOS is, so the browser fetches it while the reader
// is still in the hero instead of before the page paints.
//
// It keeps its server rendering -- no `ssr: false`. Turning that off would
// blank the section for anyone without JavaScript and hand a crawler a hole to
// read, which is a worse trade than the bytes are worth. Nothing else on the
// page is dynamically imported: splitting a section that ships no JavaScript
// buys a request and saves nothing.
const Solutions = dynamic(() => import("@/components/landing/solutions"));

export const metadata = {
  title: "WHealthOS — Your finances, one clear picture",
  description:
    "Track your accounts, record what you spend, plan against a budget and see where the month actually went. WHealthOS is a personal financial workspace — no bank connection, no card number.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "WHealthOS",
    title: "WHealthOS — Your finances, one clear picture",
    description:
      "Accounts, transactions, budgets, goals and analytics in one place. Try the whole application on sample data without an account.",
  },
  // No twitter:creator and no image. There is no WHealthOS account to name and
  // no social card has been drawn, and inventing either is the same mistake as
  // inventing a statistic.
  twitter: {
    card: "summary",
    title: "WHealthOS — Your finances, one clear picture",
    description:
      "Accounts, transactions, budgets, goals and analytics in one place. Try the whole application on sample data without an account.",
  },
};

// The public landing page.
//
// The order is an argument rather than a stack of panels:
//
//   hero          what this is, and the product itself doing it
//   numbers       four figures out of our own database, as evidence
//   features      what you can actually do, with the benefit leading
//   solutions     three of the real dashboard's panels, each beside its idea
//   workflow      how you get from an empty account to a month that reads
//   trust         what is verified about handling the data, and what is not
//   writing       what has actually been published
//   faq           the questions none of the above answered
//   final cta     the one action the page has been arguing for
//
// Sections that a comparable SaaS page would carry are absent because
// WHealthOS cannot support them honestly, and an empty version of each would
// be worse than its absence:
//
//   customer logos / testimonials   there are no customers to quote and no
//                                   logos we are entitled to show
//   integrations                    Clerk, Resend, Supabase, Inngest, Arcjet
//                                   and Gemini are this application's own
//                                   infrastructure, not things a user
//                                   connects. A logo wall of our vendors
//                                   would read as integrations we do not have
//   awards, press, certifications   none exist; lib/legal/security.js records
//                                   that there is no SOC 2, no ISO 27001 and
//                                   no penetration test
//   a roadmap or progress bar       what is unfinished belongs on the About
//                                   page, not dressed up as a feature here
//   a pricing section               removed by instruction. Pricing has its
//                                   own page with the full three-tier table,
//                                   the billing-period switch and every
//                                   feature group, and the header's Pricing
//                                   link goes straight to it. A teaser here
//                                   was a second set of prices to keep in
//                                   step with the first
//
// Rendering: everything above is server-rendered except the hero's dashboard
// walkthrough, the four counting figures and the Solutions panels. The FAQ
// opens and closes with <details> rather than state.
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
    // No top padding: the marketing layout now reserves the fixed header's
    // space for every page at once. The bottom padding is this page's own --
    // it ends on a section with no background of its own, so it needs the gap
    // before the footer's rule.
    <div className="pb-24">
      <HeroSection />

      {/* The statistics band, in the treatment it has always had: a full-bleed
          muted slab of centred figures in the primary colour. The figures, the
          labels and the layout are unchanged.

          The only thing added is the count-up, and StatCounter is written so
          that it cannot change what is displayed: it animates the number it
          was handed and then renders that exact string, so the figure a reader
          ends on is the one lib/stat-tiles.js produced. A tile whose value
          could not be computed never reaches here -- buildStats drops it --
          so nothing counts up to a zero standing in for missing data. */}
      {statsData.length > 0 && (
        <section
          aria-labelledby="numbers"
          className="mt-20 py-20 bg-muted"
        >
          <h2 id="numbers" className="sr-only">
            WHealthOS in numbers
          </h2>
          <div className="container mx-auto px-4">
            <div
              className={`grid grid-cols-2 gap-8 ${STAT_COLUMNS[statsData.length]}`}
            >
              {statsData.map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="mb-2 text-4xl font-bold tabular-nums tracking-tight text-primary">
                    <StatCounter value={stat.value} />
                  </div>
                  <div className="text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <Capabilities />
      <Solutions />
      <Workflow />
      <Trust />
      <Writing />
      <Faq />
      <FinalCta />
    </div>
  );
}
