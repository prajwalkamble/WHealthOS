// What a plan lets someone do, and who decides.
//
// This module is the only answer to "may this account do X". It is
// deliberately free of any payment-provider vocabulary: it takes a plan id
// and returns capabilities. Swapping Razorpay for another gateway should not
// require reading this file, which is why the gateway lives in lib/payments/
// and the subscription state machine in lib/billing/status.js.
//
// Tiers are cumulative. Pro is Free plus Pro; Intelligent is Free plus Pro
// plus Intelligent. That is derived from data/pricing.js rather than written
// out, because the published table is what people are sold.

import { FEATURE_GROUPS, PLANS } from "@/data/pricing";
import { FREE_PLAN_ID, paidPlanIds, rankOf } from "./plans";

// Every feature in the published matrix, as { key, plans }.
const FEATURES = FEATURE_GROUPS.flatMap((group) => group.features);

export const ENTITLEMENT_KEYS = FEATURES.map((feature) => feature.key);

// plan id -> Set of keys that plan includes, straight from the table.
const BY_PLAN = new Map(
  PLANS.map((plan) => [
    plan.id,
    new Set(
      FEATURES.filter((feature) => feature.plans.includes(plan.id)).map((f) => f.key)
    ),
  ])
);

// The capabilities of a plan.
//
// Cumulative by construction: the published table already lists a Free
// feature against Pro and Intelligent, so a union over every plan at or below
// this one is both the inheritance rule and a check on the table. If someone
// ever removes a Free feature from the Pro column by mistake, the union still
// grants it -- which is the behaviour the pricing page promises.
export const entitlementsFor = (planId) => {
  const rank = rankOf(planId);
  if (rank < 0) return new Set();

  const granted = new Set();
  for (const plan of PLANS) {
    if (rankOf(plan.id) <= rank) {
      for (const key of BY_PLAN.get(plan.id) ?? []) granted.add(key);
    }
  }
  return granted;
};

export const planGrants = (planId, key) => entitlementsFor(planId).has(key);

// Whether enforcement is live.
//
// Off by default, and that default is a decision rather than an oversight.
// Turning this on with no subscription rows in the database immediately
// removes Budgets, Goals, Analytics, export and every AI feature from every
// existing account, because none of them has ever paid for anything. That is
// a commercial decision for the operator to make deliberately, on a date they
// choose -- not something that should happen because a billing branch merged.
//
// While it is off, every check still runs and every denial is logged, so the
// gaps are visible before they are enforced. The same shape as Arcjet's
// detectBot DRY_RUN in middleware.js.
export const enforcementEnabled = () =>
  String(process.env.BILLING_ENFORCEMENT ?? "").toLowerCase() === "on";

// Thrown when a plan does not include what was asked for. Carries the key so
// a route can name the upgrade without re-deriving it.
export class EntitlementError extends Error {
  constructor(key, planId) {
    super("Your plan does not include this feature.");
    this.name = "EntitlementError";
    this.code = "FORBIDDEN";
    this.status = 403;
    this.entitlement = key;
    this.planId = planId;
  }
}

// The gate. Throws EntitlementError when the plan does not grant `key`.
//
// `planId` must come from a verified subscription -- see lib/billing/service.js
// -- never from a request body, a cookie, a header or anything the browser can
// set. An unknown plan grants nothing: rankOf returns -1 and the set is empty.
//
// `grantAll` is the development-only override in lib/billing/dev-override.js,
// and it is the CALLER that decides it, not this file. This module is a pure
// function of a plan id and a key -- it reads no environment and is handed no
// user -- which is what lets it be tested without a database, and that is
// worth more than saving a parameter at the one call site that needs it
// (lib/billing/guard.js).
export function requireEntitlement(planId, key, { grantAll = false } = {}) {
  if (!ENTITLEMENT_KEYS.includes(key)) {
    // A typo in a key would otherwise fail open: an unknown key is in no
    // plan's set, so every plan would be denied -- or, worse, a later
    // "default allow" would let everyone through. Loud and immediate.
    throw new Error(`Unknown entitlement key: ${key}`);
  }

  // Deliberately after the check above, so a misspelled key still fails loud
  // for the overridden account. That account is the one doing the testing, and
  // therefore the likeliest to reach a new key first; letting it through a
  // typo would hide the fault exactly where it would otherwise be caught.
  if (grantAll) return;

  if (planGrants(planId, key)) return;

  if (!enforcementEnabled()) {
    console.warn({
      code: "ENTITLEMENT_WOULD_DENY",
      details: { entitlement: key, planId: planId ?? FREE_PLAN_ID },
    });
    return;
  }

  throw new EntitlementError(key, planId ?? FREE_PLAN_ID);
}

// For the browser: what to lock and what to offer, without the browser being
// trusted to act on it. Everything here is advisory; the server checks again.
//
// Under the development override the capability list is every key, while
// `planId` keeps reporting the real plan and `devAccess` says why the two do
// not agree. Three separate facts, none of them dressed up as another: the
// alternative -- reporting a plan the account has not got -- is what Settings
// would then display back as a subscription.
export const entitlementSummary = (planId, { grantAll = false } = {}) => ({
  planId: planId ?? FREE_PLAN_ID,
  entitlements: grantAll
    ? [...ENTITLEMENT_KEYS]
    : [...entitlementsFor(planId ?? FREE_PLAN_ID)],
  enforced: enforcementEnabled(),
  ...(grantAll ? { devAccess: true } : {}),
});

// The cheapest plan that includes a feature, for an upgrade prompt.
export const smallestPlanWith = (key) => {
  const candidates = [FREE_PLAN_ID, ...paidPlanIds()];
  return candidates.find((planId) => planGrants(planId, key)) ?? null;
};
