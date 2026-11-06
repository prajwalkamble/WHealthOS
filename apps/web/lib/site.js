// The canonical origin this deployment is served from.
//
// Needed by three things that cannot work with a relative path: the sitemap,
// robots.txt, and metadataBase -- which is what turns a relative Open Graph
// image into the absolute URL that Slack, WhatsApp and X require. Without it
// Next logs a warning at build time and social previews render bare.
//
// SITE_URL, deliberately NOT NEXT_PUBLIC_SITE_URL. Next inlines every
// NEXT_PUBLIC_ variable at BUILD time, so a public one would have to be
// present on the machine that runs `next build` -- set it only at `next
// start` and the build silently keeps the fallback. That failure is
// invisible: robots.txt serves "Disallow: /" and the sitemap advertises
// localhost, and nothing errors. Everything that needs this value (robots,
// sitemap, metadataBase) runs on the server, so a plain variable is read at
// runtime and one build can be promoted across environments.
//
// NEXT_PUBLIC_SITE_URL is still honoured as a fallback, for a deployment
// that already sets it.
//
// The fallback is localhost rather than a guessed production domain. A wrong
// absolute URL is worse than an obviously local one: it would silently
// publish a sitemap pointing at somebody else's host, and nothing would fail.
const FALLBACK = "http://localhost:3000";

const normalise = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  // Accept "example.com" as well as "https://example.com": a bare host in an
  // environment variable is the likelier typo, and refusing it outright at
  // build time is unhelpful.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
};

const configured = () =>
  normalise(process.env.SITE_URL) ?? normalise(process.env.NEXT_PUBLIC_SITE_URL);

export const siteUrl = () => configured() ?? FALLBACK;

// True when this deployment is the real one. Used to keep a staging or
// preview copy out of search results: a second indexed copy of a finance
// product competes with the real one and leaks whatever is on it.
export const isCanonicalHost = () =>
  Boolean(configured()) && process.env.NODE_ENV === "production";

export const absoluteUrl = (path = "/") =>
  new URL(path, `${siteUrl()}/`).toString();
