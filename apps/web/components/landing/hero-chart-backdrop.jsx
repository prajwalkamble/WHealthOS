// The hero's background: one financial chart, behind the copy.
//
// A server component with no JavaScript of its own, and no motion: it draws
// once and stays put. There is no state, no effect and nothing to hydrate, so
// there is also nothing here that can mismatch -- which matters because the
// hero is the LCP element and nothing in it should wait on a client bundle.
// It does fade in, once, a beat after the page paints, so the headline and the
// dashboard are what arrive first; that is in globals.css.
//
// Geometry measured off the supplied reference rather than guessed at. The
// reference's dark panel is 836px wide with its value axis running from ₹1.5L
// at y=177 to ₹0 at y=494; every vertex below is that path resampled into the
// reference's own 1440x520 frame, which is why the numbers look arbitrary.
// They are not -- they are the reference.
//
// It covers the hero's copy at every screen size, which is what the framings
// in the markup are for, and it runs the width of the page, less the page's
// own left and right gutter.
// That gutter is the whole of the inset: it keeps the line from dying into
// the window's edge, and it is deliberately not the content shell's width,
// because a background that stops short on both sides stops being a
// background and starts being a picture of one.
const HEIGHT = 780;

// The frame is taller than the reference's, and the measured geometry is
// stretched onto it. A 1440x520 drawing is 0.36 of its own width tall, and at
// anything under about 1280px that left the chart as a band across the top of
// a hero whose copy ran three times further down the page: the background
// stopped before the paragraph did. At 1440x780 it is 0.54 of its width, which
// covers the copy at every size a laptop or tablet actually is.
//
// Only y is touched. x, every stroke width and every type size are left alone,
// so nothing is distorted -- no squashed glyphs, no oval dot. The chart is
// simply drawn with more vertical range, the way the same series would be if
// the panel holding it were taller.
const STRETCH = HEIGHT / 520;
const vy = (v) => Number((v * STRETCH).toFixed(1));

const VERTICES = [
  [0, 447],
  [69, 435],
  [138, 451],
  [207, 403],
  [276, 378],
  [310, 334],
  [396, 387],
  [474, 408],
  [551, 393],
  [637, 402],
  [723, 384],
  [810, 390],
  [896, 372],
  [982, 363],
  [1068, 327],
  [1102, 290],
  [1171, 260],
  [1240, 215],
  [1272, 192],
  [1309, 185],
  [1378, 146],
  [1412, 167],
  [1440, 150],
];

const PATH = VERTICES.map(
  ([x, y], i) => `${i ? "L" : "M"}${x} ${vy(y)}`
).join(" ");

// The area under the line, closed to the bottom of the viewBox rather than to
// the ₹0 gridline: the reference's wash runs past the baseline and fades out
// behind the dashboard, it does not stop at the axis.
const AREA = `${PATH} L1440 ${HEIGHT} L0 ${HEIGHT} Z`;

// The value axis. 1.5L at the top through 0 at the bottom, evenly spaced --
// the reference's own ladder, and the range the demo's own figures sit inside.
const AXIS = [
  [60, "₹1.5L"],
  [136, "₹1.2L"],
  [212, "₹90K"],
  [288, "₹60K"],
  [364, "₹30K"],
  [440, "₹0"],
].map(([y, label]) => [vy(y), label]);

// The vertical guides, at the reference's spacing, and how far they run.
const GUIDES = [264, 534, 800, 1068, 1335];
const GUIDE_TOP = vy(48);
const GUIDE_BOTTOM = vy(460);

// The highlighted point, which is a vertex of PATH and not a position of its
// own -- if the path changes, this has to move with it.
const POINT = { x: 1272, y: vy(192) };

// The callout keeps its measured size: it is a card, not part of the plot, so
// it is positioned by the stretch but not stretched by it.
const CALLOUT = { x: 1120, y: vy(30), w: 296, h: 62 };

const HeroChartBackdrop = () => {
  return (
    // aria-hidden and pointer-events-none: decoration. It carries no
    // information the copy does not, and it must never take a click meant for
    // the headline or either button behind it.
    //
    // -z-10 inside the hero's `isolate` puts it behind the content without
    // escaping into the rest of the page's stacking order. The dashboard demo
    // below is opaque, so it occludes the tail of the chart exactly as the
    // reference does.
    <div
      aria-hidden="true"
      data-hero-chart
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 select-none px-5 sm:px-8"
    >
      {/* Three framings of one drawing, and only the box changes -- there is
          no second geometry and no second component.

          From `md` up the box is the viewBox's own ratio, so the chart is
          scaled uniformly and nothing is cropped. Below that a phone's hero is
          taller than it is wide and no landscape chart can fill it at a
          uniform scale, so the box is given the shape of the space and `slice`
          scales to cover it: what you lose is width, at the left, which is
          where the chart is flattest and where the axis labels already stop
          being drawn. The end of the line and its marked point are what stay
          in frame. */}
      <svg
        viewBox={`0 0 1440 ${HEIGHT}`}
        preserveAspectRatio="xMaxYMid slice"
        className="aspect-[1/2] w-full sm:aspect-[5/4] md:aspect-[3/2] lg:aspect-[1440/780]"
        fill="none"
        focusable="false"
      >
        <defs>
          {/* No hue anywhere on the drawing: every stop takes the theme's own
              ink (see globals.css), so this is one colour at varying strength
              rather than a ramp between two. It used to run blue-600 to
              purple-600 -- the brand's ramp -- and behind a headline that is
              itself blue-to-purple that was the page's second coloured thing
              competing with its first.

              The ramp along the line survives as weight: faint where the line
              starts, full where it ends, which still carries the eye to the
              right without colouring anything. */}
          <linearGradient id="hero-chart-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop className="hero-chart-ink-stop" offset="0%" stopOpacity="0.5" />
            <stop
              className="hero-chart-ink-stop"
              offset="55%"
              stopOpacity="0.82"
            />
            <stop className="hero-chart-ink-stop" offset="100%" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="hero-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop className="hero-chart-ink-stop" offset="0%" stopOpacity="0.9" />
            <stop
              className="hero-chart-ink-stop"
              offset="70%"
              stopOpacity="0.08"
            />
            <stop className="hero-chart-ink-stop" offset="100%" stopOpacity="0" />
          </linearGradient>

          {/* The grid fades out across the middle of the page, and it is
              measured rather than tasteful.

              The lead paragraph is 18px of muted-foreground, which on white
              is 4.60:1 -- a pass, with a tenth of a point to spare. A grid
              line at 8% black crossing it takes the background to 244 and the
              text to 4.31:1, which fails AA. It was the ₹60K line, straight
              through the paragraph's first line, and it was the only thing on
              this drawing that failed.

              So the rule stays full strength out at the axis where there is
              nothing behind it, and drops to a sixth of that through the
              column the copy sits in. userSpaceOnUse because the ticks are
              16px long and an objectBoundingBox gradient on a zero-height box
              is not well defined. */}
          <linearGradient
            id="hero-chart-grid-fade"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="1440"
            y2="0"
          >
            <stop className="hero-chart-grid-stop" offset="0%" stopOpacity="1" />
            <stop className="hero-chart-grid-stop" offset="16%" stopOpacity="1" />
            <stop
              className="hero-chart-grid-stop"
              offset="34%"
              stopOpacity="0.16"
            />
            <stop
              className="hero-chart-grid-stop"
              offset="66%"
              stopOpacity="0.16"
            />
            <stop className="hero-chart-grid-stop" offset="84%" stopOpacity="1" />
            <stop className="hero-chart-grid-stop" offset="100%" stopOpacity="1" />
          </linearGradient>
          <filter
            id="hero-chart-blur"
            x="-4%"
            y="-25%"
            width="108%"
            height="150%"
          >
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* Horizontal grid. Hairlines, and deliberately the faintest thing
            here: they give the line something to be read against and should
            not themselves be noticed. */}
        <g className="hero-chart-grid">
          {AXIS.map(([y]) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="1440"
              y2={y}
              stroke="url(#hero-chart-grid-fade)"
            />
          ))}
        </g>

        {/* Vertical guides, dashed. */}
        <g className="hero-chart-guide">
          {GUIDES.map((x) => (
            <line
              key={x}
              x1={x}
              y1={GUIDE_TOP}
              x2={x}
              y2={GUIDE_BOTTOM}
              stroke="url(#hero-chart-grid-fade)"
            />
          ))}
        </g>

        {/* The axis: a tick and its label. Hidden below lg -- see the note on
            the framings above. */}
        <g className="hidden lg:inline">
          <g className="hero-chart-grid">
            {AXIS.map(([y]) => (
              <line
                key={y}
                x1="28"
                y1={y}
                x2="44"
                y2={y}
                stroke="url(#hero-chart-grid-fade)"
              />
            ))}
          </g>
          <g className="hero-chart-axis-label">
            {AXIS.map(([y, label]) => (
              <text key={y} x="58" y={y} dominantBaseline="middle">
                {label}
              </text>
            ))}
          </g>
        </g>

        <path className="hero-chart-area" d={AREA} fill="url(#hero-chart-fill)" />

        {/* The bloom the reference carries along its line: a second copy of
            the same path under a blur. */}
        <path
          className="hero-chart-glow"
          d={PATH}
          stroke="url(#hero-chart-stroke)"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#hero-chart-blur)"
        />

        <path
          className="hero-chart-line"
          d={PATH}
          stroke="url(#hero-chart-stroke)"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* The highlighted point, which is one dot. It used to be a core
            inside a ring inside a halo, the way the reference draws it; at
            this weight that read as three rings of noise around a mark, so
            the two outer ones are gone. */}
        <circle className="hero-chart-dot" cx={POINT.x} cy={POINT.y} r="4" />

        {/* The reading, and the dashed drop to the point it belongs to. It
            stops just short of the dot rather than touching it -- the gap
            used to clear the halo, and now it is the only thing keeping the
            line from looking like it is skewering the mark. */}
        <g className="hidden lg:inline">
          <line
            className="hero-chart-guide"
            x1={POINT.x}
            y1={CALLOUT.y + CALLOUT.h}
            x2={POINT.x}
            y2={POINT.y - 9}
          />
          <rect
            className="hero-chart-callout"
            x={CALLOUT.x}
            y={CALLOUT.y}
            width={CALLOUT.w}
            height={CALLOUT.h}
            rx="14"
          />
          {/* The reference's card, reproduced: a date, an amount and a
              change. Asked for explicitly, after the alternative was put and
              declined.

              Worth being clear about what these three values are, so nobody
              later reads them as a reading of something. They are fixed
              decoration. The amount is the figure the reference shows, which
              was the demo's own monthly income on the day that mockup was
              made -- but lib/demo/data.js drifts each month and drops rows
              dated in the future, so the dashboard a few hundred pixels below
              this will not always agree with it. The axis up the left is
              decoration on the same terms. None of it is anyone's money. */}
          <text className="hero-chart-callout-label" x="1146" y={CALLOUT.y + 22}>
            28 Feb 2025
          </text>
          <text className="hero-chart-callout-value" x="1146" y={CALLOUT.y + 48}>
            ₹1,08,215.00
          </text>
          <text className="hero-chart-callout-change" x="1288" y={CALLOUT.y + 48}>
            +₹5,420 (+5.3%)
          </text>
        </g>
      </svg>
    </div>
  );
};

export default HeroChartBackdrop;
