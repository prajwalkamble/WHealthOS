import { cn } from "@/lib/utils";

// The landing page's layout rhythm, in one place.
//
// SHELL is the page's content width, and it is deliberately the footer's own
// width rather than Tailwind's `container`. `container` resolves to the current
// breakpoint -- 1536px from 2xl up -- while the footer's shell is 84rem. The
// two disagreed, so on a wide screen a heading on this page sat 96px outside
// the footer column directly beneath it. One number now, read by both.
export const SHELL = "mx-auto w-full max-w-[84rem] px-5 sm:px-8";

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
      {eyebrow && !headingHidden && (
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow}
        </p>
      )}

      <h2
        id={id}
        className={cn(
          // scroll-mt clears the fixed header when the heading is the target
          // of a #fragment -- the header nav links to /#features.
          "max-w-3xl scroll-mt-28 text-balance text-2xl font-bold tracking-tight md:text-4xl",
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
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
          {lead}
        </p>
      )}

      {children}
    </div>
  </section>
);

export default Section;
