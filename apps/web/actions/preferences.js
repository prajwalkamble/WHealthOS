"use server";

import { withCurrentTenant } from "@/lib/prisma";
import { runAction } from "@/lib/action-error";
import { enforceRateLimit } from "@/lib/arcjet";
import { requireClerkUserId } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { changedSettings, normalise, SETTING_ENTITLEMENTS } from "@/lib/preferences";
import { requireFeatureInAction } from "@/lib/billing/guard";

// The whole appearance set, saved together. normalise drops anything that is
// not a known setting with a known value, so a crafted payload cannot put
// arbitrary JSON on the row or the page into a state the CSS cannot render.
export async function savePreferences(rawPreferences) {
  return runAction(async () => {
    const clerkUserId = await requireClerkUserId();
    await enforceRateLimit("write", clerkUserId);

    const preferences = normalise(rawPreferences);

    await withCurrentTenant(async (tx, userId) => {
      // Customisation is sold: "appearance.customize" and
      // "dashboard.customize" are Pro rows on the pricing page, while the
      // light/dark switch is free. So the gate is per setting and only on the
      // ones actually changing -- the browser posts the whole set every time,
      // and refusing the lot would take the free theme switch away too.
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });
      const before = normalise(current?.preferences);

      const needed = new Set(
        changedSettings(before, preferences)
          .map((key) => SETTING_ENTITLEMENTS[key])
          .filter(Boolean)
      );
      for (const entitlement of needed) {
        await requireFeatureInAction(userId, entitlement, { tx });
      }

      return tx.user.update({ where: { id: userId }, data: { preferences } });
    });

    // No revalidate: the browser has already applied them, and every page
    // reads them from the attributes on <html>.
    return { success: true, data: preferences };
  });
}

// The one switch that decides whether this account's monthly totals are sent
// to an external model. Separate from the appearance preferences above: those
// are a normalised JSON blob, this is a column the monthly job reads, and
// conflating them would mean a bad appearance payload could silently turn a
// privacy setting back on.
export async function setMonthlyInsights(enabled) {
  return runAction(async () => {
    const clerkUserId = await requireClerkUserId();
    await enforceRateLimit("write", clerkUserId);

    const monthlyInsights = enabled === true;

    await withCurrentTenant((tx, userId) =>
      tx.user.update({ where: { id: userId }, data: { monthlyInsights } })
    );

    revalidatePath("/settings");
    return { success: true, data: { monthlyInsights } };
  });
}
