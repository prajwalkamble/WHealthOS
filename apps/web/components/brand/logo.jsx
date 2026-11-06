import {
  BRAND_NAME,
  ICON,
  ICON_MARGIN,
  LOCKUP,
  MARK,
  MARK_MARGIN,
  MARK_VIEWBOX,
  RAMP,
  WORDMARK_FONT_STACK,
  WORDMARK_INK_TEXT,
  WORDMARK_RAMP_TEXT,
  fit,
  markRamp,
  rampVar,
} from "@/lib/brand/identity.mjs";

// The WHealthOS logo, on screen.
//
// Replaces four hardcoded copies of a PNG pair (header, footer, sidebar and
// the checkout shell), each of which swapped /logo.png for /logo-dark.png with
// `dark:hidden` / `hidden dark:block`. That worked, but it shipped two raster
// files per surface, and the sidebar only ever rendered the light one --
// near-black navy on a dark rail.
//
// Inline SVG instead, which fixes both: "Health" is painted from --brand-ink,
// which the dark theme redefines, so one element serves both themes, and the
// mark is a vector that stays crisp at any size and on any display.
//
// Every value is read from lib/brand/identity.mjs, which is also what the PDF
// exporter, the email header, the assistant avatar and the favicon generator
// read. Nothing about the logo is decided in this file -- change the identity
// and this follows.

const viewBox = ({ x, y, width, height }) => `${x} ${y} ${width} ${height}`;

// Each stop reads a custom property that the dark theme redefines, with the
// light ramp as the fallback. `stop-color` is a presentation attribute, so an
// attribute cannot hold a var() -- it has to be set through CSS, which is why
// these go in `style` rather than in `stopColor`. The fallback is what renders
// before the stylesheet applies, and in any context that strips it.
const Ramp = ({ id, x1, y1, x2, y2 }) => (
  <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
    {RAMP.map((stop, i) => (
      <stop
        key={stop.offset}
        offset={stop.offset}
        style={{ stopColor: `var(${rampVar(i)}, ${stop.color})` }}
      />
    ))}
  </linearGradient>
);

// The letter and the arrowhead that ends its final stroke. Two elements
// because one is stroked and one is filled; one gradient across both, so the
// ramp runs unbroken from the first downstroke into the point of the arrow.
const Mark = ({ rampId, geometry }) => (
  <>
    <path
      d={geometry.path}
      fill="none"
      stroke={`url(#${rampId})`}
      strokeWidth={geometry.stroke}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path d={geometry.arrowhead} fill={`url(#${rampId})`} />
  </>
);

// Where the standalone mark sits inside its square, computed once.
const MARK_FIT = fit(MARK.ink, MARK_VIEWBOX, MARK_MARGIN);
const ICON_FIT = fit(ICON.ink, MARK_VIEWBOX, ICON_MARGIN);

/**
 * @param {{
 *   variant?: "full" | "mark" | "icon",
 *   className?: string,
 *   title?: string,
 *   decorative?: boolean,
 *   id?: string,
 * }} props
 */
const Logo = ({
  variant = "full",
  className,
  title = BRAND_NAME,
  decorative = false,
  // Gradient ids have to be unique per document: two logos on one page with
  // the same id make the second one reference the first one's gradient, and
  // in some browsers the first one to be removed takes the fill with it.
  id = variant,
}) => {
  const rampId = `whealthos-ramp-${id}`;
  // A rendered accessible name is how an inline SVG gets one; a decorative
  // instance gets neither that nor a role, so a screen reader skips it
  // instead of announcing the brand twice in the same link.
  const labelling = decorative
    ? { "aria-hidden": true, focusable: "false" }
    : { role: "img", "aria-label": title };

  // The standalone W. `icon` is the optically heavier cut the favicon uses --
  // same vertices, more weight -- for anywhere it is drawn small.
  if (variant === "mark" || variant === "icon") {
    const geometry = variant === "icon" ? ICON : MARK;
    const placed = variant === "icon" ? ICON_FIT : MARK_FIT;
    return (
      <svg viewBox={viewBox(MARK_VIEWBOX)} className={className} {...labelling}>
        <defs>
          <Ramp id={rampId} {...markRamp(geometry.ink)} />
        </defs>
        <g transform={`translate(${placed.x} ${placed.y}) scale(${placed.scale})`}>
          <Mark rampId={rampId} geometry={geometry} />
        </g>
      </svg>
    );
  }

  const { mark, word } = LOCKUP;
  const wordRampId = `${rampId}-word`;
  return (
    <svg viewBox={viewBox(LOCKUP.viewBox)} className={className} {...labelling}>
      <defs>
        <Ramp id={rampId} {...LOCKUP.ramp} />
        <Ramp id={wordRampId} {...LOCKUP.wordRamp} />
      </defs>
      <g transform={`translate(${mark.x} ${mark.y}) scale(${mark.scale})`}>
        <Mark rampId={rampId} geometry={MARK} />
      </g>
      <text
        x={word.x}
        y={word.baseline}
        fontFamily={WORDMARK_FONT_STACK}
        fontSize={word.size}
        fontWeight={word.weight}
        letterSpacing={word.tracking}
      >
        {/* Deep navy in light, near-white in dark -- one token, defined in
            app/globals.css, rather than two elements toggled by `dark:`. The
            currentColor fallback keeps the wordmark visible if the stylesheet
            has not applied yet. */}
        <tspan fill="var(--brand-ink, currentColor)">{WORDMARK_INK_TEXT}</tspan>
        {/* The class is how `@media print` reaches this run. Chrome
            rasterises gradient-filled SVG text as a solid slab over the
            glyph box when the face is a web font -- which Geist is -- so
            printing any page came out with a coloured block where "OS"
            should be. app/globals.css prints it in a flat ramp colour
            instead. The W is a <path> and is not affected. */}
        <tspan className="whealthos-os" fill={`url(#${wordRampId})`}>
          {WORDMARK_RAMP_TEXT}
        </tspan>
      </text>
    </svg>
  );
};

export default Logo;
