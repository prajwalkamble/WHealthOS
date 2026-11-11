// A development-only entitlement override for one named account.
//
// What it does: lets a single configured account past the entitlement gate
// for every feature in the published matrix.
//
// What it is NOT: a plan. The account stays on whatever its subscription rows
// say -- Free, in the configured case, since it has never bought anything --
// and every screen that reports a plan goes on reporting that one. Injecting
// here rather than in effectivePlanId() is the whole design: a synthetic
// "intelligent" plan id would flow into billingSummary() and Settings would
// display a subscription that does not exist, which is the one thing a
// testing aid must never do. It writes nothing, and no code path from here
// reaches Razorpay, the subscriptions table or the notification queue.
//
// It grants FEATURE ELIGIBILITY and nothing else. Clerk authentication, the
// middleware's isProtectedRoute check, Arcjet's rate limits and bot
// detection, the RLS tenant scoping in withCurrentTenant() and every
// ownership check sit upstream or downstream of this and are not consulted
// here, so none of them can be loosened by it.
//
// Four conditions, all required, each failing closed:
//
//   1. not running on Vercel
//   2. DEV_FEATURE_OVERRIDE is "on"
//   3. DEV_FEATURE_OVERRIDE_EMAIL is present and shaped like an address
//   4. the authenticated internal user id equals DEV_FEATURE_OVERRIDE_USER_ID
//
// On the first: process.env.VERCEL is set by Vercel on every deployment --
// Production, Preview and their build steps alike -- and by nothing else. So
// requiring it ABSENT covers "never in production" and "never in Preview"
// with one rule, and needs no list of environment names to keep correct.
//
// NODE_ENV would have been the obvious choice and is the wrong one: a local
// `pnpm build && next start` runs with NODE_ENV=production, so keying off it
// would switch the override off in exactly the configuration changes are
// verified in before they ship. "Development" here means "not a deployment",
// which is what VERCEL actually answers.
//
// There is a second, independent reason a deployment cannot inherit this,
// established while auditing the enforcement switch: these variables live in
// apps/web/.env, which is gitignored, and `next start` loads that file while
// Vercel does not. Configuration would have to be copied into the Vercel
// dashboard by hand for the question to even arise -- and if somebody does
// that, the boot check in lib/security/required-config.js says so.

// Any Vercel environment: "production", "preview" or "development", plus the
// bare VERCEL=1 present during a build. Truthiness is the test, not equality
// with a particular value, because any of them means "this is a deployment".
export const onVercel = () => Boolean(process.env.VERCEL);

// "on" rather than "true", matching BILLING_ENFORCEMENT, BILLING_PLANS_ON_SALE
// and BILLING_QUOTA_ENFORCEMENT. One vocabulary for the switches in this
// directory; see .env.example.
export const overrideFlagOn = () =>
  String(process.env.DEV_FEATURE_OVERRIDE ?? "").toLowerCase() === "on";

// The authorisation value: an immutable internal users.id (a uuid). This is
// what every gate already holds -- requireFeature(userId, key) is handed it,
// and getCurrentUserId() derives it server-side from the verified Clerk
// session -- so matching on it costs no query and nothing a browser sends can
// influence it.
export const configuredUserId = () =>
  String(process.env.DEV_FEATURE_OVERRIDE_USER_ID ?? "").trim();

// The configured address. REQUIRED for the override to work -- an absent or
// malformed one disables it -- but never matched against a request, and never
// the thing that identifies the account.
//
// The distinction is worth stating exactly, because the two halves pull in
// different directions:
//
//   It is required because a half-written configuration should do nothing
//   rather than something. An id with no address beside it is an opaque uuid
//   that nobody reading .env can check, and "which account is this?" is a
//   question the override must always have an answer to.
//
//   It is not the authorisation because re-deriving the id from an address
//   would mean an email lookup at all 20 server-side gates, on every request,
//   forever, to recover what the id already settles. So the id->address
//   binding is verified ONCE, against the users table, when the override is
//   configured -- recorded in docs/development/DEV_FEATURE_OVERRIDE.md -- and
//   what runs per request is the id comparison alone.
//
// So this is a completeness check on the configuration, not a second factor,
// and nothing here is compared with anything a request carries.
export const configuredEmail = () =>
  String(process.env.DEV_FEATURE_OVERRIDE_EMAIL ?? "").trim().toLowerCase();

// Roughly RFC-shaped: a local part, one @, a dotted domain. Enough to catch a
// placeholder left in place or a truncated paste, which is all a startup check
// can usefully do about an address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailLooksValid = (value) => EMAIL_SHAPE.test(value);

/**
 * Whether the override is configured and permitted in this environment.
 *
 * Says nothing about any particular user -- see devGrantsAll. Unset, blank,
 * misspelled and "off" all come out false, as does every Vercel environment.
 *
 * @returns {boolean}
 */
export const devOverrideEnabled = () =>
  !onVercel() &&
  overrideFlagOn() &&
  configuredUserId().length > 0 &&
  emailLooksValid(configuredEmail());

/**
 * Whether this account gets every feature by development override.
 *
 * @param {string | null | undefined} userId internal users.id, from a verified
 *   session -- never from a request body, a query parameter, a header or a
 *   cookie.
 * @returns {boolean}
 */
export const devGrantsAll = (userId) => {
  // A falsy or non-string id must never compare equal to anything, including
  // an empty configured value. Checked before the environment so that a
  // signed-out caller is false for the same reason in every environment.
  if (typeof userId !== "string" || userId.length === 0) return false;
  if (!devOverrideEnabled()) return false;
  return userId === configuredUserId();
};

/**
 * What is wrong with the override's configuration, if anything.
 *
 * Pure, so it can be tested without a server, and reported at boot by
 * reportDevOverrideState() in lib/security/required-config.js.
 *
 * None of these can grant access -- every one of them leaves
 * devOverrideEnabled() false -- so none is a vulnerability. They are silent
 * failures, and silence is the problem: the first looks like a backdoor to
 * anyone reading a deployment's configuration, and the others look like a
 * broken application to whoever is trying to use the override, who will
 * reasonably conclude the features are broken rather than the config.
 *
 * @returns {Array<{ code: string, detail: string }>}
 */
export function devOverrideProblems() {
  const found = [];

  if (overrideFlagOn() && onVercel()) {
    found.push({
      code: "DEV_OVERRIDE_ENABLED_ON_VERCEL",
      detail:
        'DEV_FEATURE_OVERRIDE is "on" in a Vercel environment ' +
        `(VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}). It grants nothing -- the ` +
        "override refuses every Vercel environment by construction -- but it means the " +
        "variable was copied into a deployment, where it has no purpose and reads as a " +
        "backdoor. Remove it from the project's environment variables",
    });
  }

  if (overrideFlagOn() && !onVercel() && configuredUserId().length === 0) {
    found.push({
      code: "DEV_OVERRIDE_ENABLED_WITHOUT_USER_ID",
      detail:
        'DEV_FEATURE_OVERRIDE is "on" but DEV_FEATURE_OVERRIDE_USER_ID is not set, so ' +
        "the override matches no account and does nothing. Set it to the internal " +
        "users.id of the development account -- the email address is not the " +
        "authorisation value and will not stand in for it",
    });
  }

  if (
    overrideFlagOn() &&
    !onVercel() &&
    configuredUserId().length > 0 &&
    !emailLooksValid(configuredEmail())
  ) {
    found.push({
      code: "DEV_OVERRIDE_EMAIL_MISSING_OR_MALFORMED",
      detail:
        "DEV_FEATURE_OVERRIDE_EMAIL is absent or not an email address " +
        `(${JSON.stringify(configuredEmail())}), so the override is DISABLED and grants ` +
        "nothing. It is not the authorisation value -- the user id is -- but it is " +
        "required, because an id with no address beside it leaves nothing recording " +
        "which account it belongs to, and a half-written override should do nothing " +
        "rather than something",
    });
  }

  return found;
}
