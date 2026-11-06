// The shared opening of every billing route: who is asking, may they ask
// again so soon, and is this deployment able to charge anybody.
//
// One copy, because three copies of an authentication check is three places
// for a security fix to be applied to two of them.

import { enforceRateLimit } from "@/lib/arcjet";
import { requireClerkUserId } from "@/lib/session";
import { getCurrentUserId } from "@/lib/prisma";
import { checkoutAvailability, describeUnavailability } from "./availability";

export const fail = (message, status, code) =>
  Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });

export const ok = (body) =>
  Response.json(body, { headers: { "Cache-Control": "no-store, private" } });

// Bodies here are a plan id and an interval, or two ids and a digest.
export const MAX_BODY_BYTES = 1024;

// Returns { userId } or a Response to return instead.
//
// userId is the INTERNAL id, resolved from the verified Clerk session. Every
// billing row is keyed on it, and it is never read from a request.
export async function authenticate(limit = "payment") {
  let clerkUserId;
  try {
    clerkUserId = await requireClerkUserId();
  } catch {
    return { response: fail("Sign in to manage your plan.", 401, "UNAUTHORIZED") };
  }

  try {
    await enforceRateLimit(limit, clerkUserId);
  } catch {
    return {
      response: fail(
        "Too many billing requests. Please wait a little and try again.",
        429,
        "RATE_LIMITED"
      ),
    };
  }

  try {
    return { userId: await getCurrentUserId() };
  } catch {
    // Signed in to Clerk but with no WHealthOS account yet -- the consent step
    // has not been completed. Nothing to bill.
    return { response: fail("Finish setting up your account first.", 403, "NO_ACCOUNT") };
  }
}

// Whether this deployment can take a payment at all. Checked before a body is
// read so a misconfigured environment answers the same way every time.
//
// The refusal carries the reason in two places, aimed at two different
// readers. The server log always names the exact variable, because the person
// who can fix it is reading the log. The response carries that detail only
// outside production -- in development the operator IS the person clicking
// the button, and "Payments are not available just now." tells them nothing
// they can act on.
export function gatewayReady() {
  const state = checkoutAvailability();
  if (state.ready) return null;

  const reason = describeUnavailability();
  console.error({ code: "RAZORPAY_NOT_CONFIGURED", details: { reason } });

  return Response.json(
    {
      error: "Payments are not available just now.",
      code: state.mismatched ? "KEY_MISMATCH" : "NOT_CONFIGURED",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: reason }),
    },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

// What an upstream failure means, for the person who can fix it.
//
// gatewayReady() already names the missing variable when this deployment has
// not been configured. This is the other half: the variables ARE set, and
// Razorpay rejected them anyway. Both answer 503 with the same sentence,
// which is right for a visitor and useless for an operator -- and leaving the
// second one undiagnosed cost two rounds of debugging a 503 whose cause was
// written nowhere on the screen.
//
// Same rule as everywhere else here: the detail is development-only, the log
// always carries it, and nothing in either repeats a secret.
const UPSTREAM_HINTS = {
  UPSTREAM_UNAUTHORIZED:
    "Razorpay rejected RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. The pair in apps/web/.env is not valid for this account — copy the current one from Dashboard → Account & Settings → API Keys, then restart the dev server (NEXT_PUBLIC_RAZORPAY_KEY_ID is inlined at build time).",
  UPSTREAM_FAILED:
    "Razorpay refused the request. The server log for this request carries their reason.",
  NOT_CONFIGURED:
    "Razorpay credentials are not configured. See apps/web/.env.example.",
  WEBHOOK_NOT_CONFIGURED:
    "RAZORPAY_WEBHOOK_SECRET is not set, so webhook deliveries cannot be verified.",
};

// Turns a PaymentError into a response, with a development-only diagnosis.
export const failPayment = (error) => {
  const hint = UPSTREAM_HINTS[error?.code];
  if (!hint || process.env.NODE_ENV === "production") {
    return fail(error.message, error.status, error.code);
  }

  return Response.json(
    { error: error.message, code: error.code, detail: hint },
    { status: error.status, headers: { "Cache-Control": "no-store" } }
  );
};

// Reads and parses a bounded JSON body. Returns { body } or { response }.
export async function readBody(request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { response: fail("Could not read the request.", 413, "TOO_LARGE") };
  }
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return { response: fail("Could not read the request.", 413, "TOO_LARGE") };
    }
    return { body: JSON.parse(raw) };
  } catch {
    return { response: fail("Could not read the request.", 400, "MALFORMED") };
  }
}
