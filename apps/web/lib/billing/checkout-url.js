// The URL that names a plan somebody wants to buy.
//
//   /billing?plan=pro&duration=monthly
//
// `duration` rather than `interval` because that is what the address bar
// says; `interval` is the internal word, matching Razorpay's own vocabulary
// and the BillingInterval column. The two are mapped here, at the boundary,
// and nowhere else.
//
// The URL is a request, never an authorisation. It names a plan, the server
// prices it, and a hand-edited one buys nothing it should not: /billing
// resolves the pair against the catalogue again on every render, and
// POST /api/billing/checkout resolves it a third time before any money is
// involved. Nothing downstream reads an amount, a currency or a Razorpay plan
// id from a query string.

import { INTERVALS, paidPlanIds } from "./plans";

// Where a plan is reviewed and paid for.
export const CHECKOUT_PATH = "/billing";

// Where plans are compared. The pricing page links into CHECKOUT_PATH; it no
// longer opens a payment window of its own.
export const PRICING_PATH = "/pricing";

export const isPaidPlanId = (value) => paidPlanIds().includes(value);
export const isDuration = (value) => INTERVALS.includes(value);

// Reads a plan and duration out of search params, keeping only what the
// catalogue recognises.
//
// Anything else is dropped rather than corrected, so a nonsense link reaches
// the page as null and is answered with "choose a plan" instead of a guess at
// what somebody meant to buy. A repeated parameter arrives from Next as an
// array, which is not a plan id and is therefore dropped by the same rule --
// ?plan=pro&plan=intelligent asks two questions and gets neither answered.
export const readCheckoutParams = (params = {}) => {
  const plan = typeof params.plan === "string" ? params.plan : null;
  const duration = typeof params.duration === "string" ? params.duration : null;

  return {
    plan: isPaidPlanId(plan) ? plan : null,
    duration: isDuration(duration) ? duration : null,
    // Whether something was asked for that the catalogue does not recognise,
    // as opposed to nothing being asked for at all. The page says different
    // things in the two cases: one is a broken link, the other is an ordinary
    // visit to /billing.
    invalid: Boolean(
      (params.plan !== undefined && !isPaidPlanId(plan)) ||
        (params.duration !== undefined && !isDuration(duration))
    ),
  };
};

export const checkoutUrl = (planId, duration) =>
  `${CHECKOUT_PATH}?plan=${encodeURIComponent(planId)}&duration=${encodeURIComponent(duration)}`;

export const pricingUrl = (planId, duration) =>
  `${PRICING_PATH}?plan=${encodeURIComponent(planId)}&duration=${encodeURIComponent(duration)}`;
