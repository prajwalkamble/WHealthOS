import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  PaymentError,
  checkoutSignatureMatches,
  expectedCheckoutSignature,
  webhookSignatureMatches,
} from "@/lib/payments/razorpay";
import { billingCheckoutSchema, billingVerifySchema } from "@/app/lib/schema";

// Keys shaped like Razorpay's and belonging to nobody. The maths is arithmetic
// on a string; it needs no real account, and a real secret does not belong in
// a test file.
const API_SECRET = "api_secret_not_a_real_key";
const WEBHOOK_SECRET = "webhook_secret_not_a_real_key";
const KEY_ID = "rzp_test_0000000000000";

const ENV = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = API_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const SUB = "sub_Q1aBcDeFgHiJkL";
const PAY = "pay_Q1aBcDeFgHiJkL";

describe("the subscription checkout signature", () => {
  // Written out rather than taken from the helper, so the test fails if the
  // helper's idea of the message ever changes.
  const reference = createHmac("sha256", API_SECRET).update(`${PAY}|${SUB}`).digest("hex");

  it("is HMAC-SHA256 of payment id, pipe, subscription id", () => {
    expect(expectedCheckoutSignature(PAY, SUB, API_SECRET)).toBe(reference);
    expect(reference).toMatch(/^[a-f0-9]{64}$/);
  });

  // The distinction the whole integration turns on. An order checkout signs
  // "<order_id>|<payment_id>"; a subscription signs "<payment_id>|<sub_id>".
  // Using the order formula here produces a digest that never matches and a
  // checkout that silently never confirms.
  it("is NOT the order formula with the arguments swapped", () => {
    const orderShaped = createHmac("sha256", API_SECRET).update(`${SUB}|${PAY}`).digest("hex");
    expect(orderShaped).not.toBe(reference);
    expect(
      checkoutSignatureMatches({
        paymentId: PAY,
        providerSubscriptionId: SUB,
        signature: orderShaped,
      })
    ).toBe(false);
  });

  it("accepts the signature Razorpay would have sent", () => {
    expect(
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: SUB, signature: reference })
    ).toBe(true);
  });

  it.each([
    ["a different payment on the same subscription", "pay_SomethingElse00", SUB],
    ["the same payment on a different subscription", PAY, "sub_SomethingElse0"],
  ])("rejects a signature for %s", (_label, paymentId, subscriptionId) => {
    const other = expectedCheckoutSignature(paymentId, subscriptionId, API_SECRET);
    expect(
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: SUB, signature: other })
    ).toBe(false);
  });

  it("rejects one signed with another secret", () => {
    expect(
      checkoutSignatureMatches({
        paymentId: PAY,
        providerSubscriptionId: SUB,
        signature: expectedCheckoutSignature(PAY, SUB, "a_different_secret"),
      })
    ).toBe(false);
  });

  it("rejects a one-character change", () => {
    const tampered = `${reference.slice(0, -1)}${reference.at(-1) === "a" ? "b" : "a"}`;
    expect(
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: SUB, signature: tampered })
    ).toBe(false);
  });

  // A length mismatch would make timingSafeEqual throw, which in a route
  // handler is a 500 where a 400 belongs.
  it.each([
    ["too short", "abc"],
    ["too long", `${"a".repeat(64)}${"a".repeat(64)}`],
    ["empty", ""],
  ])("rejects a %s signature without throwing", (_label, signature) => {
    const call = () =>
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: SUB, signature });
    expect(call).not.toThrow();
    expect(call()).toBe(false);
  });

  it.each([[undefined], [null], [12345], [{}]])("rejects a non-string signature (%s)", (signature) => {
    expect(
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: SUB, signature })
    ).toBe(false);
  });

  it("rejects a missing payment or subscription id", () => {
    expect(
      checkoutSignatureMatches({ paymentId: "", providerSubscriptionId: SUB, signature: reference })
    ).toBe(false);
    expect(
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: "", signature: reference })
    ).toBe(false);
  });

  it("refuses to answer at all when there is no secret configured", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    // Not `false`. "Not configured" must not look like "bad signature": one is
    // an operator's problem and the other is the payer's.
    expect(() =>
      checkoutSignatureMatches({ paymentId: PAY, providerSubscriptionId: SUB, signature: reference })
    ).toThrow(PaymentError);
  });
});

describe("the webhook signature", () => {
  const body = JSON.stringify({ event: "subscription.charged", payload: {} });
  const reference = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

  it("is HMAC-SHA256 of the raw body with the WEBHOOK secret", () => {
    expect(webhookSignatureMatches(body, reference)).toBe(true);
  });

  // Signing the check with the API key secret rejects every genuine delivery,
  // and the symptom is a webhook that silently never fires.
  it("is not the API key secret", () => {
    const wrongKey = createHmac("sha256", API_SECRET).update(body).digest("hex");
    expect(wrongKey).not.toBe(reference);
    expect(webhookSignatureMatches(body, wrongKey)).toBe(false);
  });

  // The reason the route reads text() and parses afterwards. Re-serialising
  // changes key order and whitespace, and the digest changes with it.
  it("does not survive a parse-and-reserialise of the body", () => {
    const round = JSON.stringify(JSON.parse(`{"b":1,"a":2}`));
    const original = `{"b":1, "a":2}`;
    const signed = createHmac("sha256", WEBHOOK_SECRET).update(original).digest("hex");
    expect(round).not.toBe(original);
    expect(webhookSignatureMatches(round, signed)).toBe(false);
    expect(webhookSignatureMatches(original, signed)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(webhookSignatureMatches(`${body} `, reference)).toBe(false);
  });

  it.each([[undefined], [null], [12345]])("rejects a non-string signature (%s)", (signature) => {
    expect(webhookSignatureMatches(body, signature)).toBe(false);
  });

  it("throws rather than returning false when no secret is configured", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    // Razorpay should retry a delivery we could not check, and never retry one
    // we checked and rejected. Those need different answers, so they need
    // different outcomes here.
    expect(() => webhookSignatureMatches(body, reference)).toThrow(PaymentError);
  });
});

describe("what the endpoints accept", () => {
  it("takes a plan and an interval, and nothing else", () => {
    const parsed = billingCheckoutSchema.parse({
      planId: "intelligent",
      interval: "yearly",
      // Everything a buyer would like to choose for themselves.
      amount: 100,
      currency: "USD",
      plan_id: "plan_cheap",
      status: "ACTIVE",
      userId: "someone-else",
    });
    expect(parsed).toEqual({ planId: "intelligent", interval: "yearly" });
  });

  it("refuses the free plan and an unknown interval", () => {
    expect(billingCheckoutSchema.safeParse({ planId: "free", interval: "monthly" }).success).toBe(
      false
    );
    expect(billingCheckoutSchema.safeParse({ planId: "pro", interval: "weekly" }).success).toBe(
      false
    );
    expect(billingCheckoutSchema.safeParse({}).success).toBe(false);
  });

  const valid = {
    razorpay_payment_id: PAY,
    razorpay_subscription_id: SUB,
    razorpay_signature: "a".repeat(64),
  };

  it("takes the three fields a subscription checkout returns", () => {
    expect(billingVerifySchema.safeParse(valid).success).toBe(true);
  });

  it.each(Object.keys(valid))("refuses a body missing %s", (field) => {
    const body = { ...valid };
    delete body[field];
    expect(billingVerifySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ["an order id where a subscription id belongs", { razorpay_subscription_id: "order_Q1aBcD" }],
    ["a subscription id with the payment prefix", { razorpay_subscription_id: "pay_Q1aBcD" }],
    ["a payment id with the subscription prefix", { razorpay_payment_id: "sub_Q1aBcD" }],
    ["a signature that is not hex", { razorpay_signature: "z".repeat(64) }],
    ["a signature of the wrong length", { razorpay_signature: "a".repeat(63) }],
    ["an upper-case signature", { razorpay_signature: "A".repeat(64) }],
  ])("refuses %s", (_label, override) => {
    expect(billingVerifySchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});
