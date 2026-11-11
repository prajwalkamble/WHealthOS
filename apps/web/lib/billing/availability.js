// Whether this deployment can actually take a payment, and if not, what is
// missing.
//
// One answer, computed on the server, used by every surface that offers to
// sell something. Before this existed the pricing page offered a live-looking
// button while the Settings card hid itself, and both decided for themselves
// -- so the same deployment said two different things, and the button that
// could never work was the louder of the two.
//
// The failure this is really about: a dead click that reports "Payments are
// not available just now." That sentence is true, useless, and identical for
// five different causes. An operator reading it learns nothing, and a visitor
// has no idea whether to try again.

import { keyId, keySecret, publicKeyId, publicKeyMatches } from "@/lib/payments/config";
import { INTERVALS, paidPlanIds, providerPlanEnvName, providerPlanId } from "./plans";

const inDevelopment = () => process.env.NODE_ENV !== "production";

// Whether paid plans are offered at all.
//
// Separate from everything else in this file, and asked first. The rest of
// this module answers "could this deployment take a payment" -- credentials,
// plan ids, configuration. This answers "should it", which is a product
// decision and not a configuration one, and the two are not the same
// question: a perfectly configured gateway must still sell nothing while the
// plans are discontinued.
//
// This was switched off for a while, and the reasoning is worth keeping
// because it is the reasoning that still governs the flag: a checkout left
// reachable while entitlements are unenforced charges somebody for what their
// neighbour has for free -- which the Terms then oblige us to refund, so the
// only thing it can produce is a refund and a complaint.
//
// Updated 2026-11-10. This comment used to open "Off, because every feature is
// free to every account" and go on to say that the Terms had always said
// paying unlocks nothing. All three parts had gone stale: the flag is set in
// the environment, /pricing renders the paid comparison, and section 6 of the
// Terms was rewritten on 2026-11-01 to announce enforcement. A comment that
// states a deployment's configuration as fact is a comment that will be wrong
// eventually, so this one no longer does -- plansAreOnSale() below is the
// answer.
//
// The pairing is the thing to get right, and it is not enforced here: selling
// while BILLING_ENFORCEMENT is unset is the state the audit found, and
// billingPolicyContradictions() in lib/security/required-config.js is what
// reports it at boot in production.
//
// Nothing was deleted when it was off. The catalogue, the checkout, the
// webhook and the entitlement keys stayed intact, which is why setting
// BILLING_PLANS_ON_SALE back to "on" was all it took. That is deliberate -- a
// decision you can reverse is a different thing from a feature you have to
// rebuild.
export const plansAreOnSale = () =>
  String(process.env.BILLING_PLANS_ON_SALE ?? "").toLowerCase() === "on";

// The gateway credentials, independent of any particular plan.
function gatewayState() {
  const missing = [];
  if (!keyId()) missing.push("RAZORPAY_KEY_ID");
  if (!keySecret()) missing.push("RAZORPAY_KEY_SECRET");
  if (!publicKeyId()) missing.push("NEXT_PUBLIC_RAZORPAY_KEY_ID");

  // A mismatch is its own fault, and a worse one: both variables are set, so
  // everything looks configured, and Razorpay rejects the subscription with a
  // message about the payment rather than about the configuration.
  const mismatched = missing.length === 0 && !publicKeyMatches();

  return { ready: missing.length === 0 && !mismatched, missing, mismatched };
}

// Which plan-and-interval pairs have a Razorpay Plan behind them.
function planState() {
  const available = {};
  const missing = [];

  for (const planId of paidPlanIds()) {
    for (const interval of INTERVALS) {
      const configured = Boolean(providerPlanId(planId, interval));
      available[`${planId}:${interval}`] = configured;
      if (!configured) missing.push(providerPlanEnvName(planId, interval));
    }
  }

  return { available, missing };
}

// The whole picture, for the server.
export function checkoutAvailability() {
  const gateway = gatewayState();
  const plans = planState();

  return {
    ready: gateway.ready,
    mismatched: gateway.mismatched,
    missing: [...gateway.missing, ...plans.missing],
    plans: plans.available,
    anyPlanSellable:
      gateway.ready && Object.values(plans.available).some(Boolean),
  };
}

// What may be handed to the browser.
//
// Variable NAMES are not secrets -- they are in .env.example, which is in
// version control -- but there is no reason to narrate this deployment's
// configuration to every visitor either. So: the booleans always, the names
// only in development, where the person reading them is the person who has to
// fix them.
export function publicAvailability() {
  const state = checkoutAvailability();

  return {
    ready: state.ready,
    plans: state.plans,
    // Named `developmentHint` rather than `missing` so nobody is tempted to
    // render it without noticing it is only ever populated outside production.
    developmentHint: inDevelopment() && state.missing.length > 0
      ? `Not configured: ${state.missing.join(", ")}`
      : state.mismatched && inDevelopment()
        ? "NEXT_PUBLIC_RAZORPAY_KEY_ID does not match RAZORPAY_KEY_ID"
        : null,
  };
}

// Whether one specific plan and interval can be bought right now.
export const canSell = (availability, planId, interval) =>
  Boolean(availability?.ready && availability.plans?.[`${planId}:${interval}`]);

// A single line for the server log, written once where the refusal happens so
// the cause is in the logs even when the visitor only sees a generic message.
export function describeUnavailability() {
  const state = checkoutAvailability();
  if (state.mismatched) return "NEXT_PUBLIC_RAZORPAY_KEY_ID does not match RAZORPAY_KEY_ID";
  if (state.missing.length > 0) return `missing: ${state.missing.join(", ")}`;
  return "configured";
}
