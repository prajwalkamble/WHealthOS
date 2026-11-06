import { billingVerifySchema } from "@/app/lib/schema";
import { BillingError, confirmCheckout } from "@/lib/billing/service";
import { PaymentError } from "@/lib/payments/razorpay";
import { authenticate, fail, failPayment, gatewayReady, ok, readBody } from "@/lib/billing/http";

// The browser's checkout callback.
//
// This confirms what happened. It does not grant anything: the plan a person
// is entitled to is read from the subscription row, and that row is written
// from Razorpay's own answer, not from this request. A forged callback that
// somehow passed the signature check would still have to be about a
// subscription opened for this account, and would still only record whatever
// Razorpay says that subscription's state is.
//
// The signature here is the SUBSCRIPTION formula -- payment id, then
// subscription id. See lib/payments/razorpay.js.
export const runtime = "nodejs";

export async function POST(request) {
  const auth = await authenticate();
  if (auth.response) return auth.response;

  const unready = gatewayReady();
  if (unready) return unready;

  const read = await readBody(request);
  if (read.response) return read.response;

  const parsed = billingVerifySchema.safeParse(read.body);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "That payment could not be read.",
      400,
      "INVALID"
    );
  }

  const {
    razorpay_payment_id: paymentId,
    razorpay_subscription_id: providerSubscriptionId,
    razorpay_signature: signature,
  } = parsed.data;

  try {
    return ok(
      await confirmCheckout({
        userId: auth.userId,
        paymentId,
        providerSubscriptionId,
        signature,
      })
    );
  } catch (error) {
    if (error instanceof BillingError) {
      // Logged loudly for the two that are not ordinary. A mismatch is either
      // a bug here or somebody passing off a payment that did not happen; an
      // ownership failure is somebody replaying ids that are not theirs. The
      // ids are Razorpay's own and identify a payment attempt, not a person.
      if (error.code === "SIGNATURE_MISMATCH" || error.code === "NOT_YOUR_SUBSCRIPTION") {
        console.error({
          code: `RAZORPAY_${error.code}`,
          details: { providerSubscriptionId, paymentId },
        });
      }
      return fail(error.message, error.status, error.code);
    }
    if (error instanceof PaymentError) {
      console.error({ code: error.code, error: error.cause ?? error });
      return failPayment(error);
    }
    console.error({ code: "BILLING_VERIFY_FAILED", error });
    return fail("Could not confirm the payment. Please try again.", 500, "UNEXPECTED");
  }
}
