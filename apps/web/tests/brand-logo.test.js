import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  APPLE_ICON_SIZE,
  EMAIL_LOGO,
  FAVICON_SIZES,
  ICON,
  ICON_STROKE,
  INK,
  LOCKUP,
  MARK,
  MARK_ARROW,
  MARK_STROKE,
  MARK_VERTICES,
  OG_IMAGE,
  PWA_ICON_SIZES,
  RAMP,
  RAMP_DARK,
  RASTER_SCALE,
  WORDMARK_INK_TEXT,
  WORDMARK_RAMP_TEXT,
  canonical,
  geometry,
} from "@/lib/brand/identity.mjs";

// The WHealthOS identity, asserted at the source.
//
// What breaks here is not a render. It is somebody adding a fifth surface that
// hardcodes its own SVG, a logo change that leaves the favicon and the email
// raster showing last month's mark, or a "cleanup" that deletes a generated
// file nothing appears to reference. None of those fails a build.
const WEB = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(WEB, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");
// Comments stripped, for assertions about what the code does rather than what
// it explains. A comment saying "not var(--font-display)" otherwise counts as
// the file using it.
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const IDENTITY = "lib/brand/identity.mjs";
const LOGO = "components/brand/logo.jsx";
const ICON_SVG = "app/icon.svg";
const MANIFEST = "public/brand/generated.json";

// Every screen that draws the logo.
const SURFACES = [
  "components/header.jsx",
  "components/footer.jsx",
  "components/app-sidebar.jsx",
  "app/(checkout)/layout.js",
];

// Every renderer that draws the brand outside the browser.
const RENDERERS = [
  LOGO,
  "lib/export/pdf.js",
  "lib/export/xlsx.js",
  "emails/_components/brand-header.jsx",
  "app/layout.js",
];

const EMAILS = [
  "emails/template.jsx",
  "emails/contact.jsx",
  "emails/feedback.jsx",
  "emails/inbound-forward.jsx",
];

describe("there is one logo, in one place", () => {
  it("every screen renders the component", () => {
    for (const file of SURFACES) {
      expect(read(file), `${file} does not use the Logo component`).toContain(
        'from "@/components/brand/logo"'
      );
      expect(read(file)).toMatch(/<Logo\b/);
    }
  });

  it("no surface embeds its own copy of the mark", () => {
    for (const file of [...SURFACES, ...EMAILS]) {
      expect(read(file), `${file} inlines the W path`).not.toContain(MARK.path);
      expect(read(file), `${file} still swaps a logo image per theme`).not.toMatch(
        /logo-dark\.png|src="\/logo\.png"/
      );
    }
  });

  it("serves both themes from one element, not two images", () => {
    // --brand-ink, not a bare currentColor: the wordmark has to be deep navy
    // on light and near-white on dark, and currentColor would hand it
    // whatever the surrounding text colour happened to be. The fallback is
    // what renders before the stylesheet applies.
    expect(flat(LOGO)).toContain('fill="var(--brand-ink, currentColor)"');
    // The dark:hidden / hidden dark:block pair is what this replaced.
    for (const file of SURFACES) {
      expect(flat(file), `${file} still has a per-theme logo swap`).not.toMatch(
        /dark:hidden[^"]*"\s*\/>\s*<Image/
      );
    }
  });
});

describe("every renderer derives from the identity", () => {
  // This is the guarantee the whole arrangement exists for: change
  // lib/brand/identity.mjs and every surface follows, because not one of them
  // keeps its own copy of a path, a stop or a metric.
  it("imports it rather than restating it", () => {
    for (const file of RENDERERS) {
      expect(read(file), `${file} does not read the identity`).toMatch(
        /from "[^"]*brand\/identity\.mjs"/
      );
    }
  });

  it("defines the geometry in exactly one place", () => {
    // The generated files carry their own copies by necessity -- a .svg cannot
    // import -- and the script is what puts them there.
    const allowed = new Set([IDENTITY, ICON_SVG, "scripts/build-brand-assets.mjs"]);
    for (const file of [...RENDERERS, ...EMAILS, ...SURFACES]) {
      if (allowed.has(file)) continue;
      expect(read(file), `${file} hardcodes the mark geometry`).not.toContain(MARK.path);
    }
  });

  it("leaves no code reading the retired raster logos", () => {
    for (const file of [...RENDERERS, ...EMAILS, ...SURFACES]) {
      expect(code(file), `${file} still reads an old logo asset`).not.toMatch(
        /logo\.png|logo-dark\.png|logo-sm\.png|faviconV\.ico/
      );
    }
  });
});

describe("the brand ramp", () => {
  const identity = read(IDENTITY);

  it("runs the brief's blue through to its purple", () => {
    expect(RAMP[0].color).toBe("#1266ED");
    expect(RAMP[RAMP.length - 1].color).toBe("#851FEA");
    // The icon carries both ramps, because it switches on prefers-color-scheme.
    expect(read(ICON_SVG)).toContain("#1266ED");
    expect(read(ICON_SVG)).toContain("#851FEA");
  });

  it("is declared once, and the stylesheet agrees with it", () => {
    // The screen reads the ramp through --brand-ramp-N so the dark theme can
    // swap it. Two declarations of one ramp is exactly the drift this whole
    // arrangement exists to prevent, so they are reconciled here.
    const css = read("app/globals.css");
    RAMP.forEach((stop, i) => {
      expect(css, `--brand-ramp-${i} is not the identity's stop`).toContain(
        `--brand-ramp-${i}: ${stop.color};`
      );
    });
    RAMP_DARK.forEach((stop, i) => {
      expect(css, `the dark --brand-ramp-${i} is not the identity's stop`).toContain(
        `--brand-ramp-${i}: ${stop.color};`
      );
    });
  });

  it("lifts for dark grounds, because the brief's ramp is tuned for white", () => {
    // Relative luminance, per WCAG. Every stop of the light ramp lands between
    // 2.8:1 and 3.8:1 on the dark page -- the violet one is under even the 3:1
    // floor for non-text -- which is what made the mark read as a smudge.
    const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const DARK_PAGE = "#121214";
    expect(RAMP_DARK).toHaveLength(RAMP.length);
    RAMP_DARK.forEach((stop, i) => {
      expect(stop.offset, "the two ramps must stop at the same places").toBe(RAMP[i].offset);
      expect(
        contrast(stop.color, DARK_PAGE),
        `${stop.color} is still faint on the dark page`
      ).toBeGreaterThan(4.5);
      expect(
        contrast(stop.color, DARK_PAGE),
        `${stop.color} is brighter than the lifted stop it replaces`
      ).toBeGreaterThan(contrast(RAMP[i].color, DARK_PAGE));
    });
    // And the light ramp still has to work on white, which is what it is for.
    for (const stop of RAMP) {
      expect(contrast(stop.color, "#ffffff"), `${stop.color} is faint on white`)
        .toBeGreaterThan(4.5);
    }
  });

  it("runs left to right, blue through to purple", () => {
    const offsets = RAMP.map((stop) => stop.offset);
    expect(offsets.length).toBeGreaterThanOrEqual(4);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("introduces no colour outside the blue-violet family", () => {
    const hexes = [...identity.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
    expect(hexes.length).toBeGreaterThan(4);
    for (const hex of hexes) {
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(b, `${hex} is not a blue or violet`).toBeGreaterThan(r);
    }
  });
});

describe("accessibility and rendering", () => {
  const logo = read(LOGO);

  it("names itself for a screen reader, and can opt out when the link already does", () => {
    expect(logo).toContain('role: "img"');
    expect(logo).toContain('"aria-label": title');
    expect(logo).toContain('"aria-hidden": true');
    // The checkout link carries its own aria-label, so the logo inside it is
    // decorative -- otherwise the name is announced twice for one link.
    expect(flat("app/(checkout)/layout.js")).toMatch(/<Logo[^>]*decorative/);
  });

  it("gives each instance its own gradient id", () => {
    // Two logos on one page sharing an id makes the second reference the
    // first one's gradient; removing the first then empties both.
    expect(logo).toContain("`whealthos-ramp-${id}`");
    const ids = SURFACES.flatMap((f) => [...read(f).matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]));
    expect(new Set(ids).size, "two surfaces share a gradient id").toBe(ids.length);
  });

  it("is a server component, so the logo costs no client JavaScript", () => {
    expect(logo).not.toContain('"use client"');
  });

  it("pins the wordmark face instead of following the user's font setting", () => {
    // --font-display can be set to a serif and --font-body to a monospace in
    // the appearance settings. A brand mark must not follow either.
    const source = code(IDENTITY);
    expect(source).toContain("var(--font-geist)");
    expect(source).not.toContain("var(--font-display)");
    expect(source).not.toContain("var(--font-body)");
  });
});

describe("the application icon", () => {
  it("is the standalone W, drawn from the identity", () => {
    const icon = read(ICON_SVG);
    expect(icon).toContain("<title");
    expect(icon).toContain('viewBox="0 0 32 32"');
    expect(icon).toContain(ICON.path);
    expect(icon).toContain(ICON.arrowhead);
    expect(icon).not.toMatch(/HealthOS<\/text>/);
  });

  it("is drawn heavier than the lockup mark, for small sizes", () => {
    expect(ICON_STROKE).toBeGreaterThan(MARK_STROKE);
    expect(read(ICON_SVG)).toContain(`stroke-width="${ICON_STROKE}"`);
  });

  it("ships a favicon.ico, because Next puts it ahead of the SVG", () => {
    // This is the one that actually bit: app/favicon.ico held the previous
    // brand, Next emitted it before icon.svg, and every browser that prefers
    // ICO kept showing the old mark in the tab -- on the dashboard and
    // everywhere else -- while every other surface had been redrawn.
    const file = path.join(WEB, "app/favicon.ico");
    expect(existsSync(file)).toBe(true);

    const ico = readFileSync(file);
    expect(ico.readUInt16LE(0), "not an ICO").toBe(0);
    expect(ico.readUInt16LE(2), "ICO type should be 1 (icon)").toBe(1);
    expect(ico.readUInt16LE(4)).toBe(FAVICON_SIZES.length);

    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    FAVICON_SIZES.forEach((size, i) => {
      const entry = 6 + i * 16;
      expect(ico.readUInt8(entry), `entry ${i} is not ${size}px wide`).toBe(size);
      expect(ico.readUInt8(entry + 1)).toBe(size);
      const offset = ico.readUInt32LE(entry + 12);
      expect(
        ico.subarray(offset, offset + 8).equals(PNG),
        `the ${size}px image is not a PNG payload`
      ).toBe(true);
    });
  });
});

describe("the generated assets are in sync with the identity", () => {
  // The one thing a type system cannot catch here: changing the identity and
  // forgetting that a .png cannot follow it. If this fails, run
  //   pnpm --filter @whealthos/web brand:assets
  const manifest = JSON.parse(read(MANIFEST));

  it("carries the fingerprint of the identity it was generated from", () => {
    const expected = createHash("sha256").update(canonical()).digest("hex");
    expect(
      manifest.fingerprint,
      "the brand assets are stale -- regenerate them with `pnpm --filter @whealthos/web brand:assets`"
    ).toBe(expected);
  });

  it("lists every file it generated, and each one is still there", () => {
    const listed = manifest.files.map((f) => f.path);
    expect(listed).toContain("app/icon.svg");
    expect(listed).toContain("app/favicon.ico");
    expect(listed).toContain("app/apple-icon.png");
    expect(listed).toContain(`public/${EMAIL_LOGO.path}`);
    expect(listed).toContain(`public/${OG_IMAGE.path}`);
    expect(listed).toContain("lib/brand/raster.generated.mjs");
    // The icons a phone uses, and the assistant's own files.
    for (const size of PWA_ICON_SIZES) {
      expect(listed).toContain(`public/brand/icon-${size}.png`);
    }
    expect(listed).toContain("public/brand/whos-mark.svg");
    expect(listed).toContain("public/brand/whos-mark-mono.svg");

    for (const { path: rel, bytes } of manifest.files) {
      // assets/branding/* is written relative to the repository, not to
      // apps/web: it is a press kit, not something the application serves.
      const file = rel.startsWith("assets/")
        ? path.join(WEB, "../..", rel)
        : path.join(WEB, rel);
      expect(existsSync(file), `${rel} is listed as generated but is missing`).toBe(true);
      expect(statSync(file).size, `${rel} has changed since it was generated`).toBe(bytes);
    }
  });

  it("rendered the rasters at the declared dimensions", () => {
    // PNG puts width and height in the IHDR, at a fixed offset.
    const dimensions = (rel) => {
      const buf = readFileSync(path.join(WEB, rel));
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    };
    expect(dimensions("app/apple-icon.png")).toEqual({
      width: APPLE_ICON_SIZE,
      height: APPLE_ICON_SIZE,
    });
    expect(dimensions(`public/${EMAIL_LOGO.path}`)).toEqual({
      width: EMAIL_LOGO.width * RASTER_SCALE,
      height: EMAIL_LOGO.height * RASTER_SCALE,
    });
    expect(dimensions(`public/${OG_IMAGE.path}`)).toEqual({
      width: OG_IMAGE.width,
      height: OG_IMAGE.height,
    });
  });
});

describe("the PDF export", () => {
  const pdf = code("lib/export/pdf.js");

  it("draws the lockup as vector rather than embedding a raster", () => {
    expect(pdf).toContain("drawLockup");
    // The letter and the arrowhead that ends it, both redrawn with pdfkit's
    // own primitives from the identity's geometry.
    expect(pdf).toContain("MARK.path");
    expect(pdf).toContain("MARK.arrowhead");
    // "Health" in ink and "OS" in the ramp, the same split as every other
    // surface -- not one flat run of type.
    expect(pdf).toContain("WORDMARK_INK_TEXT");
    expect(pdf).toContain("WORDMARK_RAMP_TEXT");
    // The old implementation read public/logo.png off disk, which embedded the
    // previous brand and depended on cwd resolving the same way under
    // `next dev`, `next start` and a standalone build.
    expect(pdf).not.toContain("readFileSync");
    expect(pdf).not.toContain("doc.image");
  });

  it("puts the brand in the document properties, since the masthead draws it", () => {
    expect(pdf).toMatch(/Title:\s*`\$\{BRAND_NAME\}/);
    expect(pdf).toContain("Author: BRAND_NAME");
  });
});

describe("email", () => {
  const header = "emails/_components/brand-header.jsx";

  it("is the one surface that gets a raster, because clients cannot do SVG", () => {
    expect(read(header)).toContain("EMAIL_LOGO.path");
    // Explicit width and height: Outlook's renderer will not size an image
    // from CSS alone.
    expect(read(header)).toContain("width={EMAIL_LOGO.width}");
    expect(read(header)).toContain("height={EMAIL_LOGO.height}");
  });

  it("names the brand for the clients that block images by default", () => {
    expect(read(header)).toContain("alt={BRAND_NAME}");
  });

  it("appears at the top of every template we send", () => {
    for (const file of EMAILS) {
      expect(read(file), `${file} sends without the logo`).toMatch(/<BrandHeader[ /]/);
    }
  });

  describe("never sends a logo nobody can load", () => {
    const original = { ...process.env };
    beforeEach(() => {
      delete process.env.SITE_URL;
      delete process.env.NEXT_PUBLIC_SITE_URL;
    });
    afterEach(() => {
      process.env = { ...original };
    });

    const src = async () => (await import("@/emails/_components/brand-header")).logoSrc();

    it("uses the public origin when the deployment knows it", async () => {
      process.env.SITE_URL = "https://www.whealthos.com";
      expect(await src()).toBe(`https://www.whealthos.com/${EMAIL_LOGO.path}`);
    });

    it("falls back to type rather than a localhost image in somebody's inbox", async () => {
      process.env.SITE_URL = "http://localhost:3000";
      expect(await src()).toBe(null);
    });

    it("falls back when nothing is configured at all", async () => {
      // siteUrl() returns the localhost fallback here, which resolves on the
      // developer's machine and nowhere else -- the failure this guards is
      // invisible in development and a broken image in production.
      expect(await src()).toBe(null);
    });
  });
});

describe("the social card", () => {
  it("is declared on the root layout", () => {
    // metadata.twitter asks for `summary_large_image`, which needs an image.
    const layout = code("app/layout.js");
    expect(layout).toContain("OG_IMAGE.path");
    expect(layout).toContain("summary_large_image");
  });

  it("is declared again by every page that defines its own openGraph", () => {
    // Next does not deep-merge `openGraph` across segments: a page that
    // defines one REPLACES the root layout's entirely. That is how the
    // landing page -- the one URL people actually share -- ended up with no
    // card at all while the layout above it declared one.
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name.startsWith(".")) return [];
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.jsx?$/.test(entry.name) ? [full] : [];
      });

    const overriding = walk(path.join(WEB, "app")).filter((file) =>
      /openGraph\s*:/.test(readFileSync(file, "utf8"))
    );
    // app/layout.js plus whatever pages set their own.
    expect(overriding.length).toBeGreaterThan(1);

    for (const file of overriding) {
      const rel = path.relative(WEB, file);
      expect(
        readFileSync(file, "utf8"),
        `${rel} overrides openGraph but declares no image, so links to it render bare`
      ).toMatch(/images\s*:/);
    }
  });
});

describe("the spreadsheet export", () => {
  it("brands the cover sheet from the identity, not a sampled hex", () => {
    const xlsx = code("lib/export/xlsx.js");
    expect(xlsx).toContain("argb(INK)");
    expect(xlsx).toContain("LOCKUP_PNG_BASE64");
    // The old header fill was a navy sampled from the retired logo.png.
    expect(xlsx).not.toContain("FF15173D");
  });

  it("keeps the image off the machine-readable sheet", () => {
    // A floating image over the Transactions grid is something a recipient has
    // to work around when they sort, filter or copy the range.
    const xlsx = read("lib/export/xlsx.js");
    const transactions = xlsx.slice(xlsx.indexOf("function addTransactionsSheet"));
    expect(transactions.slice(0, transactions.indexOf("function addSummarySheet"))).not.toContain(
      "addImage"
    );
  });
});

describe("the dashboard rail", () => {
  // The logo was invisible on the dashboard, and the cause was not the logo.
  it("overrides the sidebar's icon sizing, or the lockup renders ~3px tall", () => {
    // SidebarMenuButton carries `[&>svg]:size-4` so the menu icons are
    // uniform. With `asChild` those classes land on the anchor, where they
    // also match the logo -- and `.x > svg` outranks a plain class on the svg
    // itself, so the lockup was forced into a 16px box. At a 122x24 viewBox
    // that leaves about three pixels of ink, which reads as missing rather
    // than as wrong. The previous <Image> was an <img> and never matched.
    expect(read("components/ui/sidebar.jsx")).toContain("[&>svg]:size-4");

    const logos = [...read("components/app-sidebar.jsx").matchAll(/<Logo\b[\s\S]*?\/>/g)].map(
      (m) => m[0]
    );
    expect(logos.length, "the rail should render the lockup and the collapsed mark").toBe(2);
    for (const logo of logos) {
      expect(
        logo,
        "a sidebar <Logo> without an important-flagged size is crushed to 16px by [&>svg]:size-4"
      ).toMatch(/className="[^"]*![a-z-]*(h|w|size)-/);
    }
  });
});

describe("ink", () => {
  it("is a literal only where currentColor cannot reach", () => {
    // On screen the wordmark inherits the theme. A PDF and an email have no
    // theme to inherit from, which is the entire reason INK exists.
    expect(INK).toMatch(/^#[0-9a-fA-F]{6}$/);
    // The screen reads the themed token; INK is the literal the PDF and the
    // generated rasters fall back on, and it must not leak into the component.
    expect(read(LOGO)).toContain("var(--brand-ink");
    // Not the literal, and not the INK binding -- WORDMARK_INK_TEXT, which it
    // does import, merely contains those three letters.
    expect(read(LOGO)).not.toContain(INK);
    expect(read(LOGO)).not.toMatch(/^\s*INK,\s*$/m);
    expect(code("lib/export/pdf.js")).toContain("INK");
    expect(LOCKUP.word.baseline).toBeGreaterThan(0);
  });
});

describe("the arrow is part of the letter", () => {
  it("terminates the W's own final stroke, rather than sitting beside it", () => {
    // The brief is explicit that the arrowhead is the end of the fourth
    // stroke and not a separate element placed over the mark. That is a
    // property of how the geometry is built, so it is asserted rather than
    // eyeballed: the head's point is the last vertex, and the shaft stops
    // short of it by exactly the head's length, along the same line.
    const apex = MARK_VERTICES[MARK_VERTICES.length - 1];
    const prev = MARK_VERTICES[MARK_VERTICES.length - 2];

    const shaftEnd = MARK.path.split(" L").pop().split(" ").map(Number);
    const point = MARK.arrowhead.slice(1).split(" L")[0].split(" ").map(Number);

    // The head's point is the vertex itself.
    expect(point[0]).toBeCloseTo(apex[0], 1);
    expect(point[1]).toBeCloseTo(apex[1], 1);

    // The shaft ends on the segment, MARK_ARROW.length back from the point.
    const gap = Math.hypot(point[0] - shaftEnd[0], point[1] - shaftEnd[1]);
    expect(gap).toBeCloseTo(MARK_ARROW.length, 1);

    // And it is still on that line: the cross product of the stroke's
    // direction with the direction to the shaft's end is zero.
    const cross =
      (apex[0] - prev[0]) * (shaftEnd[1] - prev[1]) -
      (apex[1] - prev[1]) * (shaftEnd[0] - prev[0]);
    expect(Math.abs(cross), "the shaft and the head are not collinear").toBeLessThan(0.1);
  });

  it("points up and to the right", () => {
    // Not straight up and not along the baseline. A W's strokes are steep, so
    // the arrow cannot sit at 45 degrees without the letter ceasing to read
    // as a W; what the brief requires is that it rises and leans right.
    expect(MARK.angle).toBeGreaterThan(45);
    expect(MARK.angle).toBeLessThan(80);

    const apex = MARK_VERTICES[MARK_VERTICES.length - 1];
    const prev = MARK_VERTICES[MARK_VERTICES.length - 2];
    expect(apex[0], "the final stroke does not move right").toBeGreaterThan(prev[0]);
    expect(apex[1], "the final stroke does not move up").toBeLessThan(prev[1]);

    // It overshoots the cap line it started from -- that is the whole point of
    // the letterform, and a mark whose arrow stopped at cap height would not
    // read as rising.
    expect(apex[1], "the arrow does not clear the W's own cap line").toBeLessThan(
      MARK_VERTICES[0][1]
    );
  });

  it("is one unbroken paint from the first downstroke into the point", () => {
    // Stroke and fill are two elements by necessity. They must share a
    // gradient, or the ramp restarts at the arrowhead and the head reads as a
    // different colour from the stroke it ends.
    const logo = flat(LOGO);
    expect(logo).toContain('stroke={`url(#${rampId})`}');
    expect(logo).toContain('fill={`url(#${rampId})`}');
  });

  it("is heavier in the favicon cut, without moving a vertex", () => {
    // The one optical adjustment the brief allows: same geometry, more weight.
    expect(ICON_STROKE).toBeGreaterThan(MARK_STROKE);
    const recut = geometry({
      vertices: MARK_VERTICES,
      stroke: ICON_STROKE,
      arrow: { length: ICON.stroke, halfWidth: 1 },
    });
    expect(recut.angle, "the icon cut is a different drawing").toBe(MARK.angle);
  });
});

describe("the wordmark", () => {
  it("sets Health in ink and OS in the ramp", () => {
    expect(WORDMARK_INK_TEXT + WORDMARK_RAMP_TEXT).toBe("HealthOS");
    const logo = flat(LOGO);
    expect(logo).toContain('<tspan fill="var(--brand-ink, currentColor)">{WORDMARK_INK_TEXT}</tspan>');
    // The source reflows this run across lines, so match the body loosely.
    // What has to hold is the pairing: the gradient-filled tspan carries the
    // print class, and WORDMARK_RAMP_TEXT is what is inside it.
    expect(logo).toContain('className="whealthos-os" fill={`url(#${wordRampId})`}');
    expect(logo).toMatch(/\{WORDMARK_RAMP_TEXT\}\s*<\/tspan>/);
  });

  it("spans its gradient across OS alone, not the whole word", () => {
    // Measured from the real face, so the ramp starts where the O does.
    expect(LOCKUP.wordRamp.x1).toBeGreaterThan(LOCKUP.word.x);
    expect(LOCKUP.wordRamp.x2).toBeGreaterThan(LOCKUP.wordRamp.x1);
    expect(LOCKUP.wordRamp.x2).toBeCloseTo(LOCKUP.viewBox.width, 1);
    // Horizontal: the brief asks for left to right, not a diagonal sweep.
    expect(LOCKUP.wordRamp.y1).toBe(LOCKUP.wordRamp.y2);
    expect(LOCKUP.ramp.y1).toBe(LOCKUP.ramp.y2);
  });

  it("prints the OS run flat, because a gradient on text prints as a slab", () => {
    // Chrome rasterises gradient-filled SVG text as a solid block over the
    // glyph box when the typeface is a web font -- Geist is one -- so every
    // printed page came out with a coloured rectangle where "OS" should be.
    // Reproduced with the face loaded and not without it. The W beside it is
    // a <path> and prints as a gradient either way.
    const logo = flat(LOGO);
    expect(logo).toContain('className="whealthos-os"');

    const css = read("app/globals.css");
    expect(css).toMatch(/@media print \{[\s\S]*?\.whealthos-os[\s\S]*?fill: var\(--brand-ramp-solid\)/);
    // The flat colour is a real stop of the ramp, not a fourth opinion.
    expect(css).toContain(`--brand-ramp-solid: ${RAMP[2].color};`);
  });

  it("sits the mark on the wordmark's own baseline", () => {
    const { mark, word } = LOCKUP;
    const inkBottom = MARK.ink.maxY * mark.scale + mark.y;
    expect(inkBottom, "the mark does not sit on the baseline").toBeCloseTo(word.baseline, 1);
  });
});

describe("every SVG we ship is well-formed", () => {
  // This one actually bit. The generator wrote a prose comment containing
  // "--" into app/icon.svg, and an XML comment may not contain "--" anywhere
  // inside it: the file was not parseable, so every browser rejected the icon
  // outright. Nothing noticed, because Next serves favicon.ico first and
  // almost nothing ever asks for the SVG.
  const files = [
    "app/icon.svg",
    "public/brand/whos-mark.svg",
    "public/brand/whos-mark-mono.svg",
    ...readdirSync(path.join(WEB, "../../assets/branding"))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => `../../assets/branding/${f}`),
  ];

  it("has at least the icon and the assistant mark", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const rel of files) {
    it(`${rel.split("/").pop()} parses`, () => {
      const svg = read(rel);
      for (const comment of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
        expect(
          comment.slice(4, -3),
          `${rel} has "--" inside an XML comment, which makes it unparseable`
        ).not.toContain("--");
      }
      // The shapes of malformedness a generator can actually produce.
      expect(svg.trimStart().startsWith("<svg") || svg.trimStart().startsWith("<?xml")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect((svg.match(/<svg/g) ?? []).length).toBe(1);
      expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
    });
  }
});

describe("the web app manifest", () => {
  const manifestSource = code("app/manifest.js");

  it("exists, so adding to a home screen gets the logo and not a screenshot", () => {
    expect(existsSync(path.join(WEB, "app/manifest.js"))).toBe(true);
    expect(manifestSource).toContain("PWA_ICON_SIZES");
  });

  it("points at icons that were actually generated", () => {
    for (const size of PWA_ICON_SIZES) {
      const file = path.join(WEB, `public/brand/icon-${size}.png`);
      expect(existsSync(file), `public/brand/icon-${size}.png is missing`).toBe(true);
      const buf = readFileSync(file);
      expect(buf.readUInt32BE(16)).toBe(size);
      expect(buf.readUInt32BE(20)).toBe(size);
    }
  });

  it("declares them maskable, since a launcher may crop to a circle", () => {
    expect(manifestSource).toContain("any maskable");
  });
});

describe("the assistant", () => {
  const mark = "components/whos-agent/whos-mark.jsx";

  it("draws the identity's W rather than a second letterform", () => {
    // It used to be its own drawing: a four-stroke zigzag with clipped miters,
    // free to drift from the logo. The brief requires the assistant to use the
    // same W, and the only way to guarantee that is for it to import it.
    expect(read(mark)).toMatch(/from "[^"]*brand\/identity\.mjs"/);
    expect(code(mark)).toContain("ICON.path");
    expect(code(mark)).toContain("ICON.arrowhead");
    expect(code(mark)).not.toMatch(/d="M[\d.]/);
  });

  it("still takes its colour from whatever palette the account is on", () => {
    // Eighteen palettes and a dark mode: a fixed hue here clashes with most of
    // them, so the avatar is a silhouette rather than the gradient lockup.
    expect(code(mark)).toContain('stroke="currentColor"');
    expect(code(mark)).toContain('fill="currentColor"');
    expect(code(mark)).not.toContain("linearGradient");
  });
});
