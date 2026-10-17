"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// The marketing header's surface.
//
// Two shapes, one bar.
//
// At the top of a page it is a floating capsule: fully rounded, inset from
// every edge, glass, with a hairline border. The page reads as continuing
// underneath it rather than starting below a fixture.
//
// Once the page scrolls it becomes an ordinary header -- pinned flush to the
// top, full width, square, with a rule along its bottom edge. That is what a
// header is for while someone is reading: a fixed edge to the viewport, not an
// object floating over the text. The capsule is the resting state; the bar is
// the working one.
//
// What changes between them is radius, width, padding, offset and surface.
// None of it touches the document, because the whole thing is `fixed` -- the
// transition is the bar's own business and nothing on the page moves.
//
// The dropdown and the mobile sheet keep 16px corners in both states: those
// are panels, and a capsule-shaped panel is a lozenge.
//
// Both states are glass. At the top there is nothing behind the capsule but
// the page background, so the blur has little to work on and the fill is kept
// light -- the border is what defines the shape there. Once content passes
// underneath, the fill goes up so the navigation stays legible over whatever
// is behind it. Both use the background token at reduced alpha rather than a
// hard-coded white, so the glass follows the theme and never becomes a bright
// slab in the dark one.
//
// Width is capped at rest. An uncapped capsule is still correct on a laptop
// but on a 34-inch monitor it stretches the logo and the actions to opposite
// ends of the desk with a quarter of a metre of nothing between them. 120rem
// keeps it near the edges at every size anyone actually works at -- 24px of
// gutter at 1440, 32px at 1920 -- and only starts centring above that. The
// scrolled bar has no cap, because a full-width header that stops short of
// the edges is neither one thing nor the other.
//
// The shell owns one boolean so header.jsx can stay a server component: it
// reads the Clerk session with auth(), which has to run on the server, and
// that is worth more than keeping this in the same file.
//
// A scroll listener rather than an IntersectionObserver: the panel is fixed,
// so it has no sentinel of its own, and an element planted at the top of the
// document would have to be owned by every page that uses this header rather
// than by the header itself. The listener is passive and coalesced into one
// animation frame, so a fast scroll does at most one read per frame and never
// writes state it has already written.
const THRESHOLD_ON = 12;
// Hysteresis. With a single threshold, a page resting exactly on it flips the
// surface on and off as the pointer nudges it.
const THRESHOLD_OFF = 4;

const HeaderShell = ({ children, className }) => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;

    const read = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled((was) => (was ? y > THRESHOLD_OFF : y > THRESHOLD_ON));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    // Once on mount: a reload partway down a page, or a browser restoring the
    // scroll position, must not leave the panel in its top-of-page state.
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed top-0 z-50 w-full",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        scrolled ? "translate-y-0" : "translate-y-[var(--header-rest-offset)]"
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          "transition-[max-width,padding] duration-300 ease-out motion-reduce:transition-none",
          scrolled
            ? "max-w-none px-0"
            : "max-w-[120rem] px-3 sm:px-4 lg:px-6 2xl:px-8"
        )}
      >
        <div
          // data-header and data-scrolled rather than classes: the state is
          // readable from the inspector and from a test, and anything that
          // wants to style against it can without depending on a class name.
          data-header=""
          data-scrolled={scrolled ? "" : undefined}
          className={cn(
            // relative: the mobile menu hangs off the bottom of this box.
            "relative flex h-[var(--header-h)] items-center",
            // 12px of blur: enough to separate the bar from what passes under
            // it, and a cheap layer to composite on a wide screen. The
            // saturation lift keeps colour from going grey underneath it.
            "backdrop-blur-md backdrop-saturate-150",
            "transition-[background-color,border-color,border-radius,box-shadow,padding] duration-300 ease-out motion-reduce:transition-none",
            scrolled
              ? // An ordinary header: square, full width, a rule along the
                // bottom and no shadow competing with it. The padding grows
                // instead of the gutter, so the logo sits in from the edge
                // the way it does on any site rather than against it.
                "rounded-none border-0 border-b border-border/60 bg-background/85 px-5 sm:px-6 lg:px-8 2xl:px-12"
              : "rounded-full border border-border/45 bg-background/55 px-5 sm:px-6 lg:px-7",
            className
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default HeaderShell;
