import {
  BRAND_NAME,
  ICON_BACKDROP,
  PWA_ICON_SIZES,
  RAMP_START,
} from "@/lib/brand/identity.mjs";

// The web app manifest.
//
// Next serves this at /manifest.webmanifest and injects the <link rel="manifest">
// itself, so there is no file in public/ to keep in step with the icons.
//
// Before this existed, adding the site to a phone's home screen produced a
// screenshot of the page with the title as its label: Android has no icon to
// use without a manifest, and app/apple-icon.png only covers iOS.
//
// The icons are generated from lib/brand/identity.mjs by
// scripts/build-brand-assets.mjs, so this and the home-screen icon cannot
// disagree about what the logo is.
export default function manifest() {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description:
      "Understand your money and make smarter decisions with WHealthOS.",
    start_url: "/",
    display: "standalone",
    // The icons are drawn on the application's own dark ground, so the splash
    // behind them is that ground too -- a white splash would frame a dark icon
    // in a bright box for the second it is shown.
    background_color: ICON_BACKDROP,
    theme_color: RAMP_START,
    icons: PWA_ICON_SIZES.map((size) => ({
      src: `/brand/icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: "image/png",
      // "maskable" lets a launcher crop to its own shape; the generator holds
      // the mark inside the safe area so the arrowhead survives a circular
      // mask. "any" keeps it usable where no mask is applied.
      purpose: "any maskable",
    })),
  };
}
