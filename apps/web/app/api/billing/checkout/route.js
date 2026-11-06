import { billingCheckoutSchema } from "@/app/lib/schema";
import { BillingError, startCheckout } from "@/lib/billing/service";
import { PaymentError } from "@/lib/payments/razorpay";
import { authenticate, fail, failPayment, gatewayReady, ok, readBody } from "@/lib/billing/http";
import { plansAreOnSale } from "@/lib/billing/availability";

// Opens a Razorpay subscription for the plan the signed-in person chose.
//
// The browser sends a plan id and an interval. It does not send -- and this
// route would not read -- an amount, a currency, a Razorpay plan id, an owner
// or a status. Every one of those is resolved server-side in
// lib/billing/plans.js from configuration.
export const runtime = "nodejs";

export async function POST(request) {
  const auth = await authenticate();
  if (auth.response) return auth.response;

  // Asked before anything else, and asked here rather than only in the UI.
  // Hiding the buttons stops the buttons; it does not stop a POST, and this
  // is the endpoint that creates a real recurring mandate on a real card.
  // While the plans are discontinued this route must refuse every caller,
  // including one holding a checkout URL from before they were.
  if (!plansAreOnSale()) {
    return fail(
      "WHealthOS is free — there is nothing to buy. Every feature is already included in your account.",
      404,
      "PLANS_NOT_ON_SALE"
    );
  }

  const unready = gatewayReady();
  if (unready) return unready;

  const read = await readBody(request);
  if (read.response) return read.response;

  const parsed = billingCheckoutSchema.safeParse(read.body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That plan could not be read.", 400, "INVALID");
  }

  try {
    const checkout = await startCheckout({
      userId: auth.userId,
      planId: parsed.data.planId,
      interval: parsed.data.interval,
    });
    // Only what the modal needs. The key id is not returned: the browser uses
    // NEXT_PUBLIC_RAZORPAY_KEY_ID, and gatewayReady has already established
    // that the one it holds belongs to this merchant account.
    return ok(checkout);
  } catch (error) {
    if (error instanceof BillingError) {
      return fail(error.message, error.status, error.code);
    }
    if (error instanceof PaymentError) {
      console.error({
        code: error.code,
        details: { planId: parsed.data.planId, interval: parsed.data.interval },
        error: error.cause ?? error,
      });
      return failPayment(error);
    }
    console.error({ code: "BILLING_CHECKOUT_FAILED", error });
    return fail("Could not start the payment. Please try again.", 500, "UNEXPECTED");
  }
}
