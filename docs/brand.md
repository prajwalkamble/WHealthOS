# Brand

**CURRENT.**

The WHealthOS logo is defined once, as data, in
[`apps/web/lib/brand/identity.mjs`](../apps/web/lib/brand/identity.mjs).
Nothing else decides what the logo looks like.

## The mark

A custom **W** whose fourth stroke runs past the cap line and ends in an
arrowhead, with `HealthOS` continuing immediately after it as one horizontal
wordmark. The W is the symbol; the type begins at the second letter, so the
lockup reads as one word rather than an icon beside a label.

The arrow is not an element placed on the letter. `geometry()` in the identity
takes the W's five vertices and derives the arrowhead from the direction of the
final stroke: the head's point *is* the last vertex, and the stroke stops short
of it by exactly the head's length so its round cap is swallowed by the
triangle rather than poking out past the tip. Move a vertex and the arrow
follows. `tests/brand-logo.test.js` asserts the two stay collinear.

It is a stroke with round joins rather than a filled outline: filled quads
notch visibly at the vertices at 32px and turn to mush at 16px, while a stroke
holds its weight down to favicon size.

Within a recognisable W the strokes have to be steep, so the arrow rises at
about 64° rather than 45°. It is up and to the right, which is what the
identity asserts; an arrow at a true diagonal would stop the letter reading as
a W.

## Colour

The ramp runs left to right through five stops, blue to purple. Two stops were
not enough: a straight blue-to-purple crosses the blue/violet boundary too
fast and leaves a muddy band across a wide wordmark.

`Health` is set in ink and `OS` in the ramp, so the wordmark resolves from a
solid into the same colour the mark is made of.

**There are two ramps.** The one above is tuned for white. On the dark page
every stop falls between 2.8:1 and 3.8:1 against the background — the violet
stop is 2.76:1, under even the 3:1 floor for non-text — so the mark read as a
dim smudge. `RAMP_DARK` is the same five hues carried up in lightness, which
puts every stop between 6.1:1 and 6.9:1 there.

On screen both the mark and `OS` read their stops from `--brand-ramp-0..4`,
and `Health` from `--brand-ink`; `app/globals.css` redefines all six under
`.dark`. `stop-color` is a presentation attribute and cannot hold a `var()` as
an attribute, so the component sets it through `style` instead. A generated
file has no theme to follow, so each is baked with whichever ramp suits the
ground it sits on: `RAMP` on transparent and white, `RAMP_DARK` on
`ICON_BACKDROP`.

`app/icon.svg` is the one generated file that can still follow a theme: it
carries both ramps in its own `<style>` and switches on
`prefers-color-scheme`. The switching mechanism is verified — flipping the
query in the file swaps the stops — but whether a given browser passes its
preference down to a favicon document varies, and `favicon.ico` (which Next
serves first, and which cannot carry a query) ships the light ramp. Treat the
dark branch as a bonus, not as the thing keeping the icon legible.

The wordmark is pinned to Geist and never follows `--font-display` or
`--font-body`, both of which the appearance settings let a user change.

## Where it is drawn

| Surface | How |
|---|---|
| Every screen | `components/brand/logo.jsx`, inline SVG |
| The assistant | `components/whos-agent/whos-mark.jsx`, the same W in `currentColor` |
| PDF export | `lib/export/pdf.js` redraws the lockup with pdfkit's vector primitives |
| XLSX export | `lib/export/xlsx.js`, on the Summary sheet only |
| Email | `emails/_components/brand-header.jsx`, a hosted PNG |
| Tab and home screen | `app/favicon.ico`, `app/icon.svg`, `app/apple-icon.png` |
| Android / PWA | `app/manifest.js` and `public/brand/icon-{192,256,512}.png` |
| Link previews | `public/brand/og.png`, declared in `app/layout.js` and in every page that overrides `openGraph` |
| Press kit | `assets/branding/*.svg` |

The first five import the identity and re-render on the next request, so a
change to the identity reaches them with no further work.

## Changing the logo

Edit `identity.mjs`, then:

```sh
pnpm --filter @whealthos/web brand:assets
```

That regenerates everything that cannot import code — the favicons, the app
icons, the email raster, the social card, the assistant's two SVGs and the
press kit — and records a fingerprint of the identity's values in
`public/brand/generated.json`. `tests/brand-logo.test.js` recomputes that
fingerprint and fails when the two disagree, which is what stops a logo change
from leaving a stale favicon behind. **If that test fails, run the script.**

The script rasterises with the Chrome already on the machine rather than
adding an image library to the dependency tree, and sets the wordmark in the
real Geist — the variable font bundled inside Next covers the whole 100–900
axis, so weight 600 is genuine rather than synthesised.

## Things that bite

- **An XML comment may not contain `--`.** Not even in prose. The generator
  wrote exactly that into `app/icon.svg`, which made the file unparseable:
  browsers rejected the icon outright, and nothing noticed, because Next serves
  `favicon.ico` first and almost nothing ever asks for the SVG. The generator
  now translates the dashes, and the test parses every SVG it ships.
- **A standalone `.svg` that merely names a font renders in Times.** The
  rasters are fine — the headless browser is handed the face — but a file
  given to somebody else is not, so the three exported lockups in
  `assets/branding/` carry Geist inside them as a data URI. The mark-only
  files have no type and stay under a kilobyte.
- **Email clients cannot render inline SVG.** Gmail strips the element and
  Outlook's Word-based renderer ignores it. Email is the one surface that gets
  a bitmap, and it needs explicit `width`/`height` attributes because Outlook
  will not size an image from CSS.
- **The email logo needs a public origin.** `siteUrl()` falls back to
  `http://localhost:3000`, which resolves on a developer's machine and nowhere
  else — so an unset `SITE_URL` would send a broken image and nothing local
  would reveal it. `brand-header.jsx` typesets the name instead when the origin
  is not public.
- **pdfkit cannot embed an SVG.** It can draw one: the exporter re-draws the
  same paths, gradients and metrics with `doc.path()` and
  `doc.linearGradient()`. Its gradients are built inside the space they are
  used in, because a gradient's coordinates mean whatever the matrix in force
  says they mean.
- **The wordmark in a PDF is Helvetica-Bold, not Geist.** Embedding a
  variable-weight subset for eight characters costs more than it is worth in a
  document that is mostly a table. The mark beside it is the real geometry, and
  the ink/ramp split is kept.
- **`app/favicon.ico` is not optional.** Next emits every icon file `app/`
  contains and puts the `.ico` **first**, so a browser that prefers ICO takes
  it over `icon.svg`. A stale `favicon.ico` is how the previous mark survived a
  redesign in the browser tab while every other surface had been redrawn. The
  generator packs 16/32/48/64px PNG payloads into a real multi-size ICO.
- **Next does not deep-merge `openGraph` across segments.** A page that defines
  its own `openGraph` **replaces** the root layout's entirely — which is how the
  landing page, the one URL people actually share, ended up with no card while
  the layout above it declared one. `tests/brand-logo.test.js` walks `app/` and
  fails any file that overrides `openGraph` without an `images` key.
- **Two logos on one page need different `id`s.** Gradient ids are
  document-global: give two instances the same one and the second references
  the first's gradient, so a themed ramp silently stops following its own
  theme. `<Logo id="...">` exists for this.
- **`public/logo.png`, `logo-dark.png`, `logo-sm.png` and `faviconV.ico` are
  the retired raster brand.** Nothing reads them any more. They are still
  tracked in git and have not been deleted.
