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
// at 1440 it uses a 40px/600 section heading, an 18px body with a 1.8 line
// height, and an uppercase eyebrow well above the 12px a label usually gets.
//
// Two deliberate departures, both recorded so the next person does not
// "correct" them back:
//
//   eyebrow   the reference sets it at 22px against that 40px heading, a ratio
//             of 0.55. At WHealthOS's tighter heading weight that read as a
//             second headline rather than a label, so it is 16px here -- a
//             ratio of 0.4, which is much closer to the reference than the
//             12px it replaced without competing with the heading.
//
//   width     the reference's container is 1416px of a 1440px viewport, very
//             nearly full bleed. This page stays at 84rem because that is the
//             footer's width, and a heading that did not line up with the
//             column beneath it was the thing the shared SHELL was introduced
//             to fix.
export const EYEBROW =
  "text-base font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEADING =
  "text-balance text-3xl font-semibold tracking-tight md:text-[2.5rem] md:leading-[1.15]";
export const LEAD = "text-lg leading-[1.8] text-muted-foreground";
// The reference's dominant card: 20px corners, a hairline border and no
// shadow. Counted 15 of them against 6 of the next most common geometry.
export const CARD = "rounded-[20px] border bg-card";
export const BODY = "text-base leading-[1.8] text-muted-foreground";

// Sections are spaced with a top margin, never with padding on both sides of
// the boundary. The old page gave every section py-20, so each gap between two
// of them was 160px rather than 80px and no single value said what the rhythm
// was. Margins collapse into one gap; paddings add up.
const Section = ({
  id,
  eyebrow,
  title,
  lead,
  headingHidden,
  children,
  className,
  innerClassName,
}) => (
  <section aria-labelledby={id} className={cn("reveal mt-20 md:mt-28", className)}>
    <div className={cn(SHELL, innerClassName)}>
      {eyebrow && !headingHidden && <p className={EYEBROW}>{eyebrow}</p>}

      <h2
        id={id}
        className={cn(
          // scroll-mt clears the fixed header when the heading is the target
          // of a #fragment -- the header nav links to /#features.
          "max-w-3xl scroll-mt-28",
          HEADING,
          eyebrow && "mt-3",
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
