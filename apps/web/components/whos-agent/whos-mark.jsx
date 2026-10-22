// The WHOS mark.
//
// A bespoke W, not a font's. The geometry is a four-stroke zigzag given a
// constant width and mitered joins, with every join and terminal cut flat:
// the two outer terminals on a shared cap line, the apex and both valleys
// clipped square. A true miter on a W's valleys runs six to nine units past
// the vertex, which is why an unclipped version did not fit its own viewBox;
// clipping them is what gives this mark its machined character rather than a
// typeset one.
//
// Why inline rather than <img src="/brand/whos-mark-mono.svg">
// ------------------------------------------------------------
// It has to take its colour from its surroundings. The app ships eighteen
// palettes (lib/preferences.js) and a dark mode, so a mark with a fixed hue
// would clash with any account that is not on the default. Inline SVG can
// inherit currentColor; an <img> cannot. It also costs no request and cannot
// shift the layout while it loads.
//
// public/brand/whos-mark.svg holds the same path with the brand ramp, for the
// places that need a fixed-colour file. tests/whos-agent.test.js reconciles
// the two so the drawing cannot drift between them.
export const WHOS_MARK_PATH =
  "M3.000 6.440L9.960 25.520L11.860 25.560L16.000 15.560L20.140 25.560L22.040 25.520L29.000 6.440L24.860 6.440L20.910 17.270L16.900 7.570L15.100 7.570L11.090 17.270L7.140 6.440Z";

// `label` makes it an image to assistive technology; without one it is
// decoration and is hidden, which is right wherever a visible text label
// already names the thing. Everything else is forwarded, the way an icon
// component should: without it a caller sizing the mark with an inline
// style was silently ignored.
const WhosMark = ({ className, label, ...props }) => (
  <svg
    viewBox="0 0 32 32"
    className={className}
    {...props}
    // Never a width/height attribute: the size comes from the class, and an
    // intrinsic size here would fight it.
    role={label ? "img" : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : "true"}
    focusable="false"
  >
    <path fill="currentColor" d={WHOS_MARK_PATH} />
  </svg>
);

export default WhosMark;
