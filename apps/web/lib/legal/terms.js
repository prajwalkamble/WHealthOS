// Facts the Terms are built from.
//
// Same rule as lib/legal/policy.js: everything here is either VERIFIED from the
// codebase or marked as needing a decision. A contract that describes a product
// which does not exist is worse than no contract -- it promises things nobody
// built and binds users to terms about them.

import { pendingDecision } from "./pending";
import { LEGAL_VERSIONS } from "./versions";

export const TERMS = {
  // Shown on the page and written into every consent record, from the one
  // place either is allowed to come from.
  version: LEGAL_VERSIONS.TERMS,

  // --- Commercial position, verified -------------------------------------
  //
  // data/pricing.js advertises Free (₹0), Pro (₹399/mo) and Intelligent
  // (₹699/mo). The three marketing CTAs still link to /sign-up.
  //
  // Changed 2026-10-23. A Razorpay Standard Checkout was integrated
  // (lib/payments/, app/api/payments/razorpay/, and a Plan card in Settings),
  // so the previous statement -- "there is no payment processor anywhere in
  // the codebase" -- is no longer true and the Terms could not go on saying
  // it.
  //
  // What did NOT change, and this is the part the document has to be careful
  // about: the advertised per-day transaction limits and feature tiers are
  // still not applied to anybody -- the only limit is Arcjet's, which is the
  // same for everyone. So a payment can be taken and it buys no feature.
  //
  // What DID change again, on 2026-10-25: it now buys a subscription. A
  // checkout creates a Razorpay subscription, a row in `subscriptions`, and a
  // recurring charge that renews until it is cancelled. The earlier wording --
  // "creates no subscription" -- became false the moment that landed, so
  // section 6 was rewritten to describe renewal, cancellation and the absence
  // of proration, which are now real terms about a real agreement.
  //
  // Both corrections sit inside the SAME unpublished version string. 2026-10-23
  // was bumped in the working tree and has never been deployed or accepted by
  // anybody, so there is no consent record naming the text being replaced. The
  // moment it ships, a further change needs a further bump.
  //
  // That in-between state is worse to be vague about than either end of it,
  // so it is recorded as its own fact rather than folded into the first one.
  // paidPlansAvailable stays false because it answers "can someone obtain a
  // paid plan", and they cannot.
  //
  // The checkout is also invisible unless the deployment sets Razorpay
  // credentials (app/(main)/settings/page.jsx), and the card carries a notice
  // saying plans are not switched over. Renewal, proration and cancellation
  // clauses are still absent, because there is still no subscription to
  // renew, prorate or cancel.
  //
  // Updated 2026-10-23 (later the same day). Entitlements now exist: there is
  // a plan on every subscription, a check on every paid route, and a tier
  // ladder derived from the pricing table. Whether those checks REFUSE
  // anything is a single environment variable, BILLING_ENFORCEMENT, and it is
  // off -- so the statement below is still true of the running product.
  //
  // The day it is switched on, section 6 of the Terms becomes false and must
  // be rewritten with a version bump. That is not left to memory:
  // tests/legal-consistency.test.js fails the build if enforcement is on
  // while checkoutIntegratedButSellsNothing is still true.
  // Changed 2026-11-01, with a version bump, on the understanding that
  // BILLING_ENFORCEMENT was on: requireEntitlement() would refuse, so a plan
  // would be the difference between having Budgets, Goals, Analytics, export
  // and the AI features and not having them. Both flags below were flipped and
  // section 6 was rewritten in the same change.
  //
  // That 2026-11-01 premise was wrong, and for nine days these flags described
  // a product that did not exist. BILLING_ENFORCEMENT was never set in any
  // environment anybody checked, so requireEntitlement() logged
  // ENTITLEMENT_WOULD_DENY and returned, and every paid feature remained open
  // to every account -- the exact failure the top of this file warns about.
  // The subscription audit in docs/testing/ found it on 2026-11-10.
  //
  // RESOLVED 2026-11-10 by setting the variable rather than by withdrawing the
  // claim: BILLING_ENFORCEMENT is now "on", so both flags below are true of
  // the running product for the first time, and section 6 carries today's
  // version. A draft that went the other way -- keeping enforcement off and
  // retracting the claim -- was written and not shipped.
  //
  // The lesson is unchanged by which resolution was chosen, and is the part
  // that will matter next time: these values describe the RUNNING product, not
  // an intention about it. The only honest source for "is enforcement on" is
  // the environment the code reads, enforcementEnabled() in
  // lib/billing/entitlements.js, and a flag set here in anticipation of a
  // deployment is a false statement in a contract until that deployment
  // happens. What now notices the gap is billingPolicyContradictions() in
  // lib/security/required-config.js, at boot, in the deployment itself.
  //
  // Answers "can somebody obtain a paid plan", meaning the capability set the
  // pricing page attaches to one. They can: a subscription is real, recurring,
  // and now the difference between having Budgets, Goals, Analytics, export
  // and the AI features and not having them.
  paidPlansAvailable: true,
  paymentProcessor: "Razorpay",
  // Answers "does paying buy an entitlement". It does, as of 2026-11-10. The
  // name is read literally by tests/legal-consistency.test.js, which fails the
  // build if this is true while BILLING_ENFORCEMENT is on -- so if enforcement
  // is ever switched back off, this must become true again and section 6 must
  // be rewritten with it. The complementary check, for a document claiming
  // enforcement while the variable is unset (the state this file spent nine
  // days in), is billingPolicyContradictions() in
  // lib/security/required-config.js, which reports at boot in production
  // because no test can see a deployment's environment.
  checkoutIntegratedButSellsNothing: false,
  // NOT enforced, and the Terms must not imply otherwise. data/pricing.js
  // advertises a per-day transaction cap per plan ("5 per day", "15 per day")
  // and nothing in the application applies it: USER_TRANSACTION_LIMIT in
  // actions/transaction.js is a flat 500-row query bound, identical for every
  // account. consumeDailyTransaction() counts the day's rows on every create
  // and would refuse past the allowance, but BILLING_QUOTA_ENFORCEMENT is a
  // separate switch and it is still off, so a breach logs QUOTA_WOULD_DENY and
  // proceeds. Feature tiers are enforced as of 2026-11-10; this number is
  // not. Section 6 describes the first and is silent on the second.
  perDayTransactionLimitEnforced: false,
  // ...but it does buy a subscription, and that distinction is the whole of
  // what section 6 has to get right. Verified: lib/billing/service.js opens a
  // Razorpay subscription, `subscriptions` records it, and
  // requestCancellation() stops it at the end of the paid period.
  subscriptionsAreReal: true,
  // Verified: lib/payments/razorpay.js changes a plan only with
  // schedule_change_at "cycle_end", and nothing anywhere computes a part
  // period. The Terms therefore promise no proration rather than implying it.
  //
  // Still false as of 2026-11-11, when a one-step UPGRADE was built. That is
  // worth stating because it is the obvious place for this to have become
  // true: a plan change is the operation proration exists for. It did not,
  // and the design is what keeps it false -- the upgrade is applied at the end
  // of the period already paid for, so there is no part period to charge,
  // credit or refund. A DOWNGRADE is the case that would require one, and it
  // is for exactly this reason that none was built. If an immediate upgrade is
  // ever wanted, this flag, section 6 and a published proration policy change
  // together or not at all.
  prorationCalculated: false,
  // Upwards only, from Settings and from /billing, landing at cycle end.
  // Verified: app/api/billing/plan-change/route.js -> requestPlanChange(),
  // which refuses a downgrade and an interval-only change with NOT_AN_UPGRADE.
  // Section 6 must describe this as an upgrade and must not present it as
  // immediate or as symmetrical.
  oneStepUpgrade: true,
  oneStepDowngrade: false,

  // --- Acceptance, verified ----------------------------------------------
  //
  // app/(auth)/welcome/ + actions/legal.js. A new account cannot be created
  // without an explicit, unticked-by-default checkbox; the accepted version
  // strings and the timestamp are written by the server, never by the
  // browser. Accounts that predate the flow have no record and were not
  // backfilled one. So the Terms may describe recorded acceptance for new
  // accounts, and must not claim it for older ones.
  acceptanceRecorded: true,

  // --- Account closure, verified -----------------------------------------
  //
  // There is no in-app "delete my account". Separately, the app shell renders
  // Clerk's <UserButton /> (components/user-avatar.jsx) and this Clerk
  // instance has delete_self enabled, so a person can delete their Clerk
  // account from inside WHealthOS. That used to strand the data: no Clerk
  // event reached us, so the sign-in went and the financial records stayed,
  // belonging to someone who could no longer open them. A webhook now closes
  // that, which means the same click is irreversible rather than incomplete,
  // and both documents have to say so.
  // Still no delete button of our own inside WHealthOS -- but deleting the
  // Clerk account now reaches the data. app/api/webhooks/clerk/route.js
  // handles user.deleted and removes the row, and every child record goes
  // with it through the foreign keys. Added 2026-10-11.
  selfServiceDeletion: false,
  clerkDeletionOrphansData: false,
  clerkDeletionRemovesData: true,

  // --- AI, verified ------------------------------------------------------
  //
  // lib/ai/gemini.js, model gemini-4-argon by default (GEMINI_MODEL
  // overrides it per deployment). Three callers:
  //   actions/transaction.js   -- the uploaded receipt image, on request.
  //   lib/inngest/functions.js -- generateFinancialInsights sends the month's
  //     income, expenses and per-category totals, on a cron, to every user
  //     who has an email address and has not switched the commentary off.
  //     The switch is users.monthlyInsights, added 2026-10-11 and surfaced in
  //     Settings; it defaults to on, so the default behaviour is unchanged.
  //   lib/ai/agent.js          -- WHOS. The question the person typed,
  //     the last few turns of the conversation, and the totals their question
  //     needs, assembled by lib/ai/context.js. Entirely on request: no
  //     schedule, no background call, and nothing persisted. Added
  //     2026-10-19.
  aiProvider: "Google (Gemini)",
  monthlyInsightsAutomatic: true,
  monthlyInsightsCanBeSwitchedOff: true,
  // The assistant needs no switch: it sends nothing unless a question is
  // sent, which is the same reasoning that covers the receipt scanner.
  assistantOnRequestOnly: true,
  assistantConversationsPersisted: false,

  // --- Decisions the operator has taken ----------------------------------
  //
  // Both were open until 2026-10-11, when the operator approved them against a
  // written recommendation. They are recorded here because the reasoning is
  // what makes them defensible later, and because neither is a fact about the
  // code that someone could re-derive by reading it.
  //
  // Governing law: India. The only jurisdiction with a verified connecting
  // factor -- it is where WHealthOS is operated from. Jurisdiction is stated
  // as non-exclusive on purpose. An Indian consumer may file where they live
  // under s.34(2)(d) of the Consumer Protection Act 2019, and consumers in the
  // EU and UK generally keep their home courts, so an exclusive clause would
  // be both unenforceable and a misrepresentation of what we could insist on.
  // No arbitration clause and no class action waiver.
  governingLaw: "India, with non-exclusive jurisdiction",

  // Liability: no monetary cap. WHealthOS is free, so the conventional cap --
  // the fees paid in some preceding period -- evaluates to zero, which is a
  // total exclusion wearing a cap's clothing and is the clause most likely to
  // be struck down as unfair. Non-excludable liability is preserved
  // explicitly. Revisit this if paid plans ever launch: a cap anchored to real
  // fees is a different proposition from one anchored to nothing.
  liabilityPosition: "no monetary cap; non-excludable liability preserved",

  // Still genuinely open. Neither blocks publication of the Terms.
  indemnification: pendingDecision(
    "whether any indemnity is warranted; none is written today"
  ),
};

// What the service actually does today, verified by reading the application.
// Each line is something a user can do right now.
export const FEATURES = [
  "Record accounts, transactions, budgets, goals and cards, and see them totalled and charted",
  "Import transactions from a CSV or XLSX file, and export them as CSV, Excel or PDF",
  "Scan a receipt photo into a draft transaction for you to confirm",
  "Receive a budget alert by email when you set one up, and a monthly summary of your figures",
  "Use the public financial tools without an account",
];
