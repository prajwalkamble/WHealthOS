// Every call this application makes to Razorpay, and the two it makes without
// calling anybody.
//
// This is the gateway layer and nothing else: it speaks Razorpay, it knows no
// product rules, and it decides no entitlement. What a plan lets someone do
// is lib/billing/entitlements.js; what a subscription state means is
// lib/billing/status.js. Keeping the three apart is what makes adding a
// second provider a new file here rather than a rewrite of feature access.
//
// Node only. The SDK is CommonJS and the signature work uses node:crypto, so
// every route importing this sets `runtime = "nodejs"`.
//
// Nothing here is imported from a client component, and nothing here may be:
// the module reads RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.

import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { configured, keyId, keySecret, webhookSecret } from "./config";

// A failure a route handler knows how to turn into a status code. Anything
// thrown from here that is not one of these is unexpected and becomes a 500
// with nothing of its message passed on.
export class PaymentError extends Error {
  constructor(code, message, { status = 500, cause } = {}) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

const notConfigured = () =>
  new PaymentError("NOT_CONFIGURED", "Payments are not available just now.", {
    status: 503,
  });

// One client per process, built on first use rather than at import time: the
// constructor throws when the key id is missing, and a module that throws on
// import takes the route down at build time instead of answering 503.
let client = null;

const api = () => {
  if (!configured()) throw notConfigured();
  client ??= new Razorpay({ key_id: keyId(), key_secret: keySecret() });
  return client;
};

// Visible for tests, which install a fake rather than reaching the network.
export const __setClient = (fake) => {
  client = fake;
};

// Turns an SDK rejection into a PaymentError.
//
// Razorpay rejects with { statusCode, error: { code, description, ... } }. The
// description is written for a developer and can name the merchant account, so
// it is logged and never returned. A 401 from Razorpay means this deployment's
// credentials are wrong, which is an operator problem and worth telling apart
// from a declined payment.
const translate = (error, message) => {
  if (error instanceof PaymentError) return error;

  const upstream = Number(error?.statusCode);
  if (upstream === 401) {
    // Razorpay rejected OUR credentials, which is an operator problem and has
    // nothing to do with the person clicking the button.
    //
    // Answered 503, not 401. A 401 from this application's own API means "your
    // session is not valid", and that is what every caller reads it as -- the
    // browser treats it as a sign-in problem, and a terminal log line saying
    // `401 /api/billing/checkout` sends whoever is debugging it straight to
    // Clerk. This is the same condition gatewayReady() reports, arriving a
    // moment later, so it gets the same status: the service cannot take a
    // payment right now. The distinguishing detail stays in `code` and in the
    // log, where the operator will find it.
    return new PaymentError("UPSTREAM_UNAUTHORIZED", "Payments are not available just now.", {
      status: 503,
      cause: error,
    });
  }
  return new PaymentError("UPSTREAM_FAILED", message, {
    status: upstream === 400 ? 400 : 502,
    cause: error,
  });
};

// --- Subscriptions ----------------------------------------------------------

// Opens a subscription against a Razorpay Plan.
//
// The plan id comes from configuration (lib/billing/plans.js), never from a
// request: the amount and interval live on Razorpay's Plan object, so a plan
// id from the browser is a price from the browser wearing a disguise.
//
// `notes` is how the webhook finds its way back to an account without trusting
// anything the browser says. The Clerk user id is an opaque identifier.
export async function createSubscription({
  providerPlanId,
  totalCount,
  userId,
  planId,
  interval,
  // The checkout attempt this subscription belongs to. Carried in the notes
  // so a subscription that was created while the response was lost can be
  // recognised as this attempt's rather than being orphaned -- see
  // reconcileAttempt() in lib/billing/service.js.
  attemptId = null,
  notify = false,
}) {
  try {
    return await api().subscriptions.create({
      plan_id: providerPlanId,
      total_count: totalCount,
      // Razorpay would otherwise email and text the customer on our behalf,
      // from our merchant account, about a product whose own emails we
      // control. One voice.
      customer_notify: notify ? 1 : 0,
      notes: {
        whealthos_user: userId,
        whealthos_plan: planId,
        whealthos_interval: interval,
        ...(attemptId ? { whealthos_attempt: attemptId } : {}),
      },
    });
  } catch (error) {
    throw translate(error, "Could not start the subscription. Please try again.");
  }
}

// Reads a subscription back. This is the authoritative state: used to confirm
// a checkout rather than believing the browser, and to reconcile an event
// whose own payload is ambiguous or stale.
export async function fetchSubscription(providerSubscriptionId) {
  try {
    return await api().subscriptions.fetch(providerSubscriptionId);
  } catch (error) {
    throw translate(error, "Could not confirm the subscription. Please try again.");
  }
}

// Lists recent subscriptions, newest first.
//
// Used for exactly one thing: finding a subscription this application created
// but never managed to record, after a create call timed out. Razorpay's
// subscriptions API has no idempotency key, so the only way to answer "did my
// last call actually succeed?" is to look.
//
// Bounded on purpose. `from` is a unix timestamp and `count` is capped by
// Razorpay at 100, so a reconciliation reads a window around the attempt
// rather than walking the account's whole history -- this must not become a
// way to enumerate every subscription the merchant has.
export async function listSubscriptions({ from = null, count = 100 } = {}) {
  try {
    const result = await api().subscriptions.all({
      count: Math.min(Math.max(Number(count) || 1, 1), 100),
      ...(from ? { from: Math.floor(from) } : {}),
    });
    return Array.isArray(result?.items) ? result.items : [];
  } catch (error) {
    throw translate(error, "Could not check the subscription. Please try again.");
  }
}

// Stops a subscription. `atCycleEnd` keeps the period already paid for, which
// is the only behaviour this product offers -- an immediate cancellation would
// take access away from someone who has paid for the rest of the month, and
// there is no refund policy written down to justify that.
export async function cancelSubscription(providerSubscriptionId, { atCycleEnd = true } = {}) {
  try {
    return await api().subscriptions.cancel(providerSubscriptionId, atCycleEnd);
  } catch (error) {
    throw translate(error, "Could not cancel the subscription. Please try again.");
  }
}

// Moves a live subscription to another Razorpay Plan at the end of the current
// cycle.
//
// Deliberately only at cycle end. An immediate change means proration, and
// there is no proration policy published anywhere in this product -- inventing
// one would decide, silently, whether somebody is owed money. At cycle end
// nobody is charged twice and nobody is owed anything.
export async function changeSubscriptionPlan(providerSubscriptionId, { providerPlanId }) {
  try {
    return await api().subscriptions.update(providerSubscriptionId, {
      plan_id: providerPlanId,
      schedule_change_at: "cycle_end",
      // Razorpay would otherwise email and text the customer on our behalf,
      // about a change whose own email we send -- the same reason
      // createSubscription above passes 0. One voice.
      //
      // `remaining_count` is deliberately NOT passed, and this is worth
      // stating because the comment that used to sit here described it: it
      // claimed to stop the new plan inheriting the old plan's remaining
      // cycle count, above a parameter that does nothing of the sort.
      // Whichever way Razorpay resolves the count on a plan change, nobody is
      // affected: totalCountFor() is a ten-year horizon chosen to be
      // unreachable, so the difference between 114 remaining months and 120
      // is not a difference anybody experiences. Sending an unverified
      // parameter to a live billing API to fix a comment would be the larger
      // risk. If it ever matters, observe the subscription object after a real
      // plan change before adding it.
      customer_notify: 0,
    });
  } catch (error) {
    throw translate(error, "Could not change the plan. Please try again.");
  }
}

// --- Signatures -------------------------------------------------------------

// Constant-time comparison of two hex digests.
//
// timingSafeEqual rather than ===. A string comparison returns as soon as two
// bytes differ, which leaks how much of a guess was right and turns forging a
// signature into 64 cheap questions instead of one impossible one. It needs
// equal lengths, so that is checked first -- public anyway, since SHA-256
// fixes it.
const digestsMatch = (expected, given) => {
  if (typeof expected !== "string" || typeof given !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

const hmac = (message, secret) =>
  createHmac("sha256", String(secret)).update(message).digest("hex");

// The signature Razorpay returns from a SUBSCRIPTION checkout.
//
// Note the order: payment id first, then subscription id. This is NOT the
// order-payment formula, which is "<order_id>|<payment_id>". Getting the two
// the wrong way round produces a digest that never matches and a checkout
// that silently never confirms, so the two are deliberately not sharing a
// helper that could be called with the wrong arguments.
export const expectedCheckoutSignature = (
  paymentId,
  providerSubscriptionId,
  secret = keySecret()
) => hmac(`${paymentId}|${providerSubscriptionId}`, secret);

// Whether the browser's checkout callback was really signed by Razorpay.
//
// A true answer proves this payment was made against this subscription. It
// proves nothing about whose subscription it is, and nothing about any future
// renewal -- both of those are the service's job, not this function's.
export function checkoutSignatureMatches({ paymentId, providerSubscriptionId, signature }) {
  if (!configured()) throw notConfigured();
  if (!paymentId || !providerSubscriptionId || typeof signature !== "string") return false;

  return digestsMatch(
    expectedCheckoutSignature(paymentId, providerSubscriptionId),
    signature
  );
}

// Whether a webhook delivery was really signed by Razorpay.
//
// The raw body, exactly as received. Parsing and re-serialising JSON changes
// the bytes -- key order, whitespace, number formatting -- and the signature
// stops matching, which is why the route reads text() and parses only after
// this returns true.
//
// Keyed with the WEBHOOK secret, which is a different value from the API key
// secret. Signing this check with the wrong one rejects every genuine
// delivery, so a missing webhook secret throws rather than returning false:
// "not configured" and "forged" need different answers, because Razorpay
// should retry the first and never retry the second.
export function webhookSignatureMatches(rawBody, signature) {
  const secret = webhookSecret();
  if (!secret) {
    throw new PaymentError("WEBHOOK_NOT_CONFIGURED", "Webhook not configured.", {
      status: 500,
    });
  }
  if (typeof rawBody !== "string" || typeof signature !== "string") return false;

  return digestsMatch(hmac(rawBody, secret), signature);
}
