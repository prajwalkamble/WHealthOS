// The only place that knows both Razorpay's vocabulary and ours.
//
// Razorpay documents these subscription states:
//
//   created        made, not yet authenticated by the customer
//   authenticated  customer authorised the mandate; nothing charged yet
//   active         charged and running
//   pending        a charge failed; Razorpay is retrying
//   halted         retries exhausted
//   cancelled      ended early
//   completed      ran to the end of its agreed cycles
//   expired        authentication was never completed in time
//   paused         suspended by the merchant
//
// Anything we have not seen documented maps to null, and a null never grants
// access -- an unrecognised state is not a reason to assume the best.

export const SUBSCRIPTION_STATUS = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCEL_SCHEDULED: "CANCEL_SCHEDULED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
  PAUSED: "PAUSED",
};

const MAP = {
  created: SUBSCRIPTION_STATUS.PENDING,
  authenticated: SUBSCRIPTION_STATUS.PENDING,
  active: SUBSCRIPTION_STATUS.ACTIVE,
  pending: SUBSCRIPTION_STATUS.PAST_DUE,
  halted: SUBSCRIPTION_STATUS.PAST_DUE,
  cancelled: SUBSCRIPTION_STATUS.CANCELLED,
  completed: SUBSCRIPTION_STATUS.COMPLETED,
  expired: SUBSCRIPTION_STATUS.EXPIRED,
  paused: SUBSCRIPTION_STATUS.PAUSED,
};

// Razorpay's state for ours, or null if we do not recognise it.
//
// `cancelAtCycleEnd` is carried separately by Razorpay: a subscription that
// has been told to stop at the end of the period is still "active" to them.
// Ours distinguishes the two, because the thing a person needs to be told --
// "this runs until the 14th and then stops" -- is not visible otherwise.
export function normaliseStatus(providerStatus, { cancelAtCycleEnd = false } = {}) {
  const mapped = MAP[String(providerStatus ?? "").toLowerCase()] ?? null;
  if (!mapped) return null;

  if (mapped === SUBSCRIPTION_STATUS.ACTIVE && cancelAtCycleEnd) {
    return SUBSCRIPTION_STATUS.CANCEL_SCHEDULED;
  }
  return mapped;
}

// Whether a subscription row entitles its owner to the paid plan, right now.
//
// One rule, applied to every state: you get what you paid for, and nothing
// beyond it.
//
//   ACTIVE             running. Access.
//   CANCEL_SCHEDULED   paid for, stopping later. Access until currentEnd.
//   PAST_DUE           a renewal failed. Access only to the end of the period
//                      that was actually paid for -- which is usually already
//                      past by the time Razorpay gives up retrying. This is
//                      NOT a grace period: no extra time is granted, and none
//                      is invented. A deliberate grace window is a commercial
//                      policy nobody has written down, so this does not
//                      pretend to implement one.
//   CANCELLED          same rule: the period already bought is honoured.
//   COMPLETED/EXPIRED  likewise, which for EXPIRED means no access at all,
//                      since an expired subscription was never charged.
//   PENDING            never charged. No access, however recent.
//   PAUSED             suspended. No access; a pause is not a purchase.
//
// `now` is injectable so the policy is testable without waiting for a clock.
export function grantsAccess(subscription, now = new Date()) {
  if (!subscription) return false;

  const { status, currentEnd } = subscription;

  if (status === SUBSCRIPTION_STATUS.ACTIVE) return true;
  if (status === SUBSCRIPTION_STATUS.CANCEL_SCHEDULED) {
    // Scheduled to stop, but Razorpay still calls it active. Without a
    // currentEnd there is nothing to count down to, and the subscription is
    // by its own status still running.
    return currentEnd ? currentEnd > now : true;
  }

  if (
    status === SUBSCRIPTION_STATUS.PAST_DUE ||
    status === SUBSCRIPTION_STATUS.CANCELLED ||
    status === SUBSCRIPTION_STATUS.COMPLETED ||
    status === SUBSCRIPTION_STATUS.EXPIRED
  ) {
    return Boolean(currentEnd && currentEnd > now);
  }

  // PENDING, PAUSED, and anything unrecognised.
  return false;
}

// States that occupy the one-live-subscription-per-user slot. Must match the
// partial unique index in the billing migration: if the two disagree, either
// the service refuses a legitimate purchase or the database refuses one the
// service allowed, and both look like a bug in checkout.
export const LIVE_STATUSES = [
  SUBSCRIPTION_STATUS.PENDING,
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.CANCEL_SCHEDULED,
  SUBSCRIPTION_STATUS.PAUSED,
];

export const isLive = (status) => LIVE_STATUSES.includes(status);

// Razorpay sends seconds; Prisma wants a Date. A missing or zero timestamp is
// null rather than 1970.
export const fromUnix = (seconds) =>
  Number.isFinite(Number(seconds)) && Number(seconds) > 0
    ? new Date(Number(seconds) * 1000)
    : null;
