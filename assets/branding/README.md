# Branding

**CURRENT.** Generated, not hand-made.

Every file here is written by
[`apps/web/scripts/build-brand-assets.mjs`](../../apps/web/scripts/build-brand-assets.mjs)
from [`apps/web/lib/brand/identity.mjs`](../../apps/web/lib/brand/identity.mjs),
which is the one place the logo is defined. **Do not edit them.** Change the
identity and run:

```sh
pnpm --filter @whealthos/web brand:assets
```

See [docs/brand.md](../../docs/brand.md) for the mark itself and for what
bites.

## What is here

This directory is the press kit: the files a person needs when they are not
inside the application. The application serves its own copies from
`apps/web/public/brand/` and `apps/web/app/`.

| File | For |
|---|---|
| `whealthos-logo.svg` | The horizontal lockup, transparent |
| `whealthos-logo-light.svg` | The same, on white |
| `whealthos-logo-dark.svg` | The same, on the dark ground, with the lifted ramp |
| `whealthos-mark.svg` | The standalone W, on the brand ramp |
| `whealthos-mark-white.svg` | The W as a solid white silhouette |
| `whealthos-mark-ink.svg` | The W as a solid navy silhouette |
| `whealthos-icon-light.svg` | Rounded-square app icon, light ground |
| `whealthos-icon-dark.svg` | Rounded-square app icon, dark ground |
| `whealthos-assistant.svg` | The assistant avatar: the W on a ramp tile |
| `favicon-16/32/48/64.png` | The exact payloads packed into `app/favicon.ico` |

The application does not serve the loose `favicon-*.png` files -- `app/favicon.ico`
and `app/icon.svg` cover every browser -- but a favicon at a known pixel size is
wanted often enough outside one.

The three lockups embed Geist as a data URI and so are around 39KB each: a
standalone SVG that merely *names* a font renders in Times on any machine
without it, which is most of them. The mark files carry no type and stay under
a kilobyte — those are the ones to inline in a page.

## Retired

`apps/web/public/logo.png`, `logo-dark.png`, `logo-sm.png` and `faviconV.ico`
are the previous raster brand. Nothing reads them. They are still tracked in
git and have not been deleted.

The known issue recorded here before — the wordmark being near-black navy on
the dark sidebar rail, because only the light PNG was ever rendered — is fixed:
the logo is inline SVG and takes `--brand-ink` from the theme.
