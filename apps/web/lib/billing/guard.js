// The one call a protected feature makes.
//
//   await requireFeature(userId, "budgets");
//
// Resolves the effective plan from the database -- never from a request, a
// cookie, a header or anything the browser can set -- and throws if that plan
// does not include the feature.
//
// Separate from entitlements.js so that file stays a pure function of a plan
// id and can be tested without a database.

import { ActionError } from "@/lib/action-error";
import { EntitlementError, requireEntitlement, smallestPlanWith } from "./entitlements";
import { effectivePlanId } from "./service";

// For route handlers: throws EntitlementError, which carries a 403.
export async function requireFeature(userId, key, { tx = null } = {}) {
  const planId = await effectivePlanId(userId, { tx });
  requireEntitlement(planId, key);
  return planId;
}

// For server actions, which report failure by returning rather than throwing a
// status code. runAction turns an ActionError's message into the one the
// client toasts, so the message has to be written for a person and name the
// plan that would fix it.
export async function requireFeatureInAction(userId, key, { tx = null } = {}) {
  try {
    return await requireFeature(userId, key, { tx });
  } catch (error) {
    if (error instanceof EntitlementError) {
      const needed = smallestPlanWith(key);
      throw new ActionError(
        needed
          ? `This is part of the ${needed[0].toUpperCase()}${needed.slice(1)} plan. Upgrade in Settings to use it.`
          : "Your plan does not include this feature."
      );
    }
    throw error;
  }
}

export { EntitlementError };
