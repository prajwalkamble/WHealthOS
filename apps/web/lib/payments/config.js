// Razorpay configuration, resolved from the environment in one place.
//
// Same shape as lib/email/config.js: lazy getters rather than module-level
// constants, so a route that imports this during a build does not capture an
// undefined value, and so a test can set the variables and re-read them.
//
// Three variables, and which side of the wire each one lives on matters:
//
//   RAZORPAY_KEY_ID            server. Identifies the merchant account.
//   RAZORPAY_KEY_SECRET        server. Signs orders and verifies callbacks.
//   NEXT_PUBLIC_RAZORPAY_KEY_ID  browser. The same key id as the first one.
//
// The key id is not a secret -- Razorpay's own checkout script needs it in the
// page -- but the secret is, and it is the only thing standing between a
// stranger and the merchant account. It is read here and nowhere else, there
// is no NEXT_PUBLIC_ equivalent, and there must never be one.

export const keyId = () => process.env.RAZORPAY_KEY_ID || null;

export const keySecret = () => process.env.RAZORPAY_KEY_SECRET || null;

// The key id the browser bundle was built with. Next inlines this at build
// time, so reading it on the server reads the same literal the client got.
export const publicKeyId = () => process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null;

// Whether this deployment has been told who it charges as. Keyed on both
// server variables being set: an id without a secret can open a checkout
// modal that can never be verified, which is worse than refusing up front.
export const configured = () => Boolean(keyId() && keySecret());

// Whether the key id in the browser bundle is the one the secret belongs to.
//
// Worth checking because the failure mode is otherwise undebuggable. Checkout
// opens against the public key id and the order was created under the server
// key id; if they are different accounts Razorpay rejects the order_id with a
// message about the payment, not about the configuration, and nothing in this
// codebase is visibly wrong. A deployment that sets only two of the three
// variables -- the easy mistake, since two of them hold the same value -- is
// caught here instead.
export const publicKeyMatches = () => {
  const published = publicKeyId();
  // Not set is a separate failure, reported by the caller. This answers only
  // whether the two disagree.
  if (!published) return true;
  return published === keyId();
};

// Test mode or live mode, from the key id's own prefix. Razorpay issues
// `rzp_test_...` and `rzp_live_...`, so the mode never has to be configured
// separately and cannot be configured wrongly.
export const isTestMode = () => String(keyId() ?? "").startsWith("rzp_test_");

// The webhook signing secret, set on the webhook's own page in the Razorpay
// Dashboard. Separate from the API secret above and not interchangeable with
// it: signing a webhook check with the API key secret silently rejects every
// genuine delivery.
//
// A missing secret must never be read as "skip verification" -- the webhook
// route answers 500 so Razorpay retries once it is configured, rather than
// trusting an unsigned request.
export const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || null;

export const webhookConfigured = () => Boolean(webhookSecret());

// The merchant's public razorpay.me handle, e.g. "whealthos" for
// https://razorpay.me/@whealthos.
//
// Documentation and a manual fallback only. It is deliberately NOT wired into
// entitlements: a razorpay.me payment is a standalone payment link with no
// subscription behind it and no reliable way to attribute it to an account,
// so money arriving through it cannot and must not grant a plan. Someone who
// pays that way is reconciled by hand.
export const paymentHandle = () => process.env.RAZORPAY_PAYMENT_HANDLE || null;

export const paymentHandleUrl = () => {
  const handle = paymentHandle();
  return handle ? `https://razorpay.me/@${handle}` : null;
};
