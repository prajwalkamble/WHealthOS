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
import { devGrantsAll } from "./dev-override";
import { EntitlementError, requireEntitlement, smallestPlanWith } from "./entitlements";
import { effectivePlanId } from "./service";

// For route handlers: throws EntitlementError, which carries a 403.
//
// This is where the development override is applied, and applying it in one
// place is the point: all 20 gated server operations -- the goal, budget,
// preference and receipt actions, the three reads in lib/queries.js, the
// export route and the AI chat route -- come through here or through
// requireFeatureInAction below, so there is one function to read when asking
// what the override can reach, and no second path for it to be forgotten on.
//
// The plan returned is always the REAL plan. The override skips the check; it
// does not rewrite who the account is. Callers that report a plan to somebody
// therefore go on reporting the true one.
export async function requireFeature(userId, key, { tx = null } = {}) {
  const planId = await effectivePlanId(userId, { tx });
  requireEntitlement(planId, key, { grantAll: devGrantsAll(userId) });
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
