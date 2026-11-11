// What production must have configured, checked once when the server starts.
//
// The problem this solves is specific. Every secret-dependent route in this
// application fails CLOSED, which is right: a missing webhook secret is never
// treated as "skip verification". But failing closed is silent from the
// outside. With CLERK_WEBHOOK_SIGNING_SECRET unset, the deletion endpoint
// answers 500 and Clerk retries for days while somebody who asked to be
// deleted still has their financial records in the database -- and nothing
// says so except a line in a log nobody is reading yet.
//
// So the absence is reported at boot instead of at the first delivery.
//
// It logs. It does not throw, and that is deliberate, for the same reason
// lib/prisma.js gives for its row-level-security check: refusing to boot over
// a misconfiguration takes the whole service down for something survivable,
// and the person who needs to know is reading logs rather than a stack trace
// from a dead container. Every route still refuses to do unsafe work on its
// own; this only makes the gap visible earlier.
//
// Names only. No value is read, compared or printed.
//
// It answers a second question too, added after the subscription audit of
// 2026-11-10: not "is this variable set" but "do these variables contradict a
// document users have accepted". See billingPolicyContradictions() below for
// why that check has to live here rather than in a test.

import { TERMS } from "../legal/terms.js";
import { devOverrideProblems } from "../billing/dev-override.js";

// Required wherever real customers are served. Each entry says what stops
// working without it, because "CLERK_WEBHOOK_SIGNING_SECRET is missing" is
// only actionable if you know it means deletions are piling up.
const REQUIRED_IN_PRODUCTION = [
  ["DATABASE_URL", "every request: the application role connection"],
  ["DIRECT_URL", "migrations and the background jobs"],
  ["CLERK_SECRET_KEY", "server-side session verification"],
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "the sign-in and sign-up UI"],
  [
    "CLERK_WEBHOOK_SIGNING_SECRET",
    "account deletion: /api/webhooks/clerk answers 500 and Clerk retries, so a deletion request is never applied",
  ],
  [
    "RESEND_API_KEY",
    "every transactional email: budget alerts, monthly reports, subscription confirmations",
  ],
  [
    "RESEND_WEBHOOK_SECRET",
    "delivery tracking: a bounced subscription confirmation is never recorded",
  ],
  ["INNGEST_SIGNING_KEY", "the background jobs, including recurring transactions"],
  ["ARCJET_KEY", "bot protection and every rate limit"],
  ["SITE_URL", "absolute URLs in emails, the sitemap, and an indexable robots.txt"],
];

// Required only when paid plans are actually on sale. Listing these
// unconditionally would cry wolf on a deployment that does not sell anything.
const REQUIRED_WHEN_SELLING = [
  ["RAZORPAY_KEY_ID", "creating a subscription"],
  ["RAZORPAY_KEY_SECRET", "creating a subscription"],
  ["NEXT_PUBLIC_RAZORPAY_KEY_ID", "opening the checkout"],
  [
    "RAZORPAY_WEBHOOK_SECRET",
    "every subscription event: /api/webhooks/razorpay answers 500 and Razorpay retries, so renewals and cancellations are never applied",
  ],
];

const absent = (name) => {
  const value = process.env[name];
  return typeof value !== "string" || value.trim() === "";
};

/**
 * The missing variables, with what each one costs. Pure, so it can be tested
 * without a server.
 *
 * @param {{ selling?: boolean }} options
 * @returns {Array<{ name: string, cost: string }>}
 */
export function missingProductionConfig({ selling = false } = {}) {
  const required = selling
    ? [...REQUIRED_IN_PRODUCTION, ...REQUIRED_WHEN_SELLING]
    : REQUIRED_IN_PRODUCTION;

  return required
    .filter(([name]) => absent(name))
    .map(([name, cost]) => ({ name, cost }));
}

// --- Does the configuration contradict the Terms? --------------------------
//
// A different class of fault from a missing variable, and a worse one. The
// variables below are all SET to valid values; the problem is what they say
// when read together with lib/legal/terms.js.
//
// WHY THIS IS A BOOT CHECK AND NOT A TEST
//
// tests/legal-consistency.test.js already holds tripwires for exactly these
// pairs, and they are good ones -- but each is guarded on the variable being
// DEFINED, because a test run genuinely cannot know how production is
// configured and CI fixtures own no subscriptions. The consequence, found by
// the subscription audit: an UNSET variable skips the assertion, and unset is
// precisely the state that makes the Terms false. A test cannot close that
// gap, because a test never runs in the deployment whose environment is the
// thing in question. This does.
//
// It logs rather than throwing, for the reason the top of this file gives: the
// product is wrong about itself, which is serious, but taking the service down
// does not make the document true and loses the one place the cause is
// written down.
const enforcing = () =>
  String(process.env.BILLING_ENFORCEMENT ?? "").toLowerCase() === "on";

const capping = () =>
  String(process.env.BILLING_QUOTA_ENFORCEMENT ?? "").toLowerCase() === "on";

const selling = () =>
  String(process.env.BILLING_PLANS_ON_SALE ?? "").toLowerCase() === "on";

/**
 * Where this deployment's billing configuration and its published Terms
 * disagree. Pure, so it can be tested without a server.
 *
 * `terms` is injectable so the tests can exercise both document states
 * whichever one currently ships. Without that, flipping the Terms silently
 * stops the suite from covering the dangerous direction -- which is how the
 * 2026-11-01 version went nine days asserting a product that did not exist.
 *
 * @param {{ terms?: typeof TERMS }} options
 * @returns {Array<{ code: string, detail: string }>}
 */
export function billingPolicyContradictions({ terms = TERMS } = {}) {
  const found = [];

  // The audit's S1. Section 6 of the Terms, version-bumped on 2026-11-01 to
  // announce it, states that the difference between the plans "is now applied
  // to your account". With enforcement off, requireEntitlement() logs and
  // returns, so it is not applied to anybody and that sentence is false in a
  // document people have accepted.
  if (terms.paidPlansAvailable && !enforcing()) {
    found.push({
      code: "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF",
      detail:
        "the Terms say paid plans are enforced, but BILLING_ENFORCEMENT is not " +
        '"on" -- every paid feature is available to every account, so section 6 ' +
        "is a false statement in a document users have accepted. Either set the " +
        "variable, or rewrite section 6 and bump LEGAL_VERSIONS.TERMS",
    });
  }

  // The same fault pointing the other way, and the one the existing tripwire
  // was written for first.
  if (terms.checkoutIntegratedButSellsNothing && enforcing()) {
    found.push({
      code: "TERMS_CLAIM_NOTHING_IS_SOLD_WHILE_ENFORCING",
      detail:
        "the Terms say paying unlocks nothing, but BILLING_ENFORCEMENT is on -- " +
        "rewrite section 6, set checkoutIntegratedButSellsNothing to false, and " +
        "bump LEGAL_VERSIONS.TERMS",
    });
  }

  // The daily cap. The Terms are deliberately silent about it, so applying it
  // withholds something from people who were never told it could be.
  if (capping() && !terms.perDayTransactionLimitEnforced) {
    found.push({
      code: "DAILY_CAP_APPLIED_BUT_TERMS_ARE_SILENT",
      detail:
        "BILLING_QUOTA_ENFORCEMENT is on while the Terms record the per-day " +
        "transaction cap as unenforced and say nothing about a daily limit -- " +
        "rewrite section 6, bump the version, give notice, then set " +
        "perDayTransactionLimitEnforced to true",
    });
  }

  // The audit's S2. Not a Terms contradiction but the same shape of fault.
  //
  // Narrowed 2026-11-10. Selling while nothing is enforced is only a FAULT
  // while the document denies it; once section 6 says plainly that paying
  // unlocks nothing, it is a disclosed commercial decision, and the operator
  // has taken it deliberately. Reporting it every boot regardless would train
  // whoever reads these logs to ignore them, which costs more than the line is
  // worth -- the state this check exists to catch is an UNDISCLOSED one.
  //
  // So it fires only when the Terms do not own it. With
  // checkoutIntegratedButSellsNothing true, the first check above is already
  // the one that speaks if enforcement is ever switched on without the
  // document following.
  if (selling() && !enforcing() && !terms.checkoutIntegratedButSellsNothing) {
    found.push({
      code: "SELLING_WHAT_IS_ALREADY_FREE",
      detail:
        "BILLING_PLANS_ON_SALE is on while BILLING_ENFORCEMENT is not, and the " +
        "Terms do not say that paying unlocks nothing -- the checkout takes " +
        "real money for capabilities every account already has, undisclosed. " +
        "Either enforce, stop selling, or set " +
        "checkoutIntegratedButSellsNothing and say so in section 6",
    });
  }

  return found;
}

let reported = false;

/**
 * Reports what is missing and what contradicts the Terms, once per process, in
 * production only.
 *
 * Outside production this says nothing: a developer without a Razorpay webhook
 * secret is not misconfigured, they are just not testing billing today.
 */
export function reportMissingProductionConfig() {
  if (reported) return [];
  reported = true;

  if (process.env.NODE_ENV !== "production") return [];

  const missing = missingProductionConfig({ selling: selling() });

  if (missing.length > 0) {
    console.error(
      `CONFIGURATION INCOMPLETE. ${missing.length} required variable(s) are not set in this production deployment. ` +
        "Each one fails closed, so nothing is insecure -- but each one is silently not working:\n" +
        missing.map(({ name, cost }) => `  - ${name}: ${cost}`).join("\n")
    );
  }

  // Reported separately, and after, because it is a different kind of problem:
  // nothing here is unset, and nothing fails closed. The product is simply
  // not what its own Terms say it is.
  const contradictions = billingPolicyContradictions();
  if (contradictions.length > 0) {
    console.error(
      `BILLING POLICY CONTRADICTS THE PUBLISHED TERMS. ${contradictions.length} problem(s). ` +
        "These variables are all set to valid values; the fault is what they mean together:\n" +
        contradictions.map(({ code, detail }) => `  - ${code}: ${detail}`).join("\n")
    );
  }

  return missing;
}

let devOverrideReported = false;

/**
 * Reports anything wrong with the development entitlement override, once per
 * process, in every environment.
 *
 * Its own function rather than a branch inside the one above, because that one
 * returns early outside production and this check is needed in both
 * directions. The override is USED in development, where a configuration that
 * silently does nothing is the likeliest fault and the hardest to spot -- you
 * simply go on seeing padlocks and conclude the feature is broken. And it must
 * be reported in production too, where the variable has no business existing:
 * it cannot grant anything there, but its presence in a deployment's
 * environment is something whoever reads these logs should be told about
 * rather than left to find.
 *
 * Logs, like everything else here. Nothing in devOverrideProblems() can grant
 * access, so there is nothing to fail closed about and no reason to refuse to
 * boot.
 *
 * @returns {Array<{ code: string, detail: string }>}
 */
export function reportDevOverrideState() {
  if (devOverrideReported) return [];
  devOverrideReported = true;

  const problems = devOverrideProblems();
  if (problems.length > 0) {
    console.error(
      `DEVELOPMENT FEATURE OVERRIDE IS MISCONFIGURED. ${problems.length} problem(s). ` +
        "None of these grants anybody access -- the override refuses every Vercel " +
        "environment and matches only one configured user id -- but each one means the " +
        "configuration does not do what whoever wrote it intended:\n" +
        problems.map(({ code, detail }) => `  - ${code}: ${detail}`).join("\n")
    );
  }

  return problems;
}
