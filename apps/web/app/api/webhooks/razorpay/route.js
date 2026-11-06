import { PaymentError, webhookSignatureMatches } from "@/lib/payments/razorpay";
import { processEvent } from "@/lib/billing/webhook";

// The Razorpay webhook.
//
// Under /api/webhooks/ rather than /api/billing/webhooks/ on purpose. The
// Arcjet middleware excludes exactly that prefix, and detectBot runs LIVE in
// production without allowing Razorpay -- a billing webhook anywhere else
// would have every delivery blocked, silently, in production only. It sits
// beside the Clerk and Resend webhooks, which is also where somebody looking
// for it will look.
//
// Public: Razorpay has no session here. The signature is the only thing that
// makes a request trustworthy, and it is checked before the body is parsed and
// long before anything is written.
//
// Razorpay retries until it gets a 2xx, so this answers 2xx for anything it
// has genuinely dealt with -- including a delivery it has already dealt with,
// and one it understands but will not act on. Non-2xx is reserved for "try
// again" (our fault) and "never send this again" (a bad signature).
export const runtime = "nodejs";

// A webhook body larger than this is not a subscription event. Checked before
// verification so a huge body is never hashed.
const MAX_BODY_BYTES = 1_000_000;

export async function POST(request) {
  // The RAW body, as sent. Parsing and re-serialising changes the bytes --
  // key order, whitespace, number formatting -- and the signature stops
  // matching. Nothing parses this until it has been proven to be the body
  // that was signed.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const signature = request.headers.get("x-razorpay-signature") ?? "";

  let verified;
  try {
    verified = webhookSignatureMatches(raw, signature);
  } catch (error) {
    if (error instanceof PaymentError && error.code === "WEBHOOK_NOT_CONFIGURED") {
      // A missing secret must never be treated as "skip verification". 500 so
      // Razorpay retries once the deployment is configured.
      console.error("Razorpay webhook rejected: RAZORPAY_WEBHOOK_SECRET is not set.");
      return Response.json({ error: "Webhook not configured" }, { status: 500 });
    }
    throw error;
  }

  if (!verified) {
    // Deliberately no detail: somebody probing this endpoint learns only that
    // it was rejected. 400 is final -- Razorpay should not retry a request
    // that will never verify.
    console.warn("Razorpay webhook rejected: signature verification failed.");
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Razorpay's own delivery identifier, and the whole of idempotency. Without
  // it two retries of the same event would both be applied, so a delivery
  // that does not carry one is refused rather than processed once per attempt.
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) {
    console.warn("Razorpay webhook rejected: no x-razorpay-event-id header.");
    return Response.json({ error: "Missing event id" }, { status: 400 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    // Signed by Razorpay and still unparseable. Retrying will not help.
    console.error("Razorpay webhook: signed body was not JSON.");
    return Response.json({ error: "Malformed body" }, { status: 400 });
  }

  try {
    const result = await processEvent({ eventId, body });
    // 200 for applied, duplicate, unhandled and unknown alike. Every one of
    // those is a delivery that has been dealt with; answering anything else
    // would have Razorpay resend it for days.
    return Response.json({ received: true, applied: Boolean(result.applied) });
  } catch (error) {
    // Logged with the event id so the stored BillingEvent row can be found.
    // 500 so Razorpay retries: the delivery was real and we failed it.
    console.error({ code: "RAZORPAY_WEBHOOK_FAILED", details: { eventId }, error });
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
