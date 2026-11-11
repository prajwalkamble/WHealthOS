import { billingPlanChangeSchema } from "@/app/lib/schema";
import { BillingError, requestPlanChange } from "@/lib/billing/service";
import { PaymentError } from "@/lib/payments/razorpay";
import { authenticate, fail, failPayment, gatewayReady, ok, readBody } from "@/lib/billing/http";
import { plansAreOnSale } from "@/lib/billing/availability";

// Moves a live subscription up to a higher plan, at the end of the period it
// has already paid for.
//
// This is NOT a checkout, and the difference is the whole reason it is a
// separate route rather than a branch of /api/billing/checkout. Nothing here
// takes a payment: no order is created, no Razorpay modal is opened, no
// payment id or signature comes back, and there is nothing to verify. Razorpay
// is told to run the subscription on a different Plan from the next cycle, and
// it charges the new price then, on the mandate the customer already
// authorised. That is why there is no proration anywhere in this file -- the
// period in progress was paid at the old rate and stays at the old rate.
//
// What it has in common with the checkout route is every guard: the same
// session check, the same on-sale check, the same gateway-readiness check, and
// a body that carries a plan id and an interval and nothing with a commercial
// consequence. The price, the currency and the Razorpay plan id are resolved
// in lib/billing/plans.js from configuration, exactly as they are for a
// purchase. The subscription being changed is never named by the caller: it is
// whichever one the signed-in account holds, read from the database.
export const runtime = "nodejs";

export async function POST(request) {
  const auth = await authenticate();
  if (auth.response) return auth.response;

  // Asked first, and asked here rather than only in the UI. An upgrade is a
  // change to a real recurring mandate on a real card, and withdrawing the
  // plans has to stop it: once a plan is no longer sold, moving somebody onto
  // it is selling it.
  //
  // Note what this does NOT do: it does not touch the subscription they
  // already have. Somebody holding a live subscription while the plans are
  // withdrawn keeps it, on the terms they agreed to, and can still cancel --
  // the Settings card says exactly that. They simply cannot move it.
  if (!plansAreOnSale()) {
    return fail(
      "Plans are not being sold at the moment, so a plan cannot be changed. Your current subscription is unaffected.",
      404,
      "PLANS_NOT_ON_SALE"
    );
  }

  const unready = gatewayReady();
  if (unready) return unready;

  const read = await readBody(request);
  if (read.response) return read.response;

  const parsed = billingPlanChangeSchema.safeParse(read.body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That plan could not be read.", 400, "INVALID");
  }

  try {
    const change = await requestPlanChange({
      userId: auth.userId,
      planId: parsed.data.planId,
      interval: parsed.data.interval,
    });

    // Named fields rather than the row. The subscription record carries a
    // provider subscription id and a customer id, and neither belongs in a
    // browser -- and the only things the screen needs are what is coming and
    // when.
    return ok({
      scheduled: true,
      planId: change.planId,
      interval: change.interval,
      from: change.from,
      effectiveFrom: change.effectiveFrom,
    });
  } catch (error) {
    if (error instanceof BillingError) {
      // Every refusal requestPlanChange makes is a sentence somebody can act
      // on -- "cancel in Settings", "only while it is active" -- so the
      // message is passed through as written rather than flattened.
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
    console.error({ code: "BILLING_PLAN_CHANGE_FAILED", error });
    return fail("Could not change the plan. Please try again.", 500, "UNEXPECTED");
  }
}
