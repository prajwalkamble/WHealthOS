# Authentication-aware public CTAs

**Status: CURRENT** — implemented 2026-11-13.

> The filename says "homepage" because that is where this started and what it
> was specified as. It was extended the same day to every public call to
> action: the landing page, the footer on every page, `/about` and `/pricing`.

The public pages offer a visitor two things: create an account, or look at
the product first. Someone who already has an account needs neither. This
makes those calls to action follow who is reading.

## What changed, and what did not

Every call to action on a public page, extended from the homepage to the
whole site on 2026-11-13.

| Page | Section | Visitor | Signed in |
|---|---|---|---|
| `/` | hero | **Get Started** → `/sign-up` + **Explore the live demo** → `/demo` | **Go to Dashboard** |
| `/` | closing | **Create your account** + **Try it without signing up** | **Go to Dashboard** |
| any | footer | **Get Started** → `/sign-up` | **Go to Dashboard** |
| `/about` | hero | **Get Started** + **Explore WHealthOS** | **Go to Dashboard** |
| `/about` | closing | **Get Started** + **Explore WHealthOS** | **Go to Dashboard** |
| `/pricing` | plan footer | **Get Started Free** + **Explore WHealthOS** | **Go to Dashboard** |
| `/pricing` | `PricingCta` | three states — see below | **Go to Dashboard** |

In every signed-in case the demo action is *not rendered*: no placeholder, no
disabled button, no reserved width.

Unchanged: every heading, paragraph, animation, button size, radius, weight
and colour. This is a behavioural change. The buttons that render are the
same components with the same classes they had.

Also unchanged, deliberately:

- **`/demo` is still public.** Hiding an invitation is not locking a door. An
  authenticated reader who types the URL, or follows a link from the pricing
  page, still gets the demo.
- **No automatic redirect.** A signed-in reader can read the landing page,
  pricing, about and the rest. Only the CTA destination changes.
- **The header is untouched.** It already showed a Dashboard button and the
  avatar to a signed-in reader, and `/sign-in` to a visitor, from before this
  change. The hero's new primary action and the header's Dashboard button now
  point at the same place.

## Where the rule lives

`apps/web/lib/landing/cta.js` — one function, `landingActions(signedIn, copy)`.

```js
landingActions(false, { signUp: "Get Started", demo: "Explore the live demo" })
// → { primary: { label: "Get Started",      href: "/sign-up" },
//     secondary: { label: "Explore the live demo", href: "/demo" } }

landingActions(true, /* same copy */)
// → { primary: { label: "Go to Dashboard", href: "/dashboard" },
//     secondary: null }
```

It exists because seven places asked the same question. Before this, each
named `/sign-up` and `/demo` itself, so updating one and missing another gave
a signed-in reader a dashboard button in the hero and an invitation to create
an account further down the same page — or on the next page they opened.

A section with only one action, like the footer, omits `demo` and gets `null`
for a visitor too.

### Two deliberate exceptions on `/pricing`

`pricing-cta.jsx` is a client component, and stays one, because it has a
third state no server can see: **a guest who already has rows in the demo**
gets "Back to your demo" and "Create a free account". Demo mode keeps
everything in `localStorage` and sets no cookie by design, so the server
cannot know. That state is preserved and asserted by a test.

On a **first visit** that section deliberately leads with the demo as the
primary button and sign-up as the outline — the inverse of `landingActions`'
ordering, documented at `free-pricing.jsx:34`. The shared module supplies its
destinations, but the ordering was left as it is rather than silently flipped.

`pricing-cta.jsx` previously kept the demo button for signed-in readers, on
the stated grounds that the page is public and the button is honest. That
decision was **changed deliberately**, not lost: the route is still open and
still reachable by URL, but the invitation is no longer offered to somebody
who has the real thing. The old reasoning is recorded in the module header of
`lib/landing/cta.js`.

`secondary` is `null`, not a disabled or empty action, so the caller renders
nothing — no placeholder and no reserved width.

The **copy stays with the section**. The hero says "Get Started", the closing
section says "Create your account"; both mean `/sign-up`. Collapsing them into
one shared string would rewrite the page's voice to save a line.

## How the session is resolved

Both sections are async server components calling `auth()` from
`@clerk/nextjs/server`, the same way `components/header.jsx:60` already did.

**There is no loading state, and that is not an omission.** `auth()` has
resolved before the component returns, so the first HTML the browser receives
already contains the correct button. There is no interval during which the
wrong CTA exists to be seen, so there is nothing to cover with a skeleton and
no layout shift to prevent. A client-side `useAuth()` hook would have created
the flicker that then needed hiding.

This costs no extra round trip: `app/(marketing)/layout.js:17` already calls
`auth()` on the same request, and `/` is server-rendered on demand regardless
because it reads a currency cookie (`lib/currency/server.js:57`).

Consequences worth stating:

- **Session expiry** needs no handling of its own. The page is rendered per
  request; the next request after a session ends renders the visitor's CTAs.
  There is no cached client state to go stale, because no client state is used.
- **Sign-out** restores the visitor CTAs by the same mechanism, on the next
  render of the page.
- **An unresolved or failed session** is a visitor. `Boolean(userId)` of
  anything that is not a user id is `false`, which offers sign-up and the
  demo — the safe direction. It never opens a dashboard link.

## Navigation and redirects

`Get Started` → `/sign-up`, which is Clerk's flow. None of that was invented
for this change and none of it was altered:

- `app/(auth)/sign-up/[[...sign-up]]/page.jsx` passes
  `forceRedirectUrl={/welcome?next=…}` — `forceRedirectUrl` rather than
  `fallbackRedirectUrl`, so the consent step cannot be skipped by a
  `?redirect_url` on the way in.
- A requested destination is deferred, not dropped: it rides on `/welcome` and
  is used once consent has been given.
- `app/(main)/layout.js` refuses to render without an account row, so a
  signup that lands anywhere else still arrives at consent first.

Destinations arriving in a URL go through `safeRedirect`
(`apps/web/lib/safe-redirect.js`), which accepts same-site path-only values
and refuses `https://evil.example`, protocol-relative `//evil.example`,
backslash forms `/\evil.example`, anything not starting with `/`, and control
characters. It is covered by `tests/checkout-url.test.js`.

`Go to Dashboard` is an ordinary `next/link`, so it is a client-side
navigation with no full page reload. No user id or workspace id is passed: the
dashboard resolves its own user server-side.

## This is not authorisation

Rendering a link decides what is offered, never what is allowed:

- `/dashboard` is in `isProtectedRoute` in `middleware.js`; an unauthenticated
  request is sent to sign-in whatever the landing page rendered.
- Everything under `(main)` resolves its own user and the data layer is
  tenant-scoped by RLS.
- Changing `signedIn` in devtools gets a different button and no access.

## Demo isolation

An authenticated reader can still open `/demo`, so it matters that the demo
cannot reach real data. It cannot, structurally: **no file under
`apps/web/app/demo/` imports a server action, Prisma, or Clerk.** The whole
tree is client-side, fed by `lib/demo/store.js`, with the guest's own rows in
`localStorage`. There is no code path by which a real figure could enter the
sample dashboard or a demo edit could reach the database.

`tests/landing-cta.test.js` asserts this by walking the directory, so a future
file that adds such an import fails the suite rather than shipping.

The demo reuses the real dashboard's widgets rather than copies of them, which
is deliberate — what a visitor evaluates is the real interface.

## Responsive and accessible behaviour

The actions sit in `flex flex-col items-center justify-center gap-3 sm:flex-row`:
stacked and full width on a phone, side by side and auto width from `sm`. With
one action the row centres that one action — `gap-3` adds nothing between a
single child, and no width is reserved, so there is no gap where the demo
button was and the remaining button is not stretched.

Both actions are `<Button asChild>` wrapping a `next/link`, so each renders as
a single `<a>`: a real link, keyboard focusable, Enter-activated, with the
theme's own focus ring. No `aria-hidden` element is left behind — the hidden
action is not rendered at all, so it is absent from the accessibility tree
rather than hidden within it.

## Files

| File | Change |
|---|---|
| `apps/web/lib/landing/cta.js` | new — the rule |
| `apps/web/components/hero.jsx` | label and destination follow the reader; demo action conditional |
| `apps/web/components/landing/final-cta.jsx` | became an async server component |
| `apps/web/components/footer.jsx` | became an async server component; single action |
| `apps/web/app/(marketing)/about/_components/about-hero.jsx` | became an async server component |
| `apps/web/app/(marketing)/about/_components/about-cta.jsx` | became an async server component |
| `apps/web/app/(marketing)/pricing/_components/plan-pricing.jsx` | uses the `signedIn` prop the page already passed |
| `apps/web/app/(marketing)/pricing/_components/pricing-cta.jsx` | signed-in branch now one action; guest branches keep their order, take shared destinations |
| `apps/web/tests/landing-cta.test.js` | new — 16 tests |

Four components became `async`. That costs no static rendering: every route
under `(marketing)` was **already** server-rendered on demand, because
`app/(marketing)/layout.js:17` calls `auth()` for the whole segment. Clerk's
`auth()` is resolved once per request, so the added calls are not extra round
trips.

## Known limitations

1. **Prose was not rewritten anywhere.** "Start with one
   account and a week of transactions" reads oddly above a Go to Dashboard
   button, and `/about` and `/pricing` have the same mismatch. Changing
   marketing copy was out of scope for a behavioural change.
2. **No browser verification.** See the test report — the Chrome extension was
   not connected, so responsive layouts, both themes, keyboard traversal and
   the signed-out/signed-in transition are recorded as not verified rather
   than passed.
