import { refreshConfirming } from "@/lib/billing/service";
import { entitlementSummary } from "@/lib/billing/entitlements";
import { authenticate, fail, ok } from "@/lib/billing/http";

// What this account is actually on, from the database.
//
// The confirmation page reads this rather than believing the redirect that
// brought it there -- a browser arriving at /billing/success proves only that
// a browser arrived at /billing/success -- and polls it while a payment is
// being confirmed.
//
// Scoped to the caller. There is no way to ask this endpoint about somebody
// else's subscription: it takes no identifier at all, and the one it answers
// for comes from the verified session.
export const runtime = "nodejs";

export async function GET() {
  const auth = await authenticate("write");
  if (auth.response) return auth.response;

  try {
    // Asks Razorpay again, at most once every few seconds, and only while
    // something is actually in flight. Without it a deployment whose webhook
    // has not arrived -- every local one, since Razorpay cannot reach
    // localhost -- would poll an unchanging row and then give up.
    const summary = await refreshConfirming(auth.userId);
    return ok({
      ...entitlementSummary(summary.planId),
      subscription: summary.subscription,
      pending: summary.pending,
      // Whether something is still on its way. The confirmation page stops
      // polling when this goes false, and it grants nothing by itself.
      confirming: summary.confirming,
      // Named fields rather than the row: an attempt carries an idempotency
      // key and a Razorpay plan id, and neither belongs in a browser.
      attempt: summary.attempt
        ? {
            status: summary.attempt.status,
            planId: summary.attempt.planId,
            interval: summary.attempt.interval,
          }
        : null,
    });
  } catch (error) {
    console.error({ code: "BILLING_SUMMARY_FAILED", error });
    return fail("Could not load your plan just now.", 500, "UNEXPECTED");
  }
}
