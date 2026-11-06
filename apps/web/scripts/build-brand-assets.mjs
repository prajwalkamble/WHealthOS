// Regenerates every brand file that cannot read lib/brand/identity.mjs at
// runtime.
//
//   pnpm --filter @whealthos/web brand:assets
//
// Most surfaces follow the identity automatically: the React component, the
// assistant mark, the PDF exporter and the email header all import it and
// re-render on the next request. The rest cannot, because a favicon is a file
// and a .png is a .png. This script rewrites them from the identity and
// records a fingerprint of the identity's values in
// public/brand/generated.json; tests/brand-logo.test.js recomputes that
// fingerprint and fails when it has drifted, which is what stops a logo
// change from leaving a stale favicon behind. If that test is failing, run
// this script.
//
// Rasterising is done by the Chrome already on the machine rather than by
// adding an image library to the dependency tree: this runs by hand when the
// identity changes, not in the build, so a system binary is the cheaper
// dependency. The wordmark is set in the real Geist -- the variable font that
// ships inside Next covers the whole 100-900 axis, so weight 600 is genuine
// rather than synthesised.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  APPLE_ICON_SIZE,
  APP_ICON_MARGIN,
  APP_ICON_RADIUS,
  ASSISTANT_ICON_SIZE,
  BRAND_NAME,
  EMAIL_LOGO,
  FAVICON_SIZES,
  ICON,
  ICON_BACKDROP,
  ICON_MARGIN,
  INK,
  LOCKUP,
  MARK,
  MARK_MARGIN,
  MARK_VIEWBOX,
  OG_IMAGE,
  PWA_ICON_SIZES,
  RAMP,
  RAMP_DARK,
  RASTER_SCALE,
  WORDMARK_FAMILY,
  WORDMARK_INK_TEXT,
  WORDMARK_RAMP_TEXT,
  canonical,
  fit,
  markRamp,
} from "../lib/brand/identity.mjs";

const WEB = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(WEB, "../..");
const require_ = createRequire(import.meta.url);

const say = (...args) => console.log("[brand]", ...args);

// ---------------------------------------------------------------- SVG pieces

const box = ({ x, y, width, height }) => `${x} ${y} ${width} ${height}`;

// An XML comment may not contain "--" anywhere inside it -- not even in prose.
// The previous generator wrote exactly that into app/icon.svg, which made the
// file unparseable: every browser rejected the icon outright, and nothing
// caught it because Next serves favicon.ico first and almost nothing ever
// asked for the SVG. So the dashes are translated rather than trusted.
const comment = (text) => `<!-- ${text.replace(/-{2,}/g, "\u2014")} -->`;

const gradient = (id, { x1, y1, x2, y2 }, stops) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">` +
  stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("") +
  `</linearGradient>`;

// The letter and the arrowhead that ends its final stroke, in one paint.
const drawMark = (geometry, paint) =>
  `<path d="${geometry.path}" fill="none" stroke="${paint}" stroke-width="${geometry.stroke}" stroke-linejoin="round" stroke-linecap="round"/>` +
  `<path d="${geometry.arrowhead}" fill="${paint}"/>`;

/**
 * The standalone W inside a square.
 *
 * `backdrop` paints a ground behind it (and rounds the corners when `radius`
 * is given); without one the square is transparent. `stops` picks which ramp
 * it is drawn in, or a flat colour can be passed as `paint` instead.
 */
function markSquare({
  geometry = ICON,
  margin = ICON_MARGIN,
  size = MARK_VIEWBOX.width,
  stops = RAMP,
  paint,
  backdrop,
  radius = 0,
  id = "r",
  title,
  standalone = true,
}) {
  const placed = fit(geometry.ink, MARK_VIEWBOX, margin);
  const fill = paint ?? `url(#${id})`;
  const ground = backdrop
    ? `<rect x="${MARK_VIEWBOX.x}" y="${MARK_VIEWBOX.y}" width="${MARK_VIEWBOX.width}" height="${MARK_VIEWBOX.height}" rx="${radius}" fill="${backdrop}"/>`
    : "";
  const defs = paint ? "" : `<defs>${gradient(id, markRamp(geometry.ink), stops)}</defs>`;
  const open = standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(MARK_VIEWBOX)}" width="${size}" height="${size}"` +
      (title ? ` role="img" aria-labelledby="${id}-title">\n  <title id="${id}-title">${title}</title>` : ">")
    : "";
  return (
    `${open}${ground}${defs}` +
    `<g transform="translate(${placed.x} ${placed.y}) scale(${placed.scale})">${drawMark(geometry, fill)}</g>` +
    (standalone ? "</svg>" : "")
  );
}

/**
 * The full lockup: the mark, then "Health" in ink and "OS" in the ramp.
 *
 * `ink` is a literal rather than a custom property or currentColor -- this is
 * rendered to a bitmap, with nothing to inherit from and no theme to follow.
 */
function lockupSvg({ width, height, ink = INK, stops = RAMP, fontFamily, id = "l", backdrop, embedFont }) {
  const { mark, word } = LOCKUP;
  const ground = backdrop
    ? `<rect x="${LOCKUP.viewBox.x}" y="${LOCKUP.viewBox.y}" width="${LOCKUP.viewBox.width}" height="${LOCKUP.viewBox.height}" fill="${backdrop}"/>`
    : "";

  // A file that merely names "Geist" renders in Times on any machine that
  // does not have it, which is most of them. The rasters are fine -- the
  // headless browser is given the face -- but a standalone .svg handed to
  // somebody is not, so the exports carry the font inside them. 28KB, once,
  // in a file that is not served to browsers.
  const face = embedFont
    ? `<defs><style>@font-face{font-family:"${WORDMARK_FAMILY}";src:url("${embedFont}") format("woff2");font-weight:100 900;font-style:normal;}</style></defs>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(LOCKUP.viewBox)}" width="${width}" height="${height}" role="img" aria-label="${BRAND_NAME}">
  ${ground}${face}<defs>${gradient(`${id}-m`, LOCKUP.ramp, stops)}${gradient(`${id}-w`, LOCKUP.wordRamp, stops)}</defs>
  <g transform="translate(${mark.x} ${mark.y}) scale(${mark.scale})">${drawMark(MARK, `url(#${id}-m)`)}</g>
  <text x="${word.x}" y="${word.baseline}" font-family="${fontFamily}" font-size="${word.size}" font-weight="${word.weight}" letter-spacing="${word.tracking}"><tspan fill="${ink}">${WORDMARK_INK_TEXT}</tspan><tspan fill="url(#${id}-w)">${WORDMARK_RAMP_TEXT}</tspan></text>
</svg>`;
}

// --------------------------------------------------------------- app/icon.svg

// The tab icon, as vector.
//
// It carries both ramps and switches on prefers-color-scheme, which is the one
// icon surface that can: a browser rendering this in a dark tab strip gets the
// lifted ramp. The .ico beside it cannot do that and ships the light ramp,
// which is also what Next serves first -- see FAVICON_SIZES in the identity.
function iconSvg() {
  const placed = fit(ICON.ink, MARK_VIEWBOX, ICON_MARGIN);
  const stops = (ramp, suffix) =>
    ramp.map((s, i) => `      --s${i}${suffix}: ${s.color};`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(MARK_VIEWBOX)}" width="${MARK_VIEWBOX.width}" height="${MARK_VIEWBOX.height}" role="img" aria-labelledby="whealthos-icon-title">
  <title id="whealthos-icon-title">${BRAND_NAME}</title>
  ${comment(`GENERATED by scripts/build-brand-assets.mjs from lib/brand/identity.mjs.
       Do not edit by hand: change the identity and run the script.

       The standalone W, optically sized for a favicon: the same vertices as
       the lockup, drawn with a heavier stroke and a larger head, because a
       stroke that reads at 64px goes spindly at 16px and an arrowhead scaled
       down mechanically disappears.`)}
  <style>
    :root {
${stops(RAMP, "")}
    }
    @media (prefers-color-scheme: dark) {
      :root {
${stops(RAMP_DARK, "")}
      }
    }
  </style>
  <defs>
    <linearGradient id="whealthos-icon-ramp" x1="${markRamp(ICON.ink).x1}" y1="0" x2="${markRamp(ICON.ink).x2}" y2="0" gradientUnits="userSpaceOnUse">
${RAMP.map((s, i) => `      <stop offset="${s.offset}" style="stop-color: var(--s${i})"/>`).join("\n")}
    </linearGradient>
  </defs>
  <g transform="translate(${placed.x} ${placed.y}) scale(${placed.scale})">
    ${drawMark(ICON, "url(#whealthos-icon-ramp)")}
  </g>
</svg>
`;
}

// ------------------------------------------------------------------- the font

// Geist, from inside Next.
//
// next/font/google fetches Geist at build time, so there is no copy in the
// project to point at -- but Next bundles the variable font for its own
// devtools, and that file is the same face with the whole 100-900 weight axis.
// Using it keeps this script offline and hermetic.
//
// If a Next upgrade moves the file this throws rather than quietly falling back
// to a system sans: a wordmark set in the wrong face is worse than a failed
// regeneration, and the committed PNGs keep working in the meantime.
function geistDataUri() {
  const nextDir = path.dirname(require_.resolve("next/package.json"));
  const candidates = [
    "dist/next-devtools/server/font/geist-latin.woff2",
    "dist/esm/next-devtools/server/font/geist-latin.woff2",
    "dist/compiled/@next/font/dist/google/geist-latin.woff2",
  ].map((rel) => path.join(nextDir, rel));

  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    throw new Error(
      `Could not find the Geist variable font inside Next. Looked in:\n  ${candidates.join("\n  ")}\n` +
        "A Next upgrade has probably moved it. Point this at the new path, or " +
        "vendor a copy of Geist, before regenerating the brand rasters -- do " +
        "not let it fall back to a system face."
    );
  }
  say("font:", path.relative(nextDir, found));
  return `data:font/woff2;base64,${fs.readFileSync(found).toString("base64")}`;
}

// --------------------------------------------------------------- rasterising

const CHROME = ["chromium", "google-chrome-stable", "google-chrome", "chrome"];

function chromePath() {
  for (const name of CHROME) {
    try {
      return execFileSync("command", ["-v", name], { shell: "/bin/sh", encoding: "utf8" }).trim();
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    `No Chrome found. Tried: ${CHROME.join(", ")}. Install one, or regenerate ` +
      "the rasters on a machine that has it -- they are committed, so this is " +
      "only needed when the identity changes."
  );
}

// Screenshots an exact-size page. Transparent unless the markup paints a
// background, which is what keeps the email logo usable on any backdrop.
//
// `scheme` forces prefers-color-scheme, so app/icon.svg's dark branch can be
// rasterised deliberately rather than inheriting whatever the machine is set
// to -- otherwise the favicon's colours would depend on the developer's
// desktop theme at the moment they ran the script.
function rasterise({ svg, width, height, fontUri, out, scheme = "light" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whealthos-brand-"));
  const page = path.join(dir, "page.html");
  const shot = path.join(dir, "shot.png");

  const face = fontUri
    ? `@font-face{font-family:"${WORDMARK_FAMILY}";src:url("${fontUri}") format("woff2");font-weight:100 900;font-style:normal;}`
    : "";

  fs.writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><style>
      ${face}
      html,body{margin:0;padding:0;background:transparent;}
      svg{display:block;}
    </style>${svg}`
  );

  execFileSync(
    chromePath(),
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--force-prefers-color-scheme=${scheme}`,
      // Transparent, so the email logo is not baked onto a white rectangle
      // that would show as a pale block in a dark-themed mail client.
      "--default-background-color=00000000",
      `--window-size=${width},${height}`,
      `--screenshot=${shot}`,
      `file://${page}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  const png = fs.readFileSync(shot);
  fs.writeFileSync(out, png);
  fs.rmSync(dir, { recursive: true, force: true });
  return png;
}

// ------------------------------------------------------------------ ICO

// A real multi-size favicon.ico.
//
// app/favicon.ico is not optional and cannot just be deleted in favour of the
// SVG: Next emits whichever icon files app/ contains, and it puts the .ico
// first, so a stale one wins the tab in every browser that prefers ICO -- which
// is how the old mark survived the previous redesign. Safari and older browsers
// want one regardless.
//
// ICO since Vista can hold PNG payloads directly, so this packs the rendered
// PNGs rather than encoding BMP: a 6-byte ICONDIR, one 16-byte ICONDIRENTRY
// per size, then the images.
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    // 0 means 256 in this field; none of our sizes reach it, but be correct.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ----------------------------------------------------------------------- run

const written = [];
const record = (rel, bytes) => {
  written.push({ path: rel, bytes });
  say("wrote", rel, `(${bytes} bytes)`);
};
const write = (rel, contents, root = WEB) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  record(rel, Buffer.byteLength(contents));
};
const shoot = (rel, options, root = WEB) => {
  const out = path.join(root, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const png = rasterise({ ...options, out });
  record(rel, png.length);
  return png;
};

const fontUri = geistDataUri();

// 1. The tab icon, as vector -- the one icon that stays scalable.
write("app/icon.svg", iconSvg());

// 2. The tab icon, as ICO. Transparent, drawn from the icon's own heavier
//    geometry, at every size a browser or a pinned shortcut might ask for.
{
  const images = FAVICON_SIZES.map((size) => ({
    size,
    png: rasterise({
      svg: markSquare({ size, id: `f${size}` }),
      width: size,
      height: size,
      out: path.join(os.tmpdir(), `whealthos-favicon-${size}.png`),
    }),
  }));
  const bytes = ico(images);
  fs.writeFileSync(path.join(WEB, "app/favicon.ico"), bytes);
  record("app/favicon.ico", bytes.length);
  say("  sizes", FAVICON_SIZES.join("/"));

  // The same payloads as loose files, in the press kit. The application does
  // not serve these -- the .ico and icon.svg cover every browser -- but a
  // favicon at a known pixel size is wanted often enough outside one.
  for (const { size, png } of images) {
    const rel = `assets/branding/favicon-${size}.png`;
    fs.mkdirSync(path.join(REPO, "assets/branding"), { recursive: true });
    fs.writeFileSync(path.join(REPO, rel), png);
    record(rel, png.length);
  }
}

// 3. The iOS home-screen icon, on the application's own dark ground: iOS
//    composites a transparent touch icon onto white, which would leave the
//    blue end of the ramp washed out. On that ground it takes the lifted ramp.
shoot("app/apple-icon.png", {
  svg: markSquare({
    geometry: MARK,
    margin: APP_ICON_MARGIN,
    size: APPLE_ICON_SIZE,
    stops: RAMP_DARK,
    backdrop: ICON_BACKDROP,
    radius: 0, // iOS applies its own mask; a radius here would double-round it.
    id: "apple",
  }),
  width: APPLE_ICON_SIZE,
  height: APPLE_ICON_SIZE,
});

// 4. The PWA / Android icons. Maskable: the launcher may crop to a circle, so
//    the mark sits well inside the safe area and the ground runs to the edge.
for (const size of PWA_ICON_SIZES) {
  shoot(`public/brand/icon-${size}.png`, {
    svg: markSquare({
      geometry: MARK,
      margin: APP_ICON_MARGIN,
      size,
      stops: RAMP_DARK,
      backdrop: ICON_BACKDROP,
      id: `pwa${size}`,
    }),
    width: size,
    height: size,
  });
}

// 5. The assistant avatar: the same W on a rounded tile of the brand ramp,
//    knocked out in white. The in-app component draws the mark in
//    currentColor instead, so it follows whichever of the eighteen palettes
//    the account is on; this file is for anywhere that needs a fixed image.
shoot("public/brand/assistant.png", {
  svg: (() => {
    const placed = fit(ICON.ink, MARK_VIEWBOX, APP_ICON_MARGIN);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(MARK_VIEWBOX)}" width="${ASSISTANT_ICON_SIZE}" height="${ASSISTANT_ICON_SIZE}">
      <defs>${gradient("tile", { x1: 0, y1: 32, x2: 32, y2: 0 }, RAMP)}</defs>
      <rect x="0" y="0" width="32" height="32" rx="${APP_ICON_RADIUS}" fill="url(#tile)"/>
      <g transform="translate(${placed.x} ${placed.y}) scale(${placed.scale})">${drawMark(ICON, "#ffffff")}</g>
    </svg>`;
  })(),
  width: ASSISTANT_ICON_SIZE,
  height: ASSISTANT_ICON_SIZE,
});

// 6. The assistant avatar as vector, for the press kit.
write(
  "assets/branding/whealthos-assistant.svg",
  `${(() => {
    const placed = fit(ICON.ink, MARK_VIEWBOX, APP_ICON_MARGIN);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(MARK_VIEWBOX)}" width="${ASSISTANT_ICON_SIZE}" height="${ASSISTANT_ICON_SIZE}" role="img" aria-labelledby="assistant-title"><title id="assistant-title">WHOS</title><defs>${gradient("at", { x1: 0, y1: 32, x2: 32, y2: 0 }, RAMP)}</defs><rect x="0" y="0" width="32" height="32" rx="${APP_ICON_RADIUS}" fill="url(#at)"/><g transform="translate(${placed.x} ${placed.y}) scale(${placed.scale})">${drawMark(ICON, "#ffffff")}</g></svg>`;
  })()}\n`,
  REPO
);

// 7. The assistant mark as files, for anywhere that cannot inline the
//    component. Generated rather than hand-kept, so they cannot drift from it.
write(
  "public/brand/whos-mark.svg",
  `${markSquare({ margin: ICON_MARGIN, id: "whos-mark-ramp", title: "WHOS" })}\n`
);
write(
  "public/brand/whos-mark-mono.svg",
  `${markSquare({ margin: ICON_MARGIN, paint: "currentColor", id: "whos-mark-mono", title: "WHOS" })}\n`
);

// 8. The email lockup. Drawn at RASTER_SCALE and served at EMAIL_LOGO's
//    dimensions, so it stays sharp on a retina display.
{
  const w = EMAIL_LOGO.width * RASTER_SCALE;
  const h = EMAIL_LOGO.height * RASTER_SCALE;
  const png = shoot(`public/${EMAIL_LOGO.path}`, {
    svg: lockupSvg({ width: w, height: h, fontFamily: WORDMARK_FAMILY, id: "mail" }),
    width: w,
    height: h,
    fontUri,
  });
  say(`  ${w}x${h}`);

  // 9. The same bytes as a module, for the XLSX cover sheet. ExcelJS needs the
  //    image in hand when it writes the workbook, and reading it out of
  //    public/ at runtime would reintroduce exactly the cwd problem the PDF
  //    exporter stopped having -- public/ is served by Next, not resolvable
  //    from a server bundle, and cwd differs between `next dev`, `next start`
  //    and a standalone build.
  write(
    "lib/brand/raster.generated.mjs",
    `// GENERATED by scripts/build-brand-assets.mjs. Do not edit.\n` +
      `// The lockup from lib/brand/identity.mjs, rastered at ${w}x${h}.\n` +
      `// Bundled rather than read from public/ so it resolves identically\n` +
      `// under \`next dev\`, \`next start\` and a standalone build.\n` +
      `export const LOCKUP_PNG_WIDTH = ${w};\n` +
      `export const LOCKUP_PNG_HEIGHT = ${h};\n` +
      `export const LOCKUP_PNG_BASE64 =\n  "${png.toString("base64")}";\n`
  );
}

// 10. The social card, for link previews. The lockup on the dark ground, so
//    the wordmark is white and the mark takes the lifted ramp.
shoot(`public/${OG_IMAGE.path}`, {
  svg: (() => {
    const width = Math.round(OG_IMAGE.width * 0.52);
    const height = Math.round((width * LOCKUP.viewBox.height) / LOCKUP.viewBox.width);
    return `<div style="width:${OG_IMAGE.width}px;height:${OG_IMAGE.height}px;background:${ICON_BACKDROP};display:flex;align-items:center;justify-content:center;">
      ${lockupSvg({ width, height, ink: "#ffffff", stops: RAMP_DARK, fontFamily: WORDMARK_FAMILY, id: "og" })}
    </div>`;
  })(),
  width: OG_IMAGE.width,
  height: OG_IMAGE.height,
  fontUri,
});

// 11. The brand asset set: the files a designer or a press kit needs, which
//     the application itself does not serve. Vector, from the same identity,
//     so an exported logo can never be a different drawing from the live one.
{
  const DIR = "assets/branding";
  const W = LOCKUP.viewBox.width;
  const H = LOCKUP.viewBox.height;
  const lockup = (name, options) =>
    write(`${DIR}/${name}.svg`, `${lockupSvg({ width: W, height: H, ...options })}\n`, REPO);
  const mark = (name, options) =>
    write(`${DIR}/${name}.svg`, `${markSquare({ geometry: MARK, margin: MARK_MARGIN, title: BRAND_NAME, ...options })}\n`, REPO);

  lockup("whealthos-logo", { fontFamily: WORDMARK_FAMILY, id: "a", embedFont: fontUri });
  lockup("whealthos-logo-light", {
    fontFamily: WORDMARK_FAMILY,
    id: "b",
    embedFont: fontUri,
    backdrop: "#ffffff",
  });
  lockup("whealthos-logo-dark", {
    fontFamily: WORDMARK_FAMILY,
    id: "c",
    embedFont: fontUri,
    ink: "#ffffff",
    stops: RAMP_DARK,
    backdrop: ICON_BACKDROP,
  });

  mark("whealthos-mark", { id: "d" });
  mark("whealthos-mark-white", { id: "e", paint: "#ffffff" });
  mark("whealthos-mark-ink", { id: "f", paint: INK });
  mark("whealthos-icon-light", {
    id: "g",
    margin: APP_ICON_MARGIN,
    backdrop: "#ffffff",
    radius: APP_ICON_RADIUS,
  });
  mark("whealthos-icon-dark", {
    id: "h",
    margin: APP_ICON_MARGIN,
    stops: RAMP_DARK,
    backdrop: ICON_BACKDROP,
    radius: APP_ICON_RADIUS,
  });
}

// 12. The fingerprint. Hashes the identity's values, not this file's text, so
//     a reworded comment does not report the favicon as stale while a moved
//     vertex or a changed stop does.
const fingerprint = createHash("sha256").update(canonical()).digest("hex");
write(
  "public/brand/generated.json",
  `${JSON.stringify(
    {
      $comment:
        "GENERATED by scripts/build-brand-assets.mjs. The fingerprint is a " +
        "sha256 of lib/brand/identity.mjs's values; tests/brand-logo.test.js " +
        "recomputes it and fails when these files have gone stale.",
      fingerprint,
      generatedAt: new Date().toISOString(),
      files: written.map(({ path: p, bytes }) => ({ path: p, bytes })),
    },
    null,
    2
  )}\n`
);

say("fingerprint", fingerprint.slice(0, 16));
say(`done -- ${written.length} files.`);
