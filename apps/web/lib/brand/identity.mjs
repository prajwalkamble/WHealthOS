// The WHealthOS identity, as data.
//
// This is the one place the logo is defined. Everything that draws the brand
// derives from this file:
//
//   components/brand/logo.jsx             inline SVG, every screen
//   components/whos-agent/whos-mark.jsx   the assistant avatar
//   lib/export/pdf.js                     vector lockup drawn with pdfkit
//   lib/export/xlsx.js                    brand colours on the workbook
//   emails/_components/brand-header.jsx   the hosted raster used in email
//   scripts/build-brand-assets.mjs        every generated file
//
// Change a value here and every surface that renders at runtime follows on the
// next request. The generated files cannot -- a .png is a .png -- so the script
// above rewrites them and records a fingerprint of this file's values in
// public/brand/generated.json. tests/brand-logo.test.js recomputes that
// fingerprint and fails when the two disagree, which is what stops a logo
// change from silently leaving a stale favicon behind.
//
// .mjs rather than .js on purpose: apps/web has no "type": "module", so the
// asset script (plain Node, outside the bundler) would otherwise read this as
// CommonJS and fail on the export syntax.

// What the brand is called, and how the lockup splits it.
//
// The W is drawn, not typed -- it is the symbol -- so the type begins at the
// second letter. "Health" is set in ink and "OS" in the ramp, so the wordmark
// resolves from a solid into the same colour the mark is made of.
export const BRAND_NAME = "WHealthOS";
export const WORDMARK_TEXT = "HealthOS";
export const WORDMARK_INK_TEXT = "Health";
export const WORDMARK_RAMP_TEXT = "OS";

// The brand ramp: blue -> royal -> indigo -> violet -> purple, left to right.
//
// Five stops rather than two. A two-stop blue-to-purple crosses the blue/violet
// boundary too fast and leaves a muddy band in the middle of a wide wordmark;
// the intermediate stops hold the sweep even across both the mark and "OS".
export const RAMP = [
  { offset: 0, color: "#1266ED" },
  { offset: 0.25, color: "#2453E8" },
  { offset: 0.5, color: "#493BEA" },
  { offset: 0.78, color: "#7228EA" },
  { offset: 1, color: "#851FEA" },
];

export const RAMP_START = RAMP[0].color;
export const RAMP_END = RAMP[RAMP.length - 1].color;

// The same ramp, lifted for dark grounds.
//
// The ramp above is tuned for white. On the dark page every stop falls between
// 2.8:1 and 3.8:1 against the background -- the violet stop is 2.76:1, under
// even the 3:1 floor for non-text -- so the mark reads as a dim smudge rather
// than as the brand. These are the same five hues carried up in lightness and
// eased off in saturation, which puts every stop between 6.1:1 and 6.9:1 on
// the dark ground while staying recognisably the same ramp.
//
// Screen surfaces switch between the two with the --brand-ramp-* custom
// properties in app/globals.css, so one element serves both themes. Generated
// files have no theme to follow, so each is drawn with whichever ramp suits
// the ground it is baked onto: RAMP on transparent and white, RAMP_DARK on
// ICON_BACKDROP.
export const RAMP_DARK = [
  { offset: 0, color: "#5B9DFF" },
  { offset: 0.25, color: "#6E8BFF" },
  { offset: 0.5, color: "#8F82FF" },
  { offset: 0.78, color: "#B07CFF" },
  { offset: 1, color: "#BE78FF" },
];

// The custom property each stop reads on screen, so the two ramps above are
// declared once here and once in the stylesheet rather than in every renderer.
export const rampVar = (index) => `--brand-ramp-${index}`;

// Ink: the wordmark's deep navy, and its two quieter steps.
//
// On screen "Health" is painted from --brand-ink, which the dark theme
// redefines, so one element serves both themes. A PDF and an email have no
// theme to inherit from, so they take this literal.
export const INK = "#101832";
export const INK_MUTED = "#5b6071";
export const RULE = "#d9dce5";

// ---------------------------------------------------------------- the letter

// The W, as five points.
//
// Four strokes -- down, up to the centre peak, down, and up past where it
// started -- with the fourth running well beyond the cap line and ending in an
// arrowhead. The arrow is not an element placed on the letter: it is the
// termination of the W's own final stroke, and `geometry()` below derives it
// from that stroke's direction so the two cannot drift apart.
//
// A stroked polyline rather than a filled outline. Filled quads were tried
// first and break up at the joints: the vertices notch visibly at 32px and the
// letter turns to mush at 16px. A stroke with round joins holds its weight all
// the way down to a favicon.
export const MARK_VERTICES = [
  [2.6, 8.6],
  [8.1, 26.3],
  [13.6, 14.4],
  [19.1, 26.3],
  [29.6, 4.4],
];
export const MARK_STROKE = 4.8;

// The arrowhead, in the same units: how far back from the point its base sits,
// and how far the barbs reach either side of the shaft.
//
// The shaft stops at that base rather than at the point, so its round cap is
// swallowed by the triangle instead of poking out past the tip. The base is
// wider than the stroke, which is what reads as an arrowhead rather than a
// thickening.
export const MARK_ARROW = { length: 7.2, halfWidth: 4.4 };

/**
 * The letter and its arrowhead, derived from a set of vertices.
 *
 * Returns the stroked polyline, the arrowhead triangle, and the bounds of the
 * ink the two make together -- which is what every renderer uses to place the
 * mark and to span its gradient, so nothing has to hardcode a bounding box
 * that a moved vertex would invalidate.
 *
 * @param {{ vertices: number[][], stroke: number, arrow: { length: number, halfWidth: number } }} spec
 */
export function geometry({ vertices, stroke, arrow }) {
  const apex = vertices[vertices.length - 1];
  const prev = vertices[vertices.length - 2];
  const dx = apex[0] - prev[0];
  const dy = apex[1] - prev[1];
  const len = Math.hypot(dx, dy);

  // Along the final stroke, toward the point; and square to it.
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const base = [apex[0] - ux * arrow.length, apex[1] - uy * arrow.length];
  const shaft = [...vertices.slice(0, -1), base];
  const barbs = [
    [base[0] + px * arrow.halfWidth, base[1] + py * arrow.halfWidth],
    [base[0] - px * arrow.halfWidth, base[1] - py * arrow.halfWidth],
  ];

  const round = (v) => Number(v.toFixed(2));
  const pt = ([x, y]) => `${round(x)} ${round(y)}`;

  // A round cap and a round join are both a disc of radius stroke/2 about the
  // vertex, so the stroked ink is the vertices grown by that radius. The
  // arrowhead's own points are already ink.
  const r = stroke / 2;
  const xs = [...shaft.map(([x]) => x - r), ...shaft.map(([x]) => x + r), ...barbs.map(([x]) => x), apex[0]];
  const ys = [...shaft.map(([, y]) => y - r), ...shaft.map(([, y]) => y + r), ...barbs.map(([, y]) => y), apex[1]];

  return {
    path: `M${shaft.map(pt).join(" L")}`,
    arrowhead: `M${pt(apex)} L${pt(barbs[0])} L${pt(barbs[1])} Z`,
    stroke,
    // Degrees above horizontal that the arrow points. Reported so a test can
    // assert the thing the brief actually cares about -- up and to the right --
    // rather than asserting a path string nobody can read.
    angle: round((Math.atan2(-dy, dx) * 180) / Math.PI),
    ink: {
      minX: round(Math.min(...xs)),
      minY: round(Math.min(...ys)),
      maxX: round(Math.max(...xs)),
      maxY: round(Math.max(...ys)),
    },
  };
}

export const MARK = geometry({
  vertices: MARK_VERTICES,
  stroke: MARK_STROKE,
  arrow: MARK_ARROW,
});

// The favicon's own copy of the W.
//
// The same vertices -- the geometry does not change -- drawn with a heavier
// stroke and a correspondingly larger head, because a stroke that reads
// correctly at 64px goes spindly at 16px and an arrowhead scaled mechanically
// from the lockup disappears. This is the one optical adjustment the brief
// allows, and it lives here rather than hand-maintained inside app/icon.svg.
export const ICON_STROKE = 6.4;
export const ICON_ARROW = { length: 9.0, halfWidth: 5.8 };
export const ICON = geometry({
  vertices: MARK_VERTICES,
  stroke: ICON_STROKE,
  arrow: ICON_ARROW,
});

// The square the standalone mark and every icon are drawn in, and the margin
// held inside it. The ink is fitted to that box by `fit()` rather than placed
// by hand, so it stays centred when a vertex moves.
export const MARK_VIEWBOX = { x: 0, y: 0, width: 32, height: 32 };
export const MARK_MARGIN = 2.4;
export const ICON_MARGIN = 1.4;

/**
 * Centres `ink` inside `box`, preserving aspect, leaving `margin` all round.
 * @returns {{ scale: number, x: number, y: number }} a translate-then-scale.
 */
export function fit(ink, box, margin) {
  const w = ink.maxX - ink.minX;
  const h = ink.maxY - ink.minY;
  const scale = Math.min((box.width - margin * 2) / w, (box.height - margin * 2) / h);
  const round = (v) => Number(v.toFixed(3));
  return {
    scale: round(scale),
    x: round(box.x + (box.width - w * scale) / 2 - ink.minX * scale),
    y: round(box.y + (box.height - h * scale) / 2 - ink.minY * scale),
  };
}

// The ramp across a mark, left to right, in the mark's own units.
export const markRamp = (ink) => ({ x1: ink.minX, y1: 0, x2: ink.maxX, y2: 0 });

// The backdrop for icons that cannot be transparent. iOS composites an
// apple-touch-icon onto white, which would leave the blue end of the ramp
// washed out, so it gets the application's own dark ground instead.
export const ICON_BACKDROP = "#0a0b1e";

// --------------------------------------------------------------- the lockup

// Geist, pinned, not `var(--font-display)`.
//
// The appearance settings let somebody set the display face to a serif and the
// body face to a monospace, and a brand mark that follows that is not a brand
// mark. Geist is the default body font, so on a normal page this costs no
// extra request -- the file is already loaded for the body text.
export const WORDMARK_FAMILY = "Geist";
export const WORDMARK_FONT_STACK =
  "var(--font-geist), ui-sans-serif, system-ui, sans-serif";

// What "HealthOS" actually measures in Geist 600 at WORD.size with WORD.tracking,
// read out of a browser rather than guessed: getComputedTextLength for the
// whole string, getStartPositionOfChar for where "OS" begins, and a canvas
// TextMetrics ascent for the cap height.
//
// These are what let the lockup be composed arithmetically -- the mark sized
// off the cap height, the wordmark's gradient spanning exactly "OS" -- instead
// of by nudging numbers until it looked right. Re-measure with
// scripts/measure-wordmark.mjs if the face, size or tracking changes.
export const WORD = {
  size: 22,
  weight: 600,
  tracking: -0.6,
  advance: 96.19,
  osStart: 65.89,
  capHeight: 16,
};

// How much taller than the wordmark's cap height the W's body is drawn. A
// letterform this open reads smaller than a line of type at the same measured
// height, so it is set fractionally larger to look the same size.
const MARK_OPTICAL = 1.06;

// The lockup, composed.
//
// Everything here is derived: the mark is scaled so its body -- the W without
// the arrow's overshoot -- matches the wordmark's cap height, sat on the same
// baseline, and the arrow is then free to rise above the cap line, which is
// the whole point of the letterform. The gap is the one judgement call, and it
// is tight on purpose: W and HealthOS are one word, not an icon beside a label.
export const LOCKUP = (() => {
  const baseline = 24;
  const gap = 3.2;

  // The body is the ink without the arrow's reach: the W's own cap line is its
  // first vertex, grown by the stroke's round cap.
  const bodyTop = MARK_VERTICES[0][1] - MARK_STROKE / 2;
  const scale = Number(((WORD.capHeight * MARK_OPTICAL) / (MARK.ink.maxY - bodyTop)).toFixed(4));

  const round = (v) => Number(v.toFixed(2));
  const markX = round(-MARK.ink.minX * scale);
  const markY = round(baseline - MARK.ink.maxY * scale);
  const markWidth = round((MARK.ink.maxX - MARK.ink.minX) * scale);
  const wordX = round(markWidth + gap);

  // Trailing letter-spacing is in the advance but is not ink, so the box ends
  // where the S does.
  const width = round(wordX + WORD.advance + WORD.tracking);
  const top = round(MARK.ink.minY * scale + markY);

  return {
    viewBox: { x: 0, y: round(top - 1), width, height: round(baseline - top + 3) },
    mark: { x: markX, y: markY, scale },
    // Left to right across the mark, and left to right across "OS".
    ramp: { x1: 0, y1: 0, x2: markWidth, y2: 0 },
    word: { x: wordX, baseline, size: WORD.size, weight: WORD.weight, tracking: WORD.tracking },
    wordRamp: {
      x1: round(wordX + WORD.osStart),
      y1: 0,
      x2: round(wordX + WORD.advance + WORD.tracking),
      y2: 0,
    },
  };
})();

// ------------------------------------------------------------------- outputs

// The email raster, in CSS pixels.
//
// Email clients cannot render inline SVG -- Gmail strips it outright and
// Outlook's Word renderer ignores it -- so the one surface that needs a bitmap
// gets one. Generated at RASTER_SCALE and served at these dimensions, so it
// stays sharp on a retina display.
export const EMAIL_LOGO = {
  width: 150,
  height: Math.round((150 * LOCKUP.viewBox.height) / LOCKUP.viewBox.width),
  path: "brand/logo-email.png",
};

// The social card, for link previews. 1200x630 is what Open Graph, Slack,
// WhatsApp and X all read. The card is the lockup on the dark ground, so the
// wordmark is white there rather than ink.
export const OG_IMAGE = { width: 1200, height: 630, path: "brand/og.png" };

// How much larger the generated rasters are drawn than they are displayed.
export const RASTER_SCALE = 3;

// The sizes packed into app/favicon.ico.
//
// Next emits every icon file app/ contains and puts the .ico first, so this
// file is not optional: a browser that prefers ICO takes it over icon.svg,
// which is how a stale favicon survives a redesign.
export const FAVICON_SIZES = [16, 32, 48, 64];

// The apple-touch-icon's one fixed size, and the maskable PWA icons.
export const APPLE_ICON_SIZE = 180;
export const PWA_ICON_SIZES = [192, 256, 512];

// Icons drawn on a ground rather than transparently: how much of the square
// is margin, and how round its corners are.
//
// The margin is far wider than the favicon's on purpose. A maskable icon can
// be cropped by the launcher to a circle or a squircle, and only the middle
// 80% is guaranteed to survive; holding the mark inside roughly two-thirds of
// the square keeps the arrowhead well clear of any crop. The radius is the
// app's own card radius scaled to the icon, so a home screen reads as the
// same product as the interface.
export const APP_ICON_MARGIN = 5.6;
export const APP_ICON_RADIUS = 7.2;

// The assistant avatar. Same W, same square, on the ramp rather than in it --
// a filled tile with the mark knocked out in white, so it reads as a product
// surface rather than a second copy of the logo.
export const ASSISTANT_ICON_SIZE = 256;

// Everything a renderer can disagree about, in a stable order.
//
// The asset script hashes this and writes the digest beside the files it
// generated; the test recomputes it. Hashing these values rather than the text
// of this file means a reworded comment does not report the favicon as stale,
// while a moved vertex or a changed stop does.
export const canonical = () =>
  JSON.stringify([
    BRAND_NAME,
    WORDMARK_TEXT,
    WORDMARK_INK_TEXT,
    WORDMARK_RAMP_TEXT,
    RAMP,
    RAMP_DARK,
    INK,
    INK_MUTED,
    RULE,
    MARK_VERTICES,
    MARK_STROKE,
    MARK_ARROW,
    ICON_STROKE,
    ICON_ARROW,
    MARK_VIEWBOX,
    MARK_MARGIN,
    ICON_MARGIN,
    ICON_BACKDROP,
    FAVICON_SIZES,
    WORD,
    LOCKUP,
    WORDMARK_FAMILY,
    EMAIL_LOGO,
    OG_IMAGE,
    RASTER_SCALE,
    APPLE_ICON_SIZE,
    PWA_ICON_SIZES,
    APP_ICON_MARGIN,
    APP_ICON_RADIUS,
    ASSISTANT_ICON_SIZE,
  ]);
