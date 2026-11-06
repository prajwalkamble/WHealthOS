import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@whealthos/database";
import { createHmac, randomUUID } from "node:crypto";

// The subscription confirmation email, end to end against a real database.
//
// The point is not that one email goes out. It is that EXACTLY one does: not
// two when Razorpay retries a delivery, not two when the webhook and the
// browser callback land together, not another one at renewal, and not one at
// all for a payment that was never verified. Those properties live in a
// unique index and in the order the writes happen, so they are tested against
// Postgres rather than against a fake.

let currentClerkId = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: currentClerkId }),
  currentUser: async () => null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn) => fn,
}));

vi.mock("@arcjet/next", () => ({
  request: async () => ({}),
  default: () => ({ protect: async () => ({ isDenied: () => false }) }),
  tokenBucket: () => ({}),
  shield: () => ({}),
  detectBot: () => ({}),
}));

vi.mock("@/lib/arcjet", () => ({ enforceRateLimit: async () => {} }));

// The job runner, captured rather than called. Nothing in these tests reaches
// Inngest, and the events it would have raised are asserted directly.
const raised = [];
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: async (event) => {
      raised.push(event);
      return { ids: ["evt_test"] };
    },
    createFunction: () => ({}),
  },
}));

// Resend, mocked throughout: no test may send real mail.
const sent = [];
let nextResult = { data: { id: "re_test_message" }, error: null };
vi.mock("resend", () => ({
  Resend: class {
    constructor() {
      this.emails = {
        send: async (options) => {
          sent.push(options);
          if (nextResult instanceof Error) throw nextResult;
          return nextResult;
        },
      };
    }
  },
}));

const API_SECRET = "api_secret_not_a_real_key";
const WEBHOOK_SECRET = "webhook_secret_not_a_real_key";

process.env.RAZORPAY_KEY_ID = "rzp_test_0000000000000";
process.env.RAZORPAY_KEY_SECRET = API_SECRET;
process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_test_0000000000000";
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.RAZORPAY_PLAN_PRO_MONTHLY = "plan_pro_monthly";
process.env.RAZORPAY_PLAN_PRO_YEARLY = "plan_pro_yearly";
process.env.RAZORPAY_PLAN_INTELLIGENT_MONTHLY = "plan_int_monthly";
process.env.RAZORPAY_PLAN_INTELLIGENT_YEARLY = "plan_int_yearly";
process.env.RESEND_API_KEY = "re_fake_key_for_tests";
process.env.RESEND_FROM_EMAIL = "WHealthOS <hello@whealthos.com>";
process.env.SITE_URL = "https://www.whealthos.test";

const { __setClient } = await import("@/lib/payments/razorpay");
const service = await import("@/lib/billing/service");
const { processEvent } = await import("@/lib/billing/webhook");
const { POST: razorpayWebhook } = await import("@/app/api/webhooks/razorpay/route");
const { deliverActivation, MAX_ATTEMPTS } = await import("@/lib/notifications/deliver");
const { recordDeliveryEvent } = await import("@/lib/email/delivery");
const {
  queueActivationNotification,
  staleQueued,
  subscriptionsMissingNotification,
} = await import("@/lib/notifications/subscription-activated");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

// A fake Razorpay. Nothing here reaches the network.
const remote = new Map();
const fakeClient = {
  subscriptions: {
    create: async ({ plan_id, notes }) => {
      const id = `sub_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
      remote.set(id, {
        id,
        plan_id,
        status: "created",
        notes,
        created_at: Math.floor(Date.now() / 1000),
        current_start: null,
        current_end: null,
        cancel_at_cycle_end: false,
      });
      return remote.get(id);
    },
    all: async () => ({ items: [...remote.values()] }),
    fetch: async (id) => {
      const found = remote.get(id);
      if (!found) {
        const error = new Error("not found");
        error.statusCode = 400;
        throw error;
      }
      return found;
    },
    cancel: async (id) => {
      const found = remote.get(id);
      found.cancel_at_cycle_end = true;
      return found;
    },
    update: async (id, { plan_id }) => {
      const found = remote.get(id);
      found.plan_id = plan_id;
      return found;
    },
  },
};

const seconds = (date) => Math.floor(date.getTime() / 1000);

const providerSays = (id, status, { start, end, cancelAtCycleEnd } = {}) => {
  const found = remote.get(id);
  found.status = status;
  if (start !== undefined) found.current_start = start ? seconds(start) : null;
  if (end !== undefined) found.current_end = end ? seconds(end) : null;
  if (cancelAtCycleEnd !== undefined) found.cancel_at_cycle_end = cancelAtCycleEnd;
  return found;
};

const delivery = (event, subscriptionId, extra = {}) => ({
  event,
  created_at: seconds(new Date()),
  payload: {
    subscription: { entity: remote.get(subscriptionId) ?? { id: subscriptionId } },
    ...extra,
  },
});

const signWebhook = (raw, secret = WEBHOOK_SECRET) =>
  createHmac("sha256", secret).update(raw).digest("hex");

const webhookRequest = (body, { signature, eventId = `evt_${randomUUID()}` } = {}) => {
  const raw = JSON.stringify(body);
  return new Request("https://www.whealthos.test/api/webhooks/razorpay", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature ?? signWebhook(raw),
      "x-razorpay-event-id": eventId,
    },
  });
};

let alice;
let bob;

const makeUser = (label) =>
  admin.user.create({
    data: {
      clerkUserId: `clerk_${label}_${randomUUID()}`,
      email: `${label}-${randomUUID()}@example.test`,
      name: `${label} Example`,
      imageUrl: "https://example.test/avatar.png",
    },
  });

const wipe = async () => {
  await admin.subscriptionNotification.deleteMany({});
  await admin.billingEvent.deleteMany({});
  await admin.payment.deleteMany({});
  await admin.subscription.deleteMany({});
  await admin.checkoutAttempt.deleteMany({});
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
};

beforeAll(() => {
  __setClient(fakeClient);
});

beforeEach(async () => {
  await wipe();
  remote.clear();
  raised.length = 0;
  sent.length = 0;
  nextResult = { data: { id: `re_${randomUUID()}` }, error: null };

  alice = await makeUser("alice");
  bob = await makeUser("bob");
  currentClerkId = alice.clerkUserId;
});

afterAll(async () => {
  await wipe();
  await admin.$disconnect();
  const { db, adminDb } = await import("@/lib/prisma");
  await db.$disconnect();
  await adminDb.$disconnect();
});

const PERIOD_END = () => new Date(Date.now() + 30 * 86_400_000);

// Takes a plan through a verified payment, the way production does: the
// provider says active, and a signed webhook delivery records it.
const activate = async ({
  user = null,
  planId = "pro",
  interval = "monthly",
  payment = true,
} = {}) => {
  const owner = user ?? alice;
  const previous = currentClerkId;
  currentClerkId = owner.clerkUserId;
  try {
    const checkout = await service.startCheckout({
      userId: owner.id,
      planId,
      interval,
    });
    providerSays(checkout.subscriptionId, "active", {
      start: new Date(),
      end: PERIOD_END(),
    });
    const body = delivery(
      payment ? "subscription.charged" : "subscription.activated",
      checkout.subscriptionId,
      payment
        ? {
            payment: {
              entity: {
                id: `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
                status: "captured",
                amount: 39900,
                currency: "INR",
                created_at: seconds(new Date()),
              },
            },
          }
        : {}
    );
    const response = await razorpayWebhook(webhookRequest(body));
    expect(response.status).toBe(200);
    return checkout;
  } finally {
    currentClerkId = previous;
  }
};

const notifications = () =>
  admin.subscriptionNotification.findMany({ orderBy: { createdAt: "asc" } });

// --- The trigger -------------------------------------------------------------

describe("a verified activation queues exactly one confirmation", () => {
  it("records the notification and asks the job runner to send it", async () => {
    await activate();

    const rows = await notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe("SUBSCRIPTION_ACTIVATED");
    expect(rows[0].status).toBe("QUEUED");
    expect(rows[0].userId).toBe(alice.id);
    expect(rows[0].recipientEmail).toBe(alice.email);

    expect(raised).toHaveLength(1);
    expect(raised[0].name).toBe("subscription.confirmation.send");
    expect(raised[0].data.notificationId).toBe(rows[0].id);
  });

  // §10.8. The address is read from the account, never from the payload.
  it("addresses it to the account that owns the subscription", async () => {
    await activate({ user: bob });
    const rows = await notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(bob.id);
    expect(rows[0].recipientEmail).toBe(bob.email);
    expect(rows[0].recipientEmail).not.toBe(alice.email);
  });
});

describe("what must not produce a confirmation", () => {
  // §10.2. The route rejects the delivery before anything is written, so the
  // subscription never activates and no notification exists.
  it("does not send one for a delivery whose signature does not verify", async () => {
    const checkout = await service.startCheckout({
      userId: alice.id,
      planId: "pro",
      interval: "monthly",
    });
    providerSays(checkout.subscriptionId, "active", {
      start: new Date(),
      end: PERIOD_END(),
    });

    const response = await razorpayWebhook(
      webhookRequest(delivery("subscription.charged", checkout.subscriptionId), {
        signature: signWebhook("tampered", "the-wrong-secret"),
      })
    );

    expect(response.status).toBe(400);
    expect(await notifications()).toHaveLength(0);
    expect(raised).toHaveLength(0);
  });

  // §10.3 and §10.11. A failed charge leaves the subscription PAST_DUE, and
  // an unpaid one PENDING. Neither is a purchase to confirm.
  it.each([
    ["pending", "a charge that failed"],
    ["created", "a mandate that was never charged"],
  ])("does not send one for %s", async (providerStatus) => {
    const checkout = await service.startCheckout({
      userId: alice.id,
      planId: "pro",
      interval: "monthly",
    });
    providerSays(checkout.subscriptionId, providerStatus);
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.pending", checkout.subscriptionId),
    });

    expect(await notifications()).toHaveLength(0);
    expect(raised).toHaveLength(0);
  });

  // §10.11, stated directly. The browser callback is signature-checked and
  // then asks Razorpay what is true; a redirect for a subscription the
  // provider still calls `created` confirms nothing.
  it("cannot be triggered by a checkout redirect alone", async () => {
    const checkout = await service.startCheckout({
      userId: alice.id,
      planId: "pro",
      interval: "monthly",
    });
    // The provider has NOT been paid. Only the browser claims otherwise.
    const paymentId = `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const signature = createHmac("sha256", API_SECRET)
      .update(`${paymentId}|${checkout.subscriptionId}`)
      .digest("hex");

    const result = await service.confirmCheckout({
      userId: alice.id,
      paymentId,
      providerSubscriptionId: checkout.subscriptionId,
      signature,
    });

    expect(result.active).toBe(false);
    expect(await notifications()).toHaveLength(0);
    expect(raised).toHaveLength(0);
  });
});

// --- Idempotency -------------------------------------------------------------

describe("exactly one, however many times the event arrives", () => {
  // §10.4.
  it("does not duplicate when Razorpay redelivers the same event", async () => {
    const checkout = await activate();
    const body = delivery("subscription.charged", checkout.subscriptionId);
    const eventId = `evt_${randomUUID()}`;

    await razorpayWebhook(webhookRequest(body, { eventId }));
    await razorpayWebhook(webhookRequest(body, { eventId }));

    expect(await notifications()).toHaveLength(1);
    expect(raised).toHaveLength(1);
  });

  // The webhook and the browser callback landing together is the normal
  // case, not the rare one.
  it("does not duplicate when a second, different event arrives for the same subscription", async () => {
    const checkout = await activate();
    await razorpayWebhook(
      webhookRequest(delivery("subscription.activated", checkout.subscriptionId))
    );

    expect(await notifications()).toHaveLength(1);
  });

  // §10.12. A renewal is another charge on a subscription that is already
  // ACTIVE. It must not read as a new purchase.
  it("does not confirm again when the subscription renews", async () => {
    const checkout = await activate();
    expect(await notifications()).toHaveLength(1);

    providerSays(checkout.subscriptionId, "active", {
      start: new Date(Date.now() + 30 * 86_400_000),
      end: new Date(Date.now() + 60 * 86_400_000),
    });
    await razorpayWebhook(
      webhookRequest(
        delivery("subscription.charged", checkout.subscriptionId, {
          payment: {
            entity: {
              id: `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
              status: "captured",
              amount: 39900,
              currency: "INR",
              created_at: seconds(new Date()),
            },
          },
        })
      )
    );

    expect(await notifications()).toHaveLength(1);
    expect(raised).toHaveLength(1);
  });

  // Two callers racing on the same activation. The unique index is what
  // settles it; nothing in the application counts rows first.
  it("survives two concurrent attempts to queue the same activation", async () => {
    const checkout = await activate();
    const subscription = await admin.subscription.findUnique({
      where: { providerSubscriptionId: checkout.subscriptionId },
    });
    await admin.subscriptionNotification.deleteMany({});

    const results = await Promise.all([
      queueActivationNotification(subscription),
      queueActivationNotification(subscription),
      queueActivationNotification(subscription),
    ]);

    expect(await notifications()).toHaveLength(1);
    expect(results.filter((r) => r.queued)).toHaveLength(1);
  });
});

// --- Sending -----------------------------------------------------------------

describe("sending the confirmation", () => {
  const queuedId = async () => (await notifications())[0].id;

  // §10.1 and §10.10.
  it("sends one email carrying the plan, the amount, the currency and the dates", async () => {
    await activate();
    const result = await deliverActivation(await queuedId());

    expect(result.accepted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(alice.email);
    expect(sent[0].subject).toBe("Your WHealthOS Subscription is Confirmed!");

    // Both parts, from the same model.
    expect(sent[0].text).toContain("Pro");
    expect(sent[0].text).toContain("₹399.00");
    expect(sent[0].text).toContain("Monthly");
    expect(sent[0].text).toContain("pay_");
    expect(sent[0].react).toBeTruthy();

    const row = (await notifications())[0];
    // ACCEPTED, not DELIVERED: an id back from Resend is not evidence that
    // anybody received it.
    expect(row.status).toBe("ACCEPTED");
    expect(row.providerMessageId).toBe(nextResult.data.id);
    expect(row.acceptedAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(1);
  });

  it("does not send a second copy if the job runs twice", async () => {
    await activate();
    const id = await queuedId();
    await deliverActivation(id);
    const second = await deliverActivation(id);

    expect(sent).toHaveLength(1);
    expect(second.sent).toBe(false);
    expect(second.reason).toContain("ACCEPTED");
  });

  // §10.5. The subscription is already active and entitled; the email is a
  // separate concern that is allowed to fail on its own.
  it("leaves the subscription active and entitled when the provider is down", async () => {
    const checkout = await activate();
    nextResult = { data: null, error: { name: "application_error", message: "upstream" } };

    await expect(deliverActivation(await queuedId())).rejects.toThrow();

    const subscription = await admin.subscription.findUnique({
      where: { providerSubscriptionId: checkout.subscriptionId },
    });
    expect(subscription.status).toBe("ACTIVE");
    const { effectivePlanId } = service;
    expect(await effectivePlanId(alice.id)).toBe("pro");
  });

  // §10.6.
  it("records a transient failure, stays retryable, and succeeds on the retry", async () => {
    await activate();
    const id = await queuedId();

    nextResult = { data: null, error: { name: "application_error", message: "upstream" } };
    await expect(deliverActivation(id)).rejects.toThrow();

    let row = (await notifications())[0];
    expect(row.status).toBe("QUEUED");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBeTruthy();

    nextResult = { data: { id: "re_second_attempt" }, error: null };
    const retry = await deliverActivation(id);

    expect(retry.accepted).toBe(true);
    row = (await notifications())[0];
    expect(row.status).toBe("ACCEPTED");
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBeNull();
  });

  // The distinction the retry policy turns on: an upstream error at the
  // provider is transient and is retried, a rejected ADDRESS is not. Getting
  // this the other way round either throws away a paid subscriber's
  // confirmation over a blip, or retries a malformed address five times.
  it("does not retry a message the provider refused on its merits", async () => {
    await activate();
    const id = await queuedId();
    nextResult = {
      data: null,
      error: { name: "validation_error", message: "to must be a valid email" },
    };

    const result = await deliverActivation(id);

    expect(result.terminal).toBe(true);
    const row = (await notifications())[0];
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
  });

  it("keeps retrying while the provider itself is the problem", async () => {
    await activate();
    const id = await queuedId();

    for (const name of ["application_error", "internal_server_error", "rate_limit_exceeded"]) {
      nextResult = { data: null, error: { name, message: "upstream" } };
      await expect(deliverActivation(id)).rejects.toThrow();
      expect((await notifications())[0].status).toBe("QUEUED");
    }

    expect((await notifications())[0].attempts).toBe(3);
  });

  // §10.7. A misconfigured sender never becomes deliverable by waiting.
  it("records a permanent failure once, without retrying it", async () => {
    await activate();
    const id = await queuedId();
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const result = await deliverActivation(id);
      expect(result.terminal).toBe(true);
    } finally {
      process.env.RESEND_API_KEY = key;
    }

    const row = (await notifications())[0];
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.attempts).toBeLessThan(MAX_ATTEMPTS);
    expect(row.failedAt).toBeInstanceOf(Date);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for an account with no email address", async () => {
    const mute = await admin.user.create({
      data: {
        clerkUserId: `clerk_mute_${randomUUID()}`,
        email: null,
        name: "No Address",
        imageUrl: "https://example.test/avatar.png",
      },
    });
    try {
      await activate({ user: mute });
      const row = (await notifications())[0];
      expect(row.status).toBe("SKIPPED");
      expect(row.recipientEmail).toBeNull();
      expect(sent).toHaveLength(0);
      // Skipped is terminal: nothing asks the job runner to try it.
      expect(raised).toHaveLength(0);
    } finally {
      await admin.user.delete({ where: { id: mute.id } });
    }
  });

  it("does not confirm a subscription that has been cancelled since activation", async () => {
    const checkout = await activate();
    const id = await notifications().then((rows) => rows[0].id);
    providerSays(checkout.subscriptionId, "cancelled", { end: null });
    await service.syncFromProvider(checkout.subscriptionId);

    const result = await deliverActivation(id);
    expect(result.sent).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await notifications())[0].status).toBe("SKIPPED");
  });
});

// --- Delivery outcomes -------------------------------------------------------

describe("what the provider says happened afterwards", () => {
  const accepted = async () => {
    await activate();
    const id = (await notifications())[0].id;
    await deliverActivation(id);
    return (await notifications())[0];
  };

  it("records a delivery against the message it belongs to", async () => {
    const row = await accepted();
    const outcome = await recordDeliveryEvent({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: row.providerMessageId },
    });

    expect(outcome.applied).toBe(true);
    const after = (await notifications())[0];
    expect(after.status).toBe("DELIVERED");
    expect(after.deliveredAt).toBeInstanceOf(Date);
  });

  it("records a bounce as a failure to deliver", async () => {
    const row = await accepted();
    await recordDeliveryEvent({
      type: "email.bounced",
      data: { email_id: row.providerMessageId },
    });
    expect((await notifications())[0].status).toBe("BOUNCED");
  });

  // Provider webhooks are retried for days and arrive out of order.
  it("does not walk a delivered message back to delayed", async () => {
    const row = await accepted();
    await recordDeliveryEvent({
      type: "email.delivered",
      data: { email_id: row.providerMessageId },
    });
    const late = await recordDeliveryEvent({
      type: "email.delivery_delayed",
      data: { email_id: row.providerMessageId },
    });

    expect(late.applied).toBe(false);
    expect((await notifications())[0].status).toBe("DELIVERED");
  });

  // Every other email WHealthOS sends produces these events too.
  it("ignores an event about a message that is not a subscription notification", async () => {
    const outcome = await recordDeliveryEvent({
      type: "email.delivered",
      data: { email_id: "re_some_other_email" },
    });
    expect(outcome.matched).toBe(false);
  });
});

// --- Recovery ----------------------------------------------------------------

describe("the reconciling sweep", () => {
  // The crash this exists for: the subscription was saved and the process
  // died before the notification was recorded.
  it("finds an active subscription that has no notification at all", async () => {
    await activate();
    await admin.subscriptionNotification.deleteMany({});
    raised.length = 0;

    const missing = await subscriptionsMissingNotification();
    expect(missing).toHaveLength(1);

    await queueActivationNotification(missing[0]);
    expect(await notifications()).toHaveLength(1);
    expect(raised).toHaveLength(1);
  });

  // The interlock that stops the first sweep after deployment emailing every
  // existing subscriber. The migration backfills exactly this row.
  it("leaves alone a subscription whose notification was deliberately skipped", async () => {
    await activate();
    await admin.subscriptionNotification.updateMany({ data: { status: "SKIPPED" } });

    expect(await subscriptionsMissingNotification()).toHaveLength(0);
  });

  it("does not re-queue a subscription that has already been confirmed", async () => {
    await activate();
    await deliverActivation((await notifications())[0].id);

    expect(await subscriptionsMissingNotification()).toHaveLength(0);
  });

  // The other crash: the row was written and the event never reached the job
  // runner.
  it("re-queues a notification that has sat unsent", async () => {
    await activate();
    const fresh = await staleQueued(50, new Date());
    expect(fresh).toHaveLength(0);

    const later = new Date(Date.now() + 60 * 60_000);
    const stale = await staleQueued(50, later);
    expect(stale).toHaveLength(1);
  });

  it("does not re-queue one that has already been accepted", async () => {
    await activate();
    await deliverActivation((await notifications())[0].id);

    const later = new Date(Date.now() + 60 * 60_000);
    expect(await staleQueued(50, later)).toHaveLength(0);
  });
});
