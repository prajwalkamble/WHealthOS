"use client";

import { useEffect, useRef, useState } from "react";

// A statistic that counts up to its real value when it scrolls into view.
//
// THE RULE THIS COMPONENT EXISTS TO KEEP: the number it finishes on is the
// string it was handed, character for character. It never computes a figure of
// its own and it never rounds one. The last frame of the animation does not
// render a formatted counter at all -- it renders `value` itself -- so there
// is no path where the displayed figure and the source figure can disagree.
// An animation on a financial statistic is a presentation effect; it is not
// allowed to become a second source of truth.
//
// It works by splitting the already-formatted string, which lib/stat-tiles.js
// produced, into a prefix, a number and a suffix:
//
//     "₹1.1L"   ->  "₹"  "1.1"  "L"
//     "100%"    ->  ""   "100"  "%"
//     "17"      ->  ""   "17"   ""
//
// Only the middle is animated, at the same number of decimal places, so a
// currency symbol, a compact-notation suffix and a percent sign stay put
// instead of appearing at the end. Anything the pattern does not match -- an
// em dash, a figure with two numbers in it -- is rendered as-is and never
// animated, which is the honest failure mode.
const PATTERN = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/;

const DURATION_MS = 1200;

// Starts quickly and settles, rather than easing in from nothing: the figure
// should feel like it is arriving at a value, not starting from one.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const StatCounter = ({ value, className }) => {
  const ref = useRef(null);
  // Rendered on the server and in the first client paint as the finished
  // value. Nothing is ever hidden or shown as zero: a reader who arrives with
  // JavaScript disabled, with the tab backgrounded, or with motion turned off
  // sees the real figure immediately, and the animation is the only thing
  // they miss.
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const match = PATTERN.exec(value);
    if (!match) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const [, prefix, digits, suffix] = match;
    const target = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(target)) return;

    const decimals = (digits.split(".")[1] ?? "").length;
    // The separators the source string used, kept: "1,07,42,019" is grouped
    // the Indian way and a counter that regrouped it in thousands would be
    // showing a different number on the way up.
    const grouped = digits.includes(",");
    const format = (n) =>
      prefix +
      n.toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: grouped,
      }) +
      suffix;

    let frame = 0;
    let start = 0;
    let done = false;

    const tick = (now) => {
      if (!start) start = now;
      const t = Math.min((now - start) / DURATION_MS, 1);
      if (t >= 1) {
        done = true;
        // The source string, not a formatted counter. See the note above.
        setDisplay(value);
        return;
      }
      setDisplay(format(target * easeOutCubic(t)));
      frame = requestAnimationFrame(tick);
    };

    // Once, when the figure first becomes visible, and then never again: the
    // observer disconnects on its first intersection, so scrolling back up
    // does not replay it and a page that rests near the boundary cannot
    // retrigger it.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || done || frame) return;
        observer.disconnect();
        setDisplay(format(0));
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    // tabular-nums comes from the caller; without it the figure's width
    // changes on every frame and the row jitters.
    <span ref={ref} className={className}>
      {display}
    </span>
  );
};

export default StatCounter;
