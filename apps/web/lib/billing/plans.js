// What WHealthOS sells, resolved on the server.
//
// The browser asks for a plan by its internal id -- "pro", "intelligent" --
// and a billing interval. Everything with a commercial consequence is looked
// up here: the price, the currency, and the provider's plan id. None of it is
// ever read from a request body. The same rule the rest of this codebase
// applies to identity applies to money.

import { BILLING_PERIODS, FEATURE_GROUPS, PLANS, YEARLY_DISCOUNT } from "@/data/pricing";

export const FREE_PLAN_ID = "free";

// Razorpay works in the currency's smallest unit.
export const PAISE_PER_RUPEE = 100;
export const CURRENCY = "INR";

const MONTHS = 12;

export const INTERVALS = BILLING_PERIODS.map((period) => period.id);

// "monthly" -> MONTHLY, for the BillingInterval column.
export const intervalEnum = (interval) => String(interval).toUpperCase();

// The paid tiers, in ascending order. Free is in the catalogue because the
// pricing table compares against it; it is not sold, and asking to buy it is
// a bad request rather than a zero-rupee subscription.
export const paidPlans = () => PLANS.filter((plan) => plan.monthly > 0);

export const paidPlanIds = () => paidPlans().map((plan) => plan.id);

export const planById = (id) => paidPlans().find((plan) => plan.id === id) ?? null;

// Rank, for deciding whether a change is an upgrade or a downgrade. Free is 0.
export const rankOf = (planId) => {
  if (planId === FREE_PLAN_ID) return 0;
  const index = paidPlanIds().indexOf(planId);
  return index === -1 ? -1 : index + 1;
};

// What a plan costs for an interval, in rupees.
//
// The same arithmetic as priceFor() in the pricing page's component, because
// somebody shown ₹3,830 has to be charged ₹3,830. The two cannot share an
// implementation -- that one is a "use client" module, and importing it here
// would hand the server a client reference instead of a function -- so
// tests/billing-plans.test.js asserts they agree for every plan and interval.
export const rupeesFor = (plan, interval) => {
  if (!plan) return null;
  if (interval === "monthly") return plan.monthly;
  if (interval === "yearly") return Math.round(plan.monthly * MONTHS * (1 - YEARLY_DISCOUNT));
  return null;
};

export const amountPaiseFor = (planId, interval) => {
  const rupees = rupeesFor(planById(planId), interval);
  if (rupees === null || !Number.isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * PAISE_PER_RUPEE);
};

// The provider's plan id for one of ours.
//
// Razorpay subscriptions bill against a Plan created in their Dashboard, and
// its id cannot be derived, guessed or created from here safely -- the amount
// and interval live on THEIR object, so a wrong id charges the wrong price.
// Each one is therefore configuration, named after the plan and interval it
// belongs to, and a missing one makes that plan unbuyable rather than
// silently billable at someone else's rate.
//
//   RAZORPAY_PLAN_PRO_MONTHLY
//   RAZORPAY_PLAN_PRO_YEARLY
//   RAZORPAY_PLAN_INTELLIGENT_MONTHLY
//   RAZORPAY_PLAN_INTELLIGENT_YEARLY
export const providerPlanEnvName = (planId, interval) =>
  `RAZORPAY_PLAN_${String(planId).toUpperCase()}_${String(interval).toUpperCase()}`;

export const providerPlanId = (planId, interval) =>
  process.env[providerPlanEnvName(planId, interval)] || null;

// The other direction: Razorpay's plan id back to ours.
//
// Needed because a plan CHANGE is the one operation whose outcome arrives from
// the provider rather than from a checkout attempt. Everywhere else our planId
// comes from the attempt we wrote before calling Razorpay, so there was never
// anything to resolve backwards. When a subscription's plan changes at cycle
// end, the only thing that says which plan it is now is the plan id on
// Razorpay's own subscription object -- and syncFromProvider has to turn that
// back into "pro" or "intelligent" before entitlements can follow it.
//
// Built by scanning the same four environment variables providerPlanId reads,
// so the two cannot disagree: there is one mapping, used in both directions.
//
// Returns null for anything unrecognised, and the caller must treat that as
// "leave the row alone" rather than as a reason to guess. An unknown provider
// plan id is the same class of problem as an unknown provider status, and
// normaliseStatus() already establishes the rule: a state we cannot read is
// not a reason to assume the best. In practice it means the merchant account
// has a Plan this deployment is not configured for -- a second environment
// sharing the dashboard, or a plan created by hand -- and writing a guessed
// planId would change what somebody is entitled to.
export function planFromProviderPlanId(value) {
  if (typeof value !== "string" || value === "") return null;

  for (const planId of paidPlanIds()) {
    for (const interval of INTERVALS) {
      if (providerPlanId(planId, interval) === value) {
        return { planId, interval, intervalEnum: intervalEnum(interval) };
      }
    }
  }

  return null;
}

// Whether a plan and interval can be bought right now: ours to sell, priced,
// and mapped to a provider plan.
export const isPurchasable = (planId, interval) =>
  Boolean(
    planById(planId) &&
      INTERVALS.includes(interval) &&
      amountPaiseFor(planId, interval) !== null &&
      providerPlanId(planId, interval)
  );

// Everything the checkout service needs, or null if this is not something we
// sell. One lookup, so no caller assembles a price from parts.
export const resolvePurchase = (planId, interval) => {
  if (!planById(planId) || !INTERVALS.includes(interval)) return null;

  const amount = amountPaiseFor(planId, interval);
  const provider = providerPlanId(planId, interval);
  if (amount === null || !provider) return null;

  return {
    planId,
    interval,
    intervalEnum: intervalEnum(interval),
    amount,
    currency: CURRENCY,
    providerPlanId: provider,
  };
};

// How many billing cycles a subscription is created for.
//
// Razorpay requires total_count on a subscription. There is no "until
// cancelled" option, so this is the horizon after which it completes on its
// own and the person resubscribes. Ten years either way: long enough that
// nobody reaches it in practice, short enough to be a real number rather than
// a pretence that the agreement is perpetual.
export const totalCountFor = (interval) => (interval === "yearly" ? 10 : 120);

// --- The catalogue entry the checkout page renders --------------------------
//
// One lookup returning everything a review screen needs, so no component
// assembles a price from parts and no two screens can disagree about what
// something costs.
//
// Split in two deliberately. catalogEntry() is the server's view and carries
// the Razorpay plan id; displayEntry() is what may cross into the browser and
// does not. The provider plan id is not a secret in the way the key secret is,
// but it is configuration about this merchant account that no visitor needs,
// and the easiest way to never leak it is to have a function whose job is to
// drop it.

// What WHealthOS adds to the amount shown. Nothing, today.
//
// Written down rather than assumed: the Razorpay Plan is created at the rupee
// figure in data/pricing.js, so that figure is the whole of what is charged.
// If a tax line is ever introduced it belongs here, where the review page and
// the order summary both read it, instead of being typed into a paragraph.
export const TAX_POLICY = {
  // No separate tax is calculated or added by this application.
  inclusive: true,
  note: "This is the full amount Razorpay will charge. WHealthOS adds nothing to it.",
};

export const intervalLabel = (interval) =>
  interval === "yearly" ? "Yearly" : interval === "monthly" ? "Monthly" : null;

export const renewalLabel = (interval) =>
  interval === "yearly" ? "every 12 months" : interval === "monthly" ? "every month" : null;

// What a yearly subscription saves against paying monthly for a year, in
// rupees. Null when there is nothing to compare.
export const yearlySavingRupees = (planId) => {
  const plan = planById(planId);
  if (!plan) return null;
  const monthly = rupeesFor(plan, "monthly");
  const yearly = rupeesFor(plan, "yearly");
  if (monthly === null || yearly === null) return null;
  const saving = monthly * MONTHS - yearly;
  return saving > 0 ? saving : null;
};

// The features a plan includes, from the same table the pricing page renders.
//
// Grouped into what this tier adds and what it inherits, because a review
// screen listing all twenty features equally tells somebody nothing about
// what they are actually buying. Inheritance is read from the feature matrix
// rather than restated: a feature belongs to the plans listed against it, and
// lib/billing/entitlements.js authorises from the same data.
export function planFeatures(planId) {
  const rank = rankOf(planId);
  if (rank <= 0) return { added: [], inherited: [] };

  const lowerIds = PLANS.filter((plan) => rankOf(plan.id) < rank).map((plan) => plan.id);

  const added = [];
  const inherited = [];

  for (const group of FEATURE_GROUPS) {
    for (const feature of group.features) {
      if (!feature.plans.includes(planId)) continue;
      const alsoBelow = lowerIds.some((id) => feature.plans.includes(id));
      (alsoBelow ? inherited : added).push({
        key: feature.key,
        label: feature.label,
        hint: feature.hint ?? null,
        group: group.title,
      });
    }
  }

  return { added, inherited };
}

// Everything about one purchasable plan-and-interval, resolved on the server.
//
// Returns null when the pair is not something this application sells at all
// -- an unknown plan, a bad interval, a tier with no price. A pair that IS
// sold but has no Razorpay Plan configured returns an entry with
// enabledForSale: false, because the difference matters to the page: the
// first is a bad URL, the second is a deployment that is not finished.
export function catalogEntry(planId, interval) {
  const plan = planById(planId);
  if (!plan || !INTERVALS.includes(interval)) return null;

  const amountPaise = amountPaiseFor(planId, interval);
  if (amountPaise === null) return null;

  const provider = providerPlanId(planId, interval);

  return {
    planId: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    interval,
    intervalEnum: intervalEnum(interval),
    intervalLabel: intervalLabel(interval),
    renewal: renewalLabel(interval),
    currency: CURRENCY,
    amountPaise,
    amountRupees: amountPaise / PAISE_PER_RUPEE,
    savingRupees: interval === "yearly" ? yearlySavingRupees(planId) : null,
    transactionLimit: plan.limit,
    features: planFeatures(planId),
    tax: TAX_POLICY,
    totalCount: totalCountFor(interval),
    // The provider plan id, and whether there is one. Server-side only.
    providerPlanId: provider,
    enabledForSale: Boolean(provider),
  };
}

// The same entry with everything the browser has no business holding removed.
export function displayEntry(entry) {
  if (!entry) return null;
  const { providerPlanId: _provider, ...rest } = entry;
  return rest;
}
