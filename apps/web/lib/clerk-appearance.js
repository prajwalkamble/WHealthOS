import { EMAIL_LOGO } from "@/lib/brand/identity.mjs";

// What Clerk's own sign-in and sign-up cards are branded with.
//
// Clerk draws the logo at the top of those cards from the image uploaded in
// its dashboard, which is still the old WHealth mark -- the blue bar-chart
// drawing the product has not used since the identity in lib/brand was
// adopted. appearance.layout.logoImageUrl overrides that per component, so
// the card follows this repository rather than a setting in somebody's
// browser tab, and a stale upload cannot quietly put the old logo back.
//
// The URL is the generated lockup raster, taken from identity.mjs rather than
// written out here: it is the same file the email header serves, drawn from
// the same source as <Logo>, and if its path ever changes this follows.
//
// A raster and not the inline <Logo> component because Clerk takes a URL, so
// the image is loaded by an <img> it owns -- which cannot see the page's CSS
// custom properties, and therefore cannot use the themed SVG. That costs
// nothing here: the cards render in Clerk's own light theme in both site
// themes (nothing passes baseTheme and globals.css has no cl- overrides), so
// one dark-ink lockup is correct on both.
export const authAppearance = {
  layout: {
    logoImageUrl: `/${EMAIL_LOGO.path}`,
    // Back to the marketing site. Without this Clerk uses the Home URL from
    // its dashboard, which points at the production domain and takes someone
    // signing in on localhost off to the live site.
    logoLinkUrl: "/",
  },
};
