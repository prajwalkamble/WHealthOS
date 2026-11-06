# Predictive prefetching

Navigation in the signed-in app fetches its destination when somebody looks
like they are about to go there, instead of when a link scrolls into view.

## Why the router and not a query cache

Every page under `app/(main)` is a server component that reads Prisma through
`apps/web/lib/queries.js`. There is no client-side GET API behind any of them --
the route handlers under `app/api/` serve chat, billing, export, Inngest and
webhooks, and `/api/billing/subscription` is read by exactly one component, the
post-payment confirmation poller.

So the data a destination needs does not arrive over `fetch`. It arrives inside
the RSC payload, already rendered. **Prefetching the route is prefetching the
data**, and the cache that holds it is Next's own client Router Cache. A second
caching library would have had nothing to put in it: no query keys to match, no
requests to deduplicate, nothing to invalidate.

## What was actually wrong

Next prefetches a dynamic route only as far as its first `loading.js`, and
every page under `(main)` has one. Measured against a production build on a
public dynamic route:

| Request | Response |
|---|---|
| Plain document GET | 142,024 bytes |
| Prefetch with `Next-Router-Prefetch: 1` (Next's default) | **191 bytes** |
| Full prefetch, `RSC: 1` alone | **41,172 bytes** |

The default prefetch returns essentially nothing -- the skeleton boundary and
no page -- so before this change the Prisma work started on the click. A full
prefetch returns the rendered page. That is the whole gap.

## The mechanism

`components/navigation/use-prefetch-intent.js` detects intent, and nothing
else:

- **pointer enter** starts a 120ms timer (`HOVER_DELAY_MS`); **pointer leave**
  clears it, so a pointer crossing the sidebar on its way elsewhere fetches
  nothing;
- **touchstart** fires immediately, because a phone has no hover to wait for;
- **focus** fires immediately, so tabbing warms the destination too.

It then latches. `armed` goes from false to true once and stays, which is what
`components/navigation/prefetch-link.jsx` hands to `<Link prefetch>`: false
until intent, then explicitly true, which is the documented way to ask Next for
every segment including the page's own data. Latching rather than tracking the
pointer means leaving and returning costs one render in total and no further
requests.

### Three tiers

`PrefetchLink` takes an `intent`:

- **`"full"`** (default) -- Next's automatic prefetch off, a complete prefetch
  on intent. The seven frequently-visited sections.
- **`"shell"`** -- left at Next's default, so the `loading.js` boundary arrives
  and the data does not. **Analytics only**: `getAnalytics()` runs
  `requireFeatureInAction` behind a paid-feature gate and reads up to
  twenty-four months, so a hover there would do the most expensive work in the
  application -- and for an account without the feature, do it only to throw.
- **`"none"`** -- `prefetch={false}` and no handlers. The checkout entry, in
  `settings/_components/plan-card.jsx` and
  `pricing/_components/pricing-plans.jsx`. Prefetching `/billing` would be
  read-only, but it is the one route where a request nobody asked for is worth
  refusing on principle.

## Cache window

`next.config.mjs` sets `experimental.staleTimes` to `{ dynamic: 30, static: 180 }`.

Next 15 defaults `dynamic` to 0, which marks a dynamic page stale the instant
it arrives -- a payload fetched on hover would be discarded and refetched on
the click a moment later, making the prefetch pointless. 30s is the Next 14
default, restored deliberately and not raised further: every page under
`(main)` shows money, and the figure somebody reads has to be the figure in the
database.

Invalidation is not new and was not changed. The server actions in `actions/`
call `revalidatePath` on every write, which drops the matching entries at once.
The window therefore only exposes a write that happened somewhere else -- a
second tab, or a webhook -- within 30 seconds.

Nothing is persisted. The Router Cache is in memory for the life of the
document, and no prefetched payload is written to `localStorage`,
`sessionStorage` or IndexedDB.

## Authorization is still the server's

A prefetch is an ordinary authenticated request and gets the same answer as a
click. Verified against a production build with no session: a prefetch of
`/dashboard`, `/transactions`, `/accounts`, `/analytics` and `/settings` each
returned **HTTP 307** to `/sign-in` with a 62-66 byte body containing only the
redirect URL. Prefetching never widens what an account may read, and the
middleware in `apps/web/middleware.js` remains the thing that decides.

## Verifying a change here

`pnpm test` covers the guard and the wiring (`tests/prefetch-intent.test.js`).
It cannot cover the network behaviour: this package runs vitest with
`environment: "node"` and has no DOM, renderer or testing-library.

Request counts have to be read from the browser's own inspector, and **against
a production build** -- `router.prefetch` and `<Link>` prefetching are both
disabled in `next dev`, so a dev server shows nothing either way:

```sh
NEXT_DIST_DIR=.next-build pnpm build
cd apps/web && NEXT_DIST_DIR=.next-build npx next start -p 3100
```

Then, with the network panel filtered to document/fetch requests: hover a
sidebar item and expect one request after ~120ms; sweep the pointer across the
rail without stopping and expect none; hover the same item repeatedly and
expect nothing after the first.
