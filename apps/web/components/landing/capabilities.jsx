import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CAPABILITIES } from "@/data/landing";
import Section from "./section";
import { cn } from "@/lib/utils";

// What someone can actually do with WHealthOS.
//
// id="features" is a contract, not a choice: the header nav's Features menu
// links to /#features, so renaming this anchor puts four dead links in the top
// bar. Section applies scroll-mt-28 so the fixed header does not cover the
// heading when the fragment is followed.
//
// This replaced six identical cards, each one icon above three lines of text,
// which told a reader the shape of a grid rather than the shape of a product.
// The cells are the same component but not the same size: the dashboard takes
// two columns, the data row takes all three, and the rest take one, so the
// section has a hierarchy instead of a wall. Every cell leads with the benefit
// in the reader's own terms and says what the feature does underneath it.
//
// The spans are also why nothing is left hanging: six cells across three
// columns ends in a half-empty row, and an empty cell reads as something that
// failed to load rather than as whitespace.
//
// A cell links out only where there is somewhere real to go -- the demo, and
// the demo's ledger. The other four describe signed-in sections, and sending a
// visitor to a sign-in wall from a feature card is not an answer to "what does
// this do". Nothing here renders a link with no destination.

// py-1 rather than a bare inline link: these are standalone actions at the
// bottom of a card, not words inside a sentence, so they get a row to be
// tapped rather than a 20px line of text.
const linkClass = cn(
  "mt-4 inline-flex w-fit items-center gap-1 rounded-sm py-1 text-sm font-medium text-primary",
  "underline-offset-4 transition-colors hover:underline",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background"
);

const Capabilities = () => (
  <Section
    id="features"
    eyebrow="What it does"
    title="Everything you need to run your own money"
    lead="Six parts of one application, not six products. Each is built and in use today."
  >
    <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {CAPABILITIES.map(({ icon: Icon, title, benefit, body, href, linkLabel, wide, full }) => (
        <li
          key={title}
          className={cn(
            "rounded-xl border bg-card p-6",
            // Only from lg, where there are three columns for a cell to span.
            wide && "lg:col-span-2",
            full && "lg:col-span-3"
          )}
        >
          {/* The full-width cell reads as two columns of its own from lg --
              the label and the promise on the left, the detail on the right --
              so a row spanning the whole grid is not one long line of text. */}
          <div className={cn("flex flex-col", full && "lg:flex-row lg:items-start lg:gap-12")}>
            <div className={cn(full && "lg:w-[23rem] lg:shrink-0")}>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon aria-hidden className="h-[18px] w-[18px]" />
              </span>

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {title}
              </h3>
              {/* The benefit is the heading a reader actually reads; the
                  feature name above it is the label. Ordered that way on
                  purpose. */}
              <p className="mt-2 text-balance text-lg font-semibold leading-snug tracking-tight">
                {benefit}
              </p>
            </div>

            <div className={cn("min-w-0", full && "lg:pt-1")}>
              <p className={cn("mt-2.5 text-sm leading-6 text-muted-foreground", full && "lg:mt-0")}>
                {body}
              </p>

              {href && (
                <Link href={href} className={linkClass}>
                  {linkLabel}
                  <ArrowUpRight aria-hidden className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>

    {/* The honest footnote. The pricing table lists multi-currency as a Pro
        feature and the About page labels it Planned; saying nothing here would
        leave the grid reading as the complete product. */}
    <p className="mt-6 text-sm text-muted-foreground">
      Multi-currency and the full financial intelligence layer are not built
      yet.{" "}
      <Link
        href="/about#glance"
        className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        The About page marks which is which
      </Link>
      .
    </p>
  </Section>
);

export default Capabilities;
