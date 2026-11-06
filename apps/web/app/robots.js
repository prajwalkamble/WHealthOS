import { siteUrl, isCanonicalHost } from "@/lib/site";

// Computed per request, not prerendered.
//
// Next treats both of these as static by default and bakes them at build
// time -- which reads SITE_URL from the build machine, not the running one.
// A single image promoted from staging to production would then keep
// whatever the builder saw: in practice "Disallow: /" and a sitemap full of
// localhost URLs, served with a 200 and no error anywhere. Per request they
// read the environment they are actually running in.
export const dynamic = "force-dynamic";


// robots.txt, generated rather than a static file so it can differ between
// the real deployment and everything else.
//
// Everything a signed-in person sees is disallowed. Those routes all redirect
// to sign-in for a crawler, so they would never be indexed anyway -- but
// listing them stops the crawl budget being spent discovering that, and stops
// a URL with a record id in it appearing in a referrer log somewhere.
export default function robots() {
  // A staging or preview copy asks not to be indexed at all. Two indexed
  // copies of the same finance product compete with each other, and the one
  // with the test data is not the one you want found.
  if (!isCanonicalHost()) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/transactions",
          "/transaction/",
          "/accounts",
          "/account/",
          "/cards",
          "/budgets",
          "/goals",
          "/analytics",
          "/settings",
          "/billing",
          "/welcome",
          "/sign-in",
          "/sign-up",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
