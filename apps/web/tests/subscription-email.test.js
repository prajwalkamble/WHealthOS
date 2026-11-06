import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import SubscriptionConfirmationEmail from "@/emails/subscription-confirmation";
import { formatMinorUnits } from "@/lib/billing/money";
import { planFeatures } from "@/lib/billing/plans";
import { isDeliveryEvent } from "@/lib/email/delivery";
import {
  NOTIFICATION_EVENT,
  NOTIFICATION_STATUS,
  advancesTo,
  idempotencyKeyFor,
} from "@/lib/notifications/outbox";
import { SUBJECT, activationText } from "@/lib/notifications/subscription-email";

// The subscription confirmation email, without a database.
//
// Everything here is about what the email SAYS. Whether exactly one is sent,
// and what happens when sending fails, is a property of the outbox table and
// is tested against a real Postgres in tests/notification-integration.test.js
// -- a faked unique constraint would prove nothing about the constraint that
// actually has to hold.

const MODEL = {
  userName: "Asha Menon",
  recipientEmail: "asha@example.com",
  planName: "Pro",
  statusLabel: "Active",
  startDate: "02 Nov 2026",
  renewalDate: "02 Dec 2026",
  renews: true,
  billingCycle: "Monthly",
  renewalCadence: "every month",
  amount: "₹399.00",
  currency: "INR",
  paidOn: "02 Nov 2026",
  paymentReference: "pay_TestReference123",
  features: planFeatures("pro"),
  links: {
    dashboard: "https://www.whealthos.com/dashboard",
    manage: "https://www.whealthos.com/settings",
    terms: "https://www.whealthos.com/terms",
    privacy: "https://www.whealthos.com/privacy",
  },
  supportEmail: "hello@whealthos.com",
};

const html = (model = MODEL) => render(SubscriptionConfirmationEmail({ model }));

describe("the subject line", () => {
  it("is the one the brief specifies, exactly", () => {
    expect(SUBJECT).toBe("Your WHealthOS Subscription is Confirmed!");
  });
});

describe("what the email states", () => {
  it("confirms the subscription is active", async () => {
    expect(await html()).toContain("subscription is now active");
  });

  it("names the plan, the cycle, the dates and what was charged", async () => {
    const body = await html();
    for (const value of [
      "Pro",
      "Monthly",
      "02 Nov 2026",
      "02 Dec 2026",
      "₹399.00",
      "pay_TestReference123",
      "asha@example.com",
    ]) {
      expect(body, `missing ${value}`).toContain(value);
    }
  });

  it("addresses the subscriber by name", async () => {
    expect(await html()).toContain("Asha Menon");
  });

  it("links the dashboard, the management page and both policies", async () => {
    const body = await html();
    expect(body).toContain("https://www.whealthos.com/dashboard");
    expect(body).toContain("https://www.whealthos.com/settings");
    expect(body).toContain("https://www.whealthos.com/terms");
    expect(body).toContain("https://www.whealthos.com/privacy");
    expect(body).toContain("Go to WHealthOS Dashboard");
  });

  it("gives the support address from the existing configuration", async () => {
    expect(await html()).toContain("hello@whealthos.com");
  });
});

// §3: "Only display information that has been verified and is applicable. Do
// not invent billing dates or calculate renewal dates from assumptions."
describe("fields that could not be established", () => {
  it("omits the renewal line rather than guessing a date", async () => {
    const body = await html({ ...MODEL, renewalDate: null });
    expect(body).not.toContain("Renews on");
    // ...and the rest of the email still renders.
    expect(body).toContain("Pro");
  });

  it("omits the amount rather than printing zero", async () => {
    const body = await html({ ...MODEL, amount: null, paidOn: null });
    expect(body).not.toContain("Amount paid");
    expect(body).not.toContain("0.00");
  });

  it("omits the payment reference when no charge has been recorded", async () => {
    expect(await html({ ...MODEL, paymentReference: null })).not.toContain(
      "Payment reference"
    );
  });

  // A subscription told to stop at the end of the period is still paid for,
  // but "Renews on" would be a false statement about it.
  it("says access-until rather than renews-on when it will not renew", async () => {
    const body = await html({ ...MODEL, renews: false });
    expect(body).toContain("Access until");
    expect(body).not.toContain("Renews on");
  });
});

describe("feature copy comes from the registry", () => {
  it("lists what the tier adds, in the registry's own words", async () => {
    const { added } = planFeatures("pro");
    const body = await html();
    expect(added.length).toBeGreaterThan(0);
    for (const feature of added) expect(body).toContain(feature.label);
  });

  // The guard against the template growing its own marketing copy, which is
  // how the email and the pricing page come to disagree about what is sold.
  it("does not restate features the matrix does not list", async () => {
    const labels = new Set(planFeatures("pro").added.map((f) => f.label));
    expect(labels.has("Budgets")).toBe(true);
    const body = await html({ ...MODEL, features: { added: [], inherited: [] } });
    expect(body).not.toContain("Budgets");
  });
});

describe("the plain-text alternative", () => {
  it("carries the same figures as the HTML", () => {
    const text = activationText(MODEL);
    for (const value of ["Pro", "₹399.00", "02 Dec 2026", "pay_TestReference123"]) {
      expect(text).toContain(value);
    }
  });

  it("gives the links as URLs, since there is nothing to click", () => {
    const text = activationText(MODEL);
    expect(text).toContain("https://www.whealthos.com/dashboard");
    expect(text).toContain("https://www.whealthos.com/settings");
  });

  it("leaves out the same fields the HTML leaves out", () => {
    const text = activationText({ ...MODEL, amount: null, paymentReference: null });
    expect(text).not.toContain("Amount paid");
    expect(text).not.toContain("Payment reference");
  });
});

// §7. None of these should ever be reachable from the model, but the email is
// the one artefact that leaves the system, so it is asserted rather than
// assumed.
describe("what must never be in the email", () => {
  it("carries no key, token, signature or secret", async () => {
    const body = (await html()) + activationText(MODEL);
    for (const forbidden of ["rzp_test", "rzp_live", "re_", "sk_", "signature", "secret", "Bearer "]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("escapes a name that contains markup", async () => {
    const body = await html({ ...MODEL, userName: '<script>alert("x")</script>' });
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

// §8. The amount comes from the payment record, in the currency that record
// carries, and the divisor is the currency's own minor-unit exponent.
describe("money is formatted from the payment's own currency", () => {
  it.each([
    [39900, "INR", "₹399.00"],
    [1999, "USD", "$19.99"],
    // No minor unit at all: a hard-coded /100 would understate this by a
    // factor of a hundred. The yen sign is the FULLWIDTH one, because the
    // amount is formatted in ja-JP -- each currency is written in its own
    // convention now, not in "en". That is a deliberate change from the
    // en-everything formatting this test was written against.
    [123456, "JPY", "￥123,456"],
  ])("formats %i %s as %s", (minor, currency, expected) => {
    expect(formatMinorUnits(minor, currency)).toBe(expected);
  });

  it("prints nothing rather than zero when the amount is missing", () => {
    expect(formatMinorUnits(null, "INR")).toBeNull();
    expect(formatMinorUnits(undefined, "INR")).toBeNull();
  });

  it("prints nothing rather than a bare number when the currency is missing", () => {
    expect(formatMinorUnits(39900, null)).toBeNull();
    expect(formatMinorUnits(39900, "")).toBeNull();
  });
});

describe("the idempotency key", () => {
  it("is the same string for the same activation, every time", () => {
    const a = idempotencyKeyFor("sub-1", NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED);
    const b = idempotencyKeyFor("sub-1", NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED);
    expect(a).toBe(b);
  });

  it("separates one subscription from another, and one event from another", () => {
    expect(idempotencyKeyFor("sub-1", "SUBSCRIPTION_ACTIVATED")).not.toBe(
      idempotencyKeyFor("sub-2", "SUBSCRIPTION_ACTIVATED")
    );
    expect(idempotencyKeyFor("sub-1", "SUBSCRIPTION_ACTIVATED")).not.toBe(
      idempotencyKeyFor("sub-1", "SUBSCRIPTION_RENEWED")
    );
  });
});

// Provider webhooks arrive out of order and are retried for days.
describe("a delivery status only ever moves forward", () => {
  it("advances through the lifecycle", () => {
    expect(advancesTo(NOTIFICATION_STATUS.QUEUED, NOTIFICATION_STATUS.ACCEPTED)).toBe(true);
    expect(advancesTo(NOTIFICATION_STATUS.ACCEPTED, NOTIFICATION_STATUS.DELIVERED)).toBe(true);
    expect(advancesTo(NOTIFICATION_STATUS.DELIVERED, NOTIFICATION_STATUS.COMPLAINED)).toBe(true);
  });

  it("refuses to walk backwards when a delayed event is redelivered late", () => {
    expect(advancesTo(NOTIFICATION_STATUS.DELIVERED, NOTIFICATION_STATUS.DELAYED)).toBe(false);
    expect(advancesTo(NOTIFICATION_STATUS.ACCEPTED, NOTIFICATION_STATUS.QUEUED)).toBe(false);
  });

  it("keeps the first terminal outcome when a second one of equal rank arrives", () => {
    expect(advancesTo(NOTIFICATION_STATUS.DELIVERED, NOTIFICATION_STATUS.BOUNCED)).toBe(false);
    expect(advancesTo(NOTIFICATION_STATUS.BOUNCED, NOTIFICATION_STATUS.DELIVERED)).toBe(false);
  });
});

describe("which Resend events are acted on", () => {
  it.each(["email.delivered", "email.bounced", "email.complained", "email.delivery_delayed"])(
    "recognises %s",
    (type) => {
      expect(isDeliveryEvent(type)).toBe(true);
    }
  );

  // Recognised so the endpoint acknowledges them, but deliberately not
  // recorded: both need a tracking pixel or a rewritten link, and neither
  // says anything about delivery.
  it("acknowledges open and click without tracking them", () => {
    expect(isDeliveryEvent("email.opened")).toBe(true);
    expect(isDeliveryEvent("email.clicked")).toBe(true);
  });

  it("leaves inbound mail to the inbound handler", () => {
    expect(isDeliveryEvent("email.received")).toBe(false);
  });
});
