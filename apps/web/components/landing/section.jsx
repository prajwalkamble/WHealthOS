import { cn } from "@/lib/utils";

// The landing page's layout rhythm, in one place.
//
// SHELL is the page's content width, and it is deliberately the footer's own
// width rather than Tailwind's `container`. `container` resolves to the current
// breakpoint -- 1536px from 2xl up -- while the footer's shell is 84rem. The
// two disagreed, so on a wide screen a heading on this page sat 96px outside
// the footer column directly beneath it. One number now, read by both.
export const SHELL = "mx-auto w-full max-w-[84rem] px-5 sm:px-8";

// The type scale, measured off the reference rather than guessed at. Rendered
// at 1440 it uses a 44px/600 section heading and an 18px body with a 1.8 line
// height.
//
// The eyebrow is gone, and that is the biggest single change on this page.
// Every section used to open with `text-base font-semibold uppercase
// tracking-[0.12em]` -- "WHAT IT DOES", "HOW IT WORKS", "IN THE PRODUCT" --
// and six more of them sat on the capability cards. A tracked-capitals label
// above a heading is the most reliable tell that a page was generated rather
// than written, and it was never carrying information the heading beneath it
// did not already have. Where the label was the honest name for a section,
// it became the heading instead: "Questions / Before you sign up" is now just
// "FAQs".
//
// One deliberate departure, recorded so the next person does not "correct" it
// back: the reference's container is 1416px of a 1440px viewport, very nearly
// full bleed. This page stays at 84rem because that is the footer's width, and
// a heading that did not line up with the column beneath it was the thing the
// shared SHELL was introduced to fix.
export const HEADING =
  "text-balance text-3xl font-semibold tracking-tight md:text-[2.5rem] md:leading-[1.1] lg:text-[3rem] lg:leading-[1.08]";
// text-pretty on both running styles. It is the one line of typographic
// housekeeping that shows everywhere at once: without it a paragraph is free
// to leave a single short word alone on its last line, and at 375 the
// capability bodies and the solution rows did exactly that. balance is for
// heads, where there are few enough lines to even out; pretty is for body,
// where the browser only has to stop the last line being a stub.
export const LEAD = "text-pretty text-lg leading-[1.8] text-muted-foreground";
// The reference's dominant card: 20px corners, a hairline border and no
// shadow. Counted 15 of them against 6 of the next most common geometry.
export const CARD = "rounded-[20px] border bg-card";
export const BODY = "text-pretty text-base leading-[1.8] text-muted-foreground";

// Sections are spaced with a top margin, never with padding on both sides of
// the boundary. The old page gave every section py-20, so each gap between two
// of them was 160px rather than 80px and no single value said what the rhythm
// was. Margins collapse into one gap; paddings add up.
//
// Three steps rather than one. Every section used to sit at the same mt-20
// md:mt-28, which reads as a stack of equal panels however different the
// sections are; a page has a rhythm when the gap before a dense grid differs
// from the gap before a quiet close.
const GAP = {
  s: "mt-16 md:mt-24",
  m: "mt-20 md:mt-28",
  l: "mt-24 md:mt-36",
};

const Section = ({
  id,
  title,
  lead,
  headingHidden,
  gap = "m",
  children,
  className,
  innerClassName,
}) => (
  <section aria-labelledby={id} className={cn("reveal", GAP[gap] ?? GAP.m, className)}>
    <div className={cn(SHELL, innerClassName)}>
      <h2
        id={id}
        className={cn(
          // scroll-mt clears the fixed header when the heading is the target
          // of a #fragment -- the header nav links to /#features.
          "max-w-3xl scroll-mt-28",
          HEADING,
          // Some sections name themselves for assistive technology without
          // showing a heading: the statistics band is evidence under the hero,
          // not a chapter of the page.
          headingHidden && "sr-only"
        )}
      >
        {title}
      </h2>

      {lead && !headingHidden && (
        <p className={cn("mt-4 max-w-2xl", LEAD)}>{lead}</p>
      )}

      {children}
    </div>
  </section>
);

export default Section;
