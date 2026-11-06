import { ICON, ICON_MARGIN, MARK_VIEWBOX, fit } from "@/lib/brand/identity.mjs";

// The WHOS mark: the WHealthOS W, nothing else.
//
// This used to be a separate drawing -- a four-stroke zigzag with mitered,
// flat-clipped joins -- designed when the assistant was the only thing in the
// product with a symbol. It was a second letterform doing the first one's job,
// and the two were free to drift apart. The assistant is a feature of the
// brand, not a brand of its own, so it now renders the identity's own mark
// from lib/brand/identity.mjs. Change the logo and this changes with it.
//
// The heavier `ICON` cut rather than the lockup's, because the assistant draws
// it at 20px and 32px, where the lockup weight goes spindly and the arrowhead
// closes up.
//
// Why inline rather than <img src="/brand/whos-mark-mono.svg">
// ------------------------------------------------------------
// It has to take its colour from its surroundings. The app ships eighteen
// palettes (lib/preferences.js) and a dark mode, so a mark with a fixed hue
// would clash with any account that is not on the default. Inline SVG can
// inherit currentColor; an <img> cannot. It also costs no request and cannot
// shift the layout while it loads.
//
// public/brand/whos-mark.svg and whos-mark-mono.svg hold the same drawing as
// files, for anywhere that needs one; both are generated from the identity by
// scripts/build-brand-assets.mjs, so they cannot disagree with this.

const PLACED = fit(ICON.ink, MARK_VIEWBOX, ICON_MARGIN);
const VIEW_BOX = `${MARK_VIEWBOX.x} ${MARK_VIEWBOX.y} ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`;

// `label` makes it an image to assistive technology; without one it is
// decoration and is hidden, which is right wherever a visible text label
// already names the thing. Everything else is forwarded, the way an icon
// component should: without it a caller sizing the mark with an inline
// style was silently ignored.
const WhosMark = ({ className, label, ...props }) => (
  <svg
    viewBox={VIEW_BOX}
    className={className}
    {...props}
    // Never a width/height attribute: the size comes from the class, and an
    // intrinsic size here would fight it.
    role={label ? "img" : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : "true"}
    focusable="false"
  >
    <g transform={`translate(${PLACED.x} ${PLACED.y}) scale(${PLACED.scale})`}>
      {/* The letter, then the arrowhead that ends its final stroke. Both in
          currentColor, so the mark is one flat silhouette that reads at 20px
          and takes whichever palette the account is on. */}
      <path
        d={ICON.path}
        fill="none"
        stroke="currentColor"
        strokeWidth={ICON.stroke}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d={ICON.arrowhead} fill="currentColor" />
    </g>
  </svg>
);

export default WhosMark;
