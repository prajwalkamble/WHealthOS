// The Content-Security-Policy, built once and served from next.config.mjs.
//
// Shipped in REPORT-ONLY mode first, deliberately. A CSP that is wrong does
// not degrade -- it blanks the application for everyone, which is exactly why
// this was deferred rather than guessed at. Report-Only is not enforced by any
// browser: violations are reported and nothing is blocked, so the allowlist
// below can be proven against real traffic before it is allowed to break
// anything. Promoting it is one line; see HEADER_NAME at the bottom.
//
// What this policy buys, and what it does not:
//
//   It does stop        a script injected from a host that is not listed here,
//                       <object>/<embed>, a hijacked <base href>, a form
//                       posting off-site, and framing of any kind.
//
//   It does NOT stop    an inline <script> injected into the page, because
//                       script-src carries 'unsafe-inline'. Next's App Router
//                       emits inline bootstrap and flight-data scripts on every
//                       response, and removing that allowance needs a
//                       per-request nonce threaded through the middleware --
//                       which is the follow-up that makes this policy worth
//                       enforcing rather than merely observing.
//
// Nothing here is guessed. Clerk's frontend API host is DERIVED from the
// publishable key rather than hardcoded: the key is the base64 of that host, so
// a development instance, a production instance and a preview all produce their
// own correct value with no second place to update.

// The host Clerk's JavaScript talks to, read out of the publishable key.
//
// pk_test_<base64> and pk_live_<base64> both decode to "<host>$". Returns null
// when the key is absent or unreadable, and the caller falls back to Clerk's
// published wildcards -- a missing key at build time must not produce a policy
// that blocks sign-in.
export function clerkHostFromPublishableKey(key) {
  if (typeof key !== "string") return null;
  const body = key.replace(/^pk_(live|test)_/, "");
  if (!body || body === key) return null;
  try {
    const decoded = Buffer.from(body, "base64").toString("utf8").replace(/\$+$/, "");
    // A host and nothing else. Anything carrying a slash, a space or a scheme
    // is not the thing we expected to decode, and must not be pasted into a
    // response header.
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// Clerk's own hosts. The derived one first, then the published wildcards, which
// cover the hosted sign-in frame and the accounts.dev instances.
const clerkHosts = (key) => {
  const derived = clerkHostFromPublishableKey(key);
  return [
    derived ? `https://${derived}` : null,
    "https://*.clerk.accounts.dev",
    "https://*.clerk.com",
  ].filter(Boolean);
};

// Razorpay Standard Checkout. The script comes from checkout.razorpay.com, the
// modal is an iframe it injects, and the API and telemetry hosts are separate.
const RAZORPAY_SCRIPT = ["https://checkout.razorpay.com"];
const RAZORPAY_FRAME = ["https://checkout.razorpay.com", "https://api.razorpay.com"];
const RAZORPAY_CONNECT = ["https://api.razorpay.com", "https://lumberjack.razorpay.com"];

// Clerk's bot protection is Cloudflare Turnstile, which loads and frames from
// its own host. Without this, sign-up fails only when the challenge appears --
// the kind of breakage that is invisible until someone looks like a bot.
const TURNSTILE = ["https://challenges.cloudflare.com"];

// Vercel Speed Insights, mounted in app/layout.js.
//
// On Vercel the script is served same-origin from /_vercel/speed-insights/ and
// 'self' already covers it; these are the fallback the package uses anywhere
// else, and the endpoint its beacons go to. Listed rather than left out
// because a report-only policy that quietly reports a script we added
// ourselves teaches whoever reads the violations to ignore them.
const VERCEL_INSIGHTS_SCRIPT = ["https://va.vercel-scripts.com"];
const VERCEL_INSIGHTS_CONNECT = [
  "https://vitals.vercel-insights.com",
  "https://va.vercel-scripts.com",
];

/**
 * @param {{ publishableKey?: string, isProduction?: boolean }} options
 */
export function buildContentSecurityPolicy({ publishableKey, isProduction = false } = {}) {
  const clerk = clerkHosts(publishableKey);

  const directives = {
    "default-src": ["'self'"],

    // 'unsafe-inline': see the note at the top. 'unsafe-eval' is development
    // only -- Next's dev overlay and fast refresh need it and production does
    // not, so production is not asked to carry it.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isProduction ? [] : ["'unsafe-eval'"]),
      ...clerk,
      ...RAZORPAY_SCRIPT,
      ...TURNSTILE,
      ...VERCEL_INSIGHTS_SCRIPT,
    ],

    // Tailwind and next-themes both write inline styles, and Next inlines the
    // critical CSS. There is no nonce path for these that does not also mean
    // re-architecting the theme switch.
    "style-src": ["'self'", "'unsafe-inline'"],

    // data: for the receipt preview before upload, blob: for the same, and
    // img.clerk.com for avatars. randomuser.me is already the one remote
    // pattern allowed in next.config.mjs.
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com", "https://randomuser.me"],

    // next/font downloads and self-hosts at build time, so there is no font CDN
    // to allow -- which is also what keeps the privacy policy's "no third-party
    // webfonts" claim true.
    "font-src": ["'self'", "data:"],

    "connect-src": ["'self'", ...clerk, ...RAZORPAY_CONNECT, ...VERCEL_INSIGHTS_CONNECT],

    "frame-src": [...RAZORPAY_FRAME, ...clerk, ...TURNSTILE],

    // blob: because Next loads some client chunks through a worker.
    "worker-src": ["'self'", "blob:"],

    // Matches X-Frame-Options: DENY, which stays for older browsers.
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };

  const serialised = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");

  // Only where there is TLS to upgrade to. On localhost this would try to
  // upgrade http://localhost and break the dev server.
  return isProduction ? `${serialised}; upgrade-insecure-requests` : serialised;
}

// Report-only while the allowlist is being proven. Change this to
// "Content-Security-Policy" to enforce -- and read the violation reports first.
export const HEADER_NAME = "Content-Security-Policy-Report-Only";
