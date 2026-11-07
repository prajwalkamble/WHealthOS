import { withCurrentTenant } from "@/lib/prisma";
import { isSupported } from "./registry.js";

// Saving a display-currency preference to the account.
//
// A plain module, deliberately NOT a "use server" one. That distinction is
// the whole point of this file existing.
//
// Next re-renders the current route's server components after ANY Server
// Action resolves -- that is the action protocol, not something
// revalidatePath was doing. So a background "remember this on the account"
// call made through an action re-rendered the entire signed-in tree a moment
// after every currency change: the dashboard flashed, scroll position went,
// and it read as a full page reload even though the figures themselves had
// already updated locally. Removing revalidatePath was not enough.
//
// Called from app/api/currency/route.js, which is an ordinary route handler
// and returns JSON. Nothing re-renders.

/** How long the browser should keep the preference cookie. */
export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Writes the chosen currency onto the signed-in account.
 *
 * Returns what happened rather than throwing: this runs in the background,
 * nothing is waiting on it, and a failure must never disturb a choice the
 * browser has already applied and stored in its own cookie.
 */
export async function saveDisplayCurrency(currency) {
  if (!isSupported(currency)) return { saved: false, reason: "unsupported" };
  const code = String(currency).toUpperCase();

  try {
    // Through withCurrentTenant, not the bare client: every query on the
    // request-scoped client runs under row-level security, and without a
    // tenant set the policies match nothing -- the write would silently
    // affect zero rows.
    await withCurrentTenant((tx, userId) =>
      tx.user.update({ where: { id: userId }, data: { displayCurrency: code } })
    );
    return { saved: true, currency: code };
  } catch {
    // Signed out, no account row yet, or the database is unavailable. The
    // cookie already holds the choice, so the person sees what they picked
    // either way; it simply will not follow them to another device yet.
    return { saved: false, reason: "not-saved" };
  }
}
