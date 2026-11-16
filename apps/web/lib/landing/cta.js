// What the public pages offer a reader, decided once.
//
// Seven places asked the same question and answered it seven times: the hero
// and the closing section on the landing page, the footer on every page, both
// calls to action on /about, and the two on /pricing. Each named "/sign-up"
// and "/demo" itself, which is fine until the rule stops being "always the
// same two" and starts depending on who is reading. Then every site that
// spells the rule out is a site that can be updated and a site that can be
// forgotten, and the bug is a signed-in reader invited to create the account
// they are already using, halfway down a page they are already signed in to.
//
// A signed-in reader is offered their dashboard and no demo. /pricing used to
// keep the demo button for them on the grounds that the page is public and
// the button is honest -- true, and the route is still open to them, but an
// invitation to sample data is not worth a line on a page being read by
// somebody who has the real thing. That decision was changed deliberately on
// 2026-11-13, not lost.
//
// So the rule lives here and the sections ask.
//
// NOT authorisation, and nothing here should ever be mistaken for it. This
// decides which link is drawn. /dashboard is protected by middleware.js
// (isProtectedRoute) and every page under (main) resolves its own user; a
// reader who types the URL with no session is sent to sign-in whatever this
// returned. Hiding a link has never kept anybody out of anything.
//
// The copy stays with the section. The hero says "Get Started" and FinalCta
// says "Create your account"; both mean /sign-up, and flattening them into one
// string would rewrite the page's voice to save a line here.

/** Where a signed-in reader is sent, and what the button calls it. */
export const DASHBOARD_ACTION = Object.freeze({
  label: "Go to Dashboard",
  href: "/dashboard",
});

/** The real Clerk flow. /welcome and its consent step sit behind it. */
export const SIGN_UP_HREF = "/sign-up";

/** The application on sample data, open to anybody. */
export const DEMO_HREF = "/demo";

/**
 * The actions a public section should render.
 *
 * A signed-in reader gets one button to their own dashboard and no demo
 * invitation: they have the real thing, and the sample data is not an
 * upgrade. A visitor gets both, in the section's own words.
 *
 * `secondary` is null rather than a disabled or empty action so the caller
 * renders nothing at all -- no placeholder, and no gap where a button was.
 *
 * A section with only one action, like the footer's standing offer, omits
 * `demo` and gets null for a visitor too.
 *
 * @param {boolean} signedIn Resolved on the server, before the first render.
 * @param {{ signUp: string, demo?: string }} copy This section's guest labels.
 * @returns {{ primary: { label: string, href: string },
 *             secondary: { label: string, href: string } | null }}
 */
export function landingActions(signedIn, copy) {
  if (signedIn) return { primary: DASHBOARD_ACTION, secondary: null };

  return {
    primary: { label: copy.signUp, href: SIGN_UP_HREF },
    secondary: copy.demo ? { label: copy.demo, href: DEMO_HREF } : null,
  };
}
