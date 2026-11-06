import { BillingError, requestCancellation } from "@/lib/billing/service";
import { PaymentError } from "@/lib/payments/razorpay";
import { authenticate, fail, failPayment, gatewayReady, ok } from "@/lib/billing/http";

// Stops a subscription at the end of the period already paid for.
//
// There is no immediate cancellation and no refund path here. Taking access
// away mid-period from somebody who has paid for it needs a refund policy,
// and this product has not published one -- so the only cancellation offered
// is the one that owes nobody anything.
export const runtime = "nodejs";

export async function POST() {
  const auth = await authenticate();
  if (auth.response) return auth.response;

  const unready = gatewayReady();
  if (unready) return unready;

  try {
    const subscription = await requestCancellation(auth.userId);
    return ok({
      cancelled: true,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      accessUntil: subscription.currentEnd ?? null,
      status: subscription.status,
    });
  } catch (error) {
    if (error instanceof BillingError) return fail(error.message, error.status, error.code);
    if (error instanceof PaymentError) {
      console.error({ code: error.code, error: error.cause ?? error });
      return failPayment(error);
    }
    console.error({ code: "BILLING_CANCEL_FAILED", error });
    return fail("Could not cancel just now. Please try again.", 500, "UNEXPECTED");
  }
}
