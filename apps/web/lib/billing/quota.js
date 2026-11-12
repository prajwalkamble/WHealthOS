// How much of a metered feature a plan allows, and the enforcement of it.
//
// There is exactly one metered feature in WHealthOS: transactions added per
// day. data/pricing.js has advertised a figure per plan since the pricing
// page shipped -- "5 per day", "15 per day", "Higher / Unlimited" -- and
// nothing has ever applied it. This module applies it.
//
// Separate from entitlements.js because the two answer different questions.
// Entitlements ask "does this plan include the feature at all"; a quota asks
// "has this account used up today's allowance of a feature it does have".
// A quota failure is a 429 and resolves itself at midnight; an entitlement
// failure is a 403 and resolves itself only by upgrading.
//
// ---------------------------------------------------------------------------
// WHY THIS IS OFF BY DEFAULT, AND WHY IT HAS ITS OWN FLAG
// ---------------------------------------------------------------------------
// BILLING_ENFORCEMENT governs which *features* a plan includes. This cap is a
// different promise, and the Terms currently rule it out twice over:
//
//   - lib/legal/terms.js records `perDayTransactionLimitEnforced: false`, and
//     tests/legal-consistency.test.js asserts the rendered Terms contain no
//     "per day" or "daily limit" wording at all.
//   - Section 6 promises, in terms people have already accepted, that we will
//     "tell you before we do it" when a free feature is moved behind a plan.
//
// Switching this on without rewriting the Terms, bumping the version in
// lib/legal/versions.js and giving that notice would break a commitment users
// agreed to. That is a business and legal decision, not a deployment toggle,
// so the mechanism ships complete and tested while the switch stays off. The
// same shape as BILLING_ENFORCEMENT, and for the same reason.
//
// While it is off every check still runs and every refusal is logged, so the
// real shape of the cap is visible before anybody is held to it.

import { PLANS } from "@/data/pricing";
import { dayWindowBounds } from "@/lib/time";
import { FREE_PLAN_ID } from "./plans";

// null means no cap. Read from the published table so the number enforced and
// the number advertised cannot drift.
const DAILY_TRANSACTIONS = new Map(
  PLANS.map((plan) => [plan.id, plan.dailyTransactions ?? null])
);

/**
 * The number of transactions `planId` may add in a day, or null for no cap.
 *
 * An unknown plan gets the free allowance rather than no allowance and rather
 * than an unlimited one: entitlement resolution upstream already fails closed,
 * and a plan id this module does not recognise is a bug, not a licence.
 */
export const dailyTransactionLimit = (planId) =>
  DAILY_TRANSACTIONS.has(planId)
    ? DAILY_TRANSACTIONS.get(planId)
    : DAILY_TRANSACTIONS.get(FREE_PLAN_ID) ?? null;

export const quotaEnforcementEnabled = () =>
  String(process.env.BILLING_QUOTA_ENFORCEMENT ?? "").toLowerCase() === "on";

// Thrown when today's allowance is spent. 429, not 403: nothing is wrong with
// the plan, the allowance simply resets.
export class QuotaError extends Error {
  constructor({ feature, limit, used, planId, resetsAt }) {
    super(
      `You have added today's ${limit} transactions on the ${planId} plan. ` +
        "The limit resets at midnight."
    );
    this.name = "QuotaError";
    this.code = "QUOTA_EXCEEDED";
    this.status = 429;
    this.feature = feature;
    this.limit = limit;
    this.used = used;
    this.planId = planId;
    this.resetsAt = resetsAt;
  }
}

// A stable namespace for this module's advisory locks, so a lock taken here
// can never collide with one taken somewhere else for a different reason.
const LOCK_NAMESPACE = 8_311_402;

/**
 * Consumes one transaction from today's allowance, or refuses.
 *
 * Must be called inside the same database transaction as the insert it is
 * guarding, and before it. Two things make it atomic:
 *
 *   - `pg_advisory_xact_lock` serialises every concurrent quota check for one
 *     account until this transaction commits or rolls back. Without it two
 *     requests arriving together both read "4 used", both insert, and the
 *     account ends the day with 6. Counting rows is not enough on its own:
 *     under READ COMMITTED neither request can see the other's uncommitted
 *     insert, so both are correct and both are wrong.
 *   - The count and the insert share a transaction, so a refusal rolls the
 *     whole thing back and a failed insert gives the allowance back. Nothing
 *     has to decrement anything, which is what a separate counter table would
 *     have needed to get right.
 *
 * Counting rows rather than keeping a tally also means the figure is "how many
 * exist today", so deleting a transaction frees its slot, and the count resets
 * itself at midnight with nothing to schedule.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} userId  the internal user id, never one from a request
 * @param {string} planId  from a verified subscription, via effectivePlanId
 */
export async function consumeDailyTransaction(tx, userId, planId, { now = new Date() } = {}) {
  const limit = dailyTransactionLimit(planId);
  const { from, to } = dayWindowBounds(1, now);
  const resetsAt = new Date(to.getTime() + 1);

  if (limit === null) {
    return { feature: "transactions.daily", limit: null, used: null, remaining: null, resetsAt };
  }

  // hashtext gives an int4 from the id; the two-argument form keeps this
  // module's locks in their own namespace.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${userId})::int)`;

  // One user action, one unit -- which is why this is two counts and not one.
  //
  // An internal transfer writes TWO transaction rows, the debit and the credit
  // legs of a single act. Counting transaction rows alone would charge it
  // double, so the advertised "5 per day" would silently become two and a half
  // for anybody who moves money between their own accounts. Transfer legs are
  // therefore excluded here (`transferId: null`) and each transfer is counted
  // once in their place.
  //
  // Still "how many exist today" rather than a tally, so deleting a transfer
  // frees its slot exactly as deleting a transaction does.
  const [transactions, transfers] = await Promise.all([
    tx.transaction.count({
      where: { userId, transferId: null, createdAt: { gte: from, lte: to } },
    }),
    tx.transfer.count({
      where: { userId, createdAt: { gte: from, lte: to } },
    }),
  ]);
  const used = transactions + transfers;

  const within = used < limit;
  const result = {
    feature: "transactions.daily",
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt,
  };

  if (within) return result;

  if (!quotaEnforcementEnabled()) {
    console.warn({
      code: "QUOTA_WOULD_DENY",
      details: { feature: "transactions.daily", planId, limit, used },
    });
    return result;
  }

  throw new QuotaError({ feature: "transactions.daily", limit, used, planId, resetsAt });
}

// What the browser may be told, so a form can show "3 of 5 used today"
// without being trusted to stop anybody. Advisory only; the server counts
// again inside the write.
export const quotaSummary = (planId) => ({
  planId: planId ?? FREE_PLAN_ID,
  dailyTransactions: dailyTransactionLimit(planId ?? FREE_PLAN_ID),
  enforced: quotaEnforcementEnabled(),
});
