import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@whealthos/database";
import { createHmac, randomUUID } from "node:crypto";

// Billing, end to end against a real database.
//
// The point is not that the happy path works. It is that the browser cannot
// talk its way into a paid plan: not by sending an amount, not by naming
// someone else's subscription, not by forging a callback, not by clicking
// twice, and not by replaying a webhook.

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
process.env.BILLING_ENFORCEMENT = "on";

const { __setClient } = await import("@/lib/payments/razorpay");
const service = await import("@/lib/billing/service");
const { processEvent } = await import("@/lib/billing/webhook");
const { requireFeature } = await import("@/lib/billing/guard");
const { EntitlementError } = await import("@/lib/billing/entitlements");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

// A fake Razorpay. Every test states what the provider says; nothing here
// reaches the network, and no test consumes a real API call.
const remote = new Map();
let created = 0;
let fetched = 0;

const fakeClient = {
  subscriptions: {
    create: async ({ plan_id, notes }) => {
      created += 1;
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
    // What reconciliation reads after a create call that never answered.
    // Bounded the way the real one is, and it is the `notes` this looks
    // through -- nothing else ties an orphan to the attempt that made it.
    all: async ({ from = null, count = 100 } = {}) => ({
      items: [...remote.values()]
        .filter((item) => !from || (item.created_at ?? 0) >= from)
        .slice(0, count),
    }),
    fetch: async (id) => {
      fetched += 1;
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
    // A plan change, as Razorpay actually performs it.
    //
    // `schedule_change_at: "cycle_end"` does NOT move the subscription's
    // plan_id. The subscription keeps running on the plan it is on, keeps
    // being charged for it, and the new plan is recorded as a change that
    // will happen -- which is why this fake records it separately instead of
    // assigning plan_id. A fake that applied it at once would make the whole
    // flow pass while the real thing left the account on the old plan until
    // the cycle turned, and that difference IS the feature.
    update: async (id, { plan_id, schedule_change_at }) => {
      const found = remote.get(id);
      if (schedule_change_at === "cycle_end") {
        found.has_scheduled_changes = true;
        found.pending_plan_id = plan_id;
      } else {
        found.plan_id = plan_id;
      }
      return found;
    },
  },
};

// The cycle turning: Razorpay charges the next period and, if a plan change
// was scheduled, this is the moment it takes effect.
const renews = (id, { start = new Date(), end = new Date(Date.now() + 30 * 86_400_000) } = {}) => {
  const found = remote.get(id);
  if (found.has_scheduled_changes && found.pending_plan_id) {
    found.plan_id = found.pending_plan_id;
    found.has_scheduled_changes = false;
    found.pending_plan_id = null;
  }
  found.status = "active";
  found.current_start = seconds(start);
  found.current_end = seconds(end);
  return found;
};

const seconds = (date) => Math.floor(date.getTime() / 1000);

// Moves the provider's copy of a subscription on, the way a real one would.
const providerSays = (id, status, { start, end, cancelAtCycleEnd } = {}) => {
  const found = remote.get(id);
  found.status = status;
  if (start !== undefined) found.current_start = start ? seconds(start) : null;
  if (end !== undefined) found.current_end = end ? seconds(end) : null;
  if (cancelAtCycleEnd !== undefined) found.cancel_at_cycle_end = cancelAtCycleEnd;
  return found;
};

const signCheckout = (paymentId, subscriptionId) =>
  createHmac("sha256", API_SECRET).update(`${paymentId}|${subscriptionId}`).digest("hex");

const delivery = (event, subscriptionId, extra = {}) => ({
  event,
  created_at: seconds(new Date()),
  payload: {
    subscription: { entity: remote.get(subscriptionId) ?? { id: subscriptionId } },
    ...extra,
  },
});

let alice;
let bob;

const makeUser = async (label) =>
  admin.user.create({
    data: {
      clerkUserId: `clerk_${label}_${randomUUID()}`,
      email: `${label}-${randomUUID()}@example.test`,
      name: label,
      imageUrl: "https://example.test/avatar.png",
    },
  });

beforeAll(() => {
  __setClient(fakeClient);
});

beforeEach(async () => {
  await admin.billingEvent.deleteMany({});
  await admin.payment.deleteMany({});
  await admin.subscription.deleteMany({});
  await admin.checkoutAttempt.deleteMany({});
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
  remote.clear();
  created = 0;
  fetched = 0;

  alice = await makeUser("alice");
  bob = await makeUser("bob");
  currentClerkId = alice.clerkUserId;
});

afterAll(async () => {
  await admin.billingEvent.deleteMany({});
  await admin.payment.deleteMany({});
  await admin.subscription.deleteMany({});
  await admin.checkoutAttempt.deleteMany({});
  await admin.user.deleteMany({ where: { email: { contains: "@example.test" } } });
  await admin.$disconnect();
  const { db, adminDb } = await import("@/lib/prisma");
  await db.$disconnect();
  await adminDb.$disconnect();
});

const subscribe = (userId = alice.id, planId = "pro", interval = "monthly") =>
  service.startCheckout({ userId, planId, interval });

// Opening a checkout no longer writes a subscription -- that is the whole
// point of the attempt row -- so a test that needs a LIVE subscription has to
// take it through a payment. This is the shortest honest route: the provider
// says active, and a verified webhook records it.
const activated = async (userId = alice.id, planId = "pro", interval = "monthly") => {
  const previous = currentClerkId;
  const owner = userId === bob.id ? bob : alice;
  currentClerkId = owner.clerkUserId;
  try {
    const checkout = await service.startCheckout({ userId, planId, interval });
    providerSays(checkout.subscriptionId, "active", {
      start: new Date(),
      end: new Date(Date.now() + 30 * 86_400_000),
    });
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.activated", checkout.subscriptionId),
    });
    return checkout;
  } finally {
    currentClerkId = previous;
  }
};

// Ages a row past refreshConfirming's backoff window, so a test does not have
// to wait five real seconds to prove the next poll reaches the provider.
const makeRowStale = async (providerSubscriptionId) => {
  const when = new Date(Date.now() - 60_000);
  await admin.$executeRawUnsafe(
    `UPDATE public.subscriptions SET "updatedAt" = $1 WHERE "providerSubscriptionId" = $2`,
    when, providerSubscriptionId
  );
  await admin.$executeRawUnsafe(
    `UPDATE public.checkout_attempts SET "updatedAt" = $1 WHERE "providerSubscriptionId" = $2`,
    when, providerSubscriptionId
  );
};

const attemptFor = (userId = alice.id) =>
  admin.checkoutAttempt.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

describe("opening a subscription", () => {
  it("prices the plan on the server, whatever the caller thinks", async () => {
    const checkout = await subscribe();
    // 399 rupees, in paise. Not a number anybody sent.
    expect(checkout.amount).toBe(39_900);
    expect(checkout.currency).toBe("INR");

    const attempt = await attemptFor();
    expect(attempt.amount).toBe(39_900);
    expect(attempt.currency).toBe("INR");
    expect(attempt.providerPlanId).toBe("plan_pro_monthly");
    expect(attempt.status).toBe("CREATED");
    expect(attempt.providerSubscriptionId).toBe(checkout.subscriptionId);
  });

  // The ordering that makes a lost response survivable: the row exists before
  // the provider is called, so there is something for a retry to find.
  it("records the attempt before Razorpay is called", async () => {
    await subscribe();
    const attempt = await attemptFor();
    expect(attempt.createdAt.getTime()).toBeLessThanOrEqual(
      (remote.get(attempt.providerSubscriptionId).created_at + 1) * 1000
    );
    // And the provider carries the attempt id, which is the only thing that
    // can identify an orphan later.
    expect(remote.get(attempt.providerSubscriptionId).notes.whealthos_attempt).toBe(
      attempt.id
    );
  });

  // Nothing is a subscription until it has been paid for. A PENDING row
  // written at checkout used to occupy the one-live-per-user slot, which is
  // why a dismissed payment window locked the account out of buying anything.
  it("writes no subscription row until there is a payment", async () => {
    await subscribe();
    expect(await admin.subscription.count({ where: { userId: alice.id } })).toBe(0);
    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });

  it("refuses a plan with no Razorpay plan configured", async () => {
    delete process.env.RAZORPAY_PLAN_INTELLIGENT_YEARLY;
    await expect(subscribe(alice.id, "intelligent", "yearly")).rejects.toMatchObject({
      code: "PLAN_UNAVAILABLE",
      status: 400,
    });
    process.env.RAZORPAY_PLAN_INTELLIGENT_YEARLY = "plan_int_yearly";
  });

  it("refuses a second subscription while one is live", async () => {
    await activated();
    await expect(subscribe(alice.id, "intelligent", "monthly")).rejects.toMatchObject({
      code: "SUBSCRIPTION_EXISTS",
      status: 409,
    });
    expect(created).toBe(1);
  });

  it("refuses the plan they are already on, and says which problem it is", async () => {
    await activated(alice.id, "pro", "monthly");
    await expect(subscribe(alice.id, "pro", "monthly")).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
      status: 409,
    });
  });

  // Two clicks, or two tabs. The service check cannot catch this; the partial
  // unique index on checkout_attempts can.
  it("will not reconcile an attempt that is still in flight", async () => {
    // The race that produced two subscriptions. A second request arriving
    // while the first is mid-call at Razorpay must not read "no subscription
    // id yet" as "that call failed" -- it has to wait.
    const attempt = await admin.checkoutAttempt.create({
      data: {
        userId: alice.id,
        planId: "pro",
        interval: "MONTHLY",
        providerPlanId: "plan_pro_monthly",
        amount: 39_900,
        currency: "INR",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    await expect(subscribe()).rejects.toMatchObject({
      code: "CHECKOUT_IN_PROGRESS",
      status: 409,
    });
    // Nothing opened, and the first request's attempt is untouched.
    expect(created).toBe(0);
    expect(await admin.checkoutAttempt.findUnique({ where: { id: attempt.id } }))
      .toMatchObject({ status: "OPEN" });
  });

  it("opens one subscription when three requests race", async () => {
    const results = await Promise.allSettled([subscribe(), subscribe(), subscribe()]);

    // The invariant that matters is not how many callers were answered. It is
    // that ONE subscription exists at the provider: a request that arrives
    // while another is mid-flight either loses the unique index and is told
    // to wait, or finds the attempt and is handed the same subscription. Both
    // are correct; a second charge is not.
    expect(created).toBe(1);

    const attempts = await admin.checkoutAttempt.findMany({
      where: { userId: alice.id, status: { in: ["OPEN", "CREATED"] } },
    });
    expect(attempts).toHaveLength(1);

    const answered = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value.subscriptionId);
    expect(answered.length).toBeGreaterThan(0);
    expect(new Set(answered).size).toBe(1);
    expect(answered[0]).toBe(attempts[0].providerSubscriptionId);

    // Anybody who was refused was told to wait, not that something broke.
    for (const loser of results.filter((r) => r.status === "rejected")) {
      expect(loser.reason).toMatchObject({ code: "CHECKOUT_IN_PROGRESS", status: 409 });
    }
  });

  it("lets somebody subscribe again after one has ended", async () => {
    const first = await activated();
    await admin.subscription.update({
      where: { providerSubscriptionId: first.subscriptionId },
      data: { status: "CANCELLED", currentEnd: new Date(Date.now() - 1000) },
    });
    await expect(subscribe()).resolves.toBeTruthy();
  });
});

// The behaviour a disabled button cannot provide, and the reason the attempt
// row exists at all.
describe("a checkout that is tried more than once", () => {
  it("hands back the same subscription on a second click", async () => {
    const first = await subscribe();
    const second = await subscribe();

    expect(second.subscriptionId).toBe(first.subscriptionId);
    expect(second.resumed).toBe(true);
    // One subscription at Razorpay, which is the only number that matters.
    expect(created).toBe(1);
    expect(await admin.checkoutAttempt.count({ where: { userId: alice.id } })).toBe(1);
  });

  // Closing the payment window used to leave a PENDING subscription that
  // blocked every later purchase. Now it leaves a resumable attempt.
  it("reopens the same payment after the window was dismissed", async () => {
    const first = await subscribe();
    // Dismissal is a browser event; nothing changes on either side.
    const again = await subscribe();
    expect(again.subscriptionId).toBe(first.subscriptionId);
    expect(created).toBe(1);
  });

  // The invariant, hammered.
  //
  // This exists because the race it protects was found by accident: a slow
  // machine widened the window and a test that was passing began to fail.
  // How many callers get an answer is not the point and is allowed to vary --
  // what must never vary is the number of subscriptions that end up at
  // Razorpay, because each extra one is a mandate somebody can be charged on.
  it("opens exactly one subscription however many callers arrive at once", async () => {
    const callers = Array.from({ length: 10 }, () => subscribe());
    const results = await Promise.allSettled(callers);

    expect(created, "more than one subscription was opened at the provider").toBe(1);

    const open = await admin.checkoutAttempt.findMany({
      where: { userId: alice.id, status: { in: ["OPEN", "CREATED"] } },
    });
    expect(open).toHaveLength(1);

    const answered = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value.subscriptionId);
    expect(new Set(answered).size).toBeLessThanOrEqual(1);

    // Everybody who was refused was told to wait, not that something broke.
    // A 500 here would mean a caller saw an unhandled error from a race.
    for (const refused of results.filter((r) => r.status === "rejected")) {
      expect(refused.reason.status, refused.reason.message).toBe(409);
      expect(["CHECKOUT_IN_PROGRESS", "ALREADY_SUBSCRIBED", "SUBSCRIPTION_EXISTS"])
        .toContain(refused.reason.code);
    }
  });

  it("lets somebody change their mind before paying", async () => {
    const pro = await subscribe(alice.id, "pro", "monthly");
    const intelligent = await subscribe(alice.id, "intelligent", "yearly");

    expect(intelligent.subscriptionId).not.toBe(pro.subscriptionId);
    expect(created).toBe(2);

    const abandoned = await admin.checkoutAttempt.findUnique({
      where: { providerSubscriptionId: pro.subscriptionId },
    });
    expect(abandoned.status).toBe("ABANDONED");
    expect(abandoned.failureCode).toBe("SUPERSEDED");

    const live = await admin.checkoutAttempt.findMany({
      where: { userId: alice.id, status: { in: ["OPEN", "CREATED"] } },
    });
    expect(live).toHaveLength(1);
    expect(live[0].planId).toBe("intelligent");
  });

  it("starts fresh once an attempt has expired", async () => {
    const first = await subscribe();
    await admin.checkoutAttempt.updateMany({
      where: { userId: alice.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await subscribe();
    expect(second.subscriptionId).not.toBe(first.subscriptionId);

    const stale = await admin.checkoutAttempt.findUnique({
      where: { providerSubscriptionId: first.subscriptionId },
    });
    expect(stale).toMatchObject({ status: "ABANDONED", failureCode: "EXPIRED" });
  });

  // The failure the old ordering could not survive: Razorpay created the
  // subscription and the answer never arrived. Razorpay's subscriptions API
  // has no idempotency key, so the only way to avoid charging twice is to go
  // and look for the orphan.
  it("adopts a subscription created by a request that timed out", async () => {
    // An attempt that got as far as writing its row, and an orphan at the
    // provider carrying its id -- exactly what a timed-out create leaves.
    //
    // Aged past the in-flight window on purpose: a NEW attempt with no
    // subscription id is a request still running, and reconciling one of
    // those is how two subscriptions get created. See CREATE_IN_FLIGHT_MS.
    const attempt = await admin.checkoutAttempt.create({
      data: {
        userId: alice.id,
        planId: "pro",
        interval: "MONTHLY",
        providerPlanId: "plan_pro_monthly",
        amount: 39_900,
        currency: "INR",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date(Date.now() - 120_000),
      },
    });

    const orphanId = "sub_orphanedbytimeout";
    remote.set(orphanId, {
      id: orphanId,
      plan_id: "plan_pro_monthly",
      status: "created",
      notes: { whealthos_attempt: attempt.id },
      created_at: Math.floor(Date.now() / 1000),
      current_start: null,
      current_end: null,
      cancel_at_cycle_end: false,
    });

    const retry = await subscribe();

    expect(retry.subscriptionId).toBe(orphanId);
    expect(retry.resumed).toBe(true);
    // Nothing new was opened at the provider.
    expect(created).toBe(0);

    const adopted = await admin.checkoutAttempt.findUnique({ where: { id: attempt.id } });
    expect(adopted).toMatchObject({ status: "CREATED", providerSubscriptionId: orphanId });
  });

  it("opens a new one when the timed-out request really did fail", async () => {
    const attempt = await admin.checkoutAttempt.create({
      data: {
        userId: alice.id,
        planId: "pro",
        interval: "MONTHLY",
        providerPlanId: "plan_pro_monthly",
        amount: 39_900,
        currency: "INR",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date(Date.now() - 120_000),
      },
    });

    // No orphan: the call never reached Razorpay.
    const retry = await subscribe();
    expect(retry.subscriptionId).toMatch(/^sub_/);
    expect(created).toBe(1);

    const closed = await admin.checkoutAttempt.findUnique({ where: { id: attempt.id } });
    expect(closed).toMatchObject({ status: "ABANDONED", failureCode: "NOT_CREATED" });
  });

  // Paid in another tab, or on a phone, while this page still showed the
  // button. Selling it a second time is the one answer that is not allowed.
  it("refuses to sell again what has already been paid for", async () => {
    const first = await subscribe();
    providerSays(first.subscriptionId, "active", {
      start: new Date(),
      end: new Date(Date.now() + 30 * 86_400_000),
    });

    await expect(subscribe()).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
      status: 409,
    });
    expect(created).toBe(1);
    // ...and the payment that did happen is recorded rather than lost.
    expect(await service.effectivePlanId(alice.id)).toBe("pro");
  });

  it("does not let one account resume another account's attempt", async () => {
    currentClerkId = bob.clerkUserId;
    const bobs = await subscribe(bob.id);
    currentClerkId = alice.clerkUserId;

    const alices = await subscribe(alice.id);
    expect(alices.subscriptionId).not.toBe(bobs.subscriptionId);
    expect(created).toBe(2);
  });
});

describe("confirming a checkout", () => {
  it("rejects a forged signature and grants nothing", async () => {
    const checkout = await subscribe();
    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });

    await expect(
      service.confirmCheckout({
        userId: alice.id,
        paymentId: "pay_forged",
        providerSubscriptionId: checkout.subscriptionId,
        signature: "0".repeat(64),
      })
    ).rejects.toMatchObject({ code: "SIGNATURE_MISMATCH", status: 400 });

    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });

  // A signature proves the payment is real. It does not prove it is yours.
  it("rejects a valid signature for somebody else's subscription", async () => {
    currentClerkId = bob.clerkUserId;
    const bobs = await subscribe(bob.id);
    currentClerkId = alice.clerkUserId;

    const signature = signCheckout("pay_real", bobs.subscriptionId);
    providerSays(bobs.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });

    await expect(
      service.confirmCheckout({
        userId: alice.id,
        paymentId: "pay_real",
        providerSubscriptionId: bobs.subscriptionId,
        signature,
      })
    ).rejects.toMatchObject({ code: "NOT_YOUR_SUBSCRIPTION", status: 403 });

    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });

  // The callback is signed and genuine, but Razorpay has not charged anything
  // yet. A signed callback is not an active subscription.
  it("does not grant access when the provider still says created", async () => {
    const checkout = await subscribe();
    const result = await service.confirmCheckout({
      userId: alice.id,
      paymentId: "pay_real",
      providerSubscriptionId: checkout.subscriptionId,
      signature: signCheckout("pay_real", checkout.subscriptionId),
    });

    expect(result.verified).toBe(true);
    expect(result.active).toBe(false);
    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });

  it("grants access once the provider says active", async () => {
    const checkout = await subscribe();
    providerSays(checkout.subscriptionId, "active", {
      start: new Date(),
      end: new Date(Date.now() + 30 * 86_400_000),
    });

    const result = await service.confirmCheckout({
      userId: alice.id,
      paymentId: "pay_real",
      providerSubscriptionId: checkout.subscriptionId,
      signature: signCheckout("pay_real", checkout.subscriptionId),
    });

    expect(result.active).toBe(true);
    expect(await service.effectivePlanId(alice.id)).toBe("pro");
  });
});

describe("webhooks", () => {
  const activate = async (id) => {
    providerSays(id, "active", {
      start: new Date(),
      end: new Date(Date.now() + 30 * 86_400_000),
    });
    return processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.activated", id) });
  };

  it("applies an activation and grants the plan", async () => {
    const checkout = await subscribe();
    const result = await activate(checkout.subscriptionId);

    expect(result.applied).toBe(true);
    expect(await service.effectivePlanId(alice.id)).toBe("pro");
  });

  it("processes a repeated delivery exactly once", async () => {
    const checkout = await subscribe();
    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });

    const eventId = `evt_${randomUUID()}`;
    const body = delivery("subscription.activated", checkout.subscriptionId);

    const first = await processEvent({ eventId, body });
    const second = await processEvent({ eventId, body });
    const third = await processEvent({ eventId, body });

    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ applied: false, reason: "duplicate" });
    expect(third).toMatchObject({ applied: false, reason: "duplicate" });

    expect(await admin.billingEvent.count({ where: { providerEventId: eventId } })).toBe(1);
  });

  it("records a charge once, however many times it is delivered", async () => {
    const checkout = await subscribe();
    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });

    const payment = {
      payment: { entity: { id: "pay_charged_1", amount: 39_900, currency: "INR", status: "captured", created_at: seconds(new Date()) } },
    };

    for (const _ of [1, 2, 3]) {
      await processEvent({
        eventId: `evt_${randomUUID()}`,
        body: delivery("subscription.charged", checkout.subscriptionId, payment),
      });
    }

    const payments = await admin.payment.findMany({});
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(39_900);
    expect(payments[0].status).toBe("CAPTURED");
  });

  it("ignores a delivery for a subscription it does not know", async () => {
    const result = await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: { event: "subscription.activated", created_at: seconds(new Date()), payload: { subscription: { entity: { id: "sub_fromAnotherEnvironment" } } } },
    });
    expect(result).toMatchObject({ applied: false, reason: "unknown-subscription" });
  });

  it("records an event type it does not act on, without failing", async () => {
    const checkout = await subscribe();
    const result = await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("payment.dispute.created", checkout.subscriptionId),
    });
    expect(result).toMatchObject({ applied: false, reason: "unhandled" });
    expect(await admin.billingEvent.count({ where: { status: "IGNORED" } })).toBe(1);
  });

  // Deliveries arrive out of order and are retried for days. No event's
  // payload is ever the source of state -- the provider is asked -- so a stale
  // delivery cannot undo a newer one.
  it("does not let a stale delivery overwrite a newer verified state", async () => {
    const checkout = await subscribe();
    const stale = delivery("subscription.pending", checkout.subscriptionId);

    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });
    await activate(checkout.subscriptionId);
    expect(await service.effectivePlanId(alice.id)).toBe("pro");

    // The old "a charge failed" delivery turns up late, carrying its old
    // payload. Razorpay still says active, so nothing changes.
    await processEvent({ eventId: `evt_${randomUUID()}`, body: stale });

    const row = await admin.subscription.findFirst({ where: { userId: alice.id } });
    expect(row.status).toBe("ACTIVE");
    expect(await service.effectivePlanId(alice.id)).toBe("pro");
  });

  it("follows the provider down to past due, and keeps the paid period", async () => {
    const checkout = await subscribe();
    await activate(checkout.subscriptionId);

    providerSays(checkout.subscriptionId, "halted", { end: new Date(Date.now() + 86_400_000) });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.halted", checkout.subscriptionId) });

    const row = await admin.subscription.findFirst({ where: { userId: alice.id } });
    expect(row.status).toBe("PAST_DUE");
    // Still inside the period that was paid for.
    expect(await service.effectivePlanId(alice.id)).toBe("pro");

    // And once that period ends, back to Free. No grace period.
    providerSays(checkout.subscriptionId, "halted", { end: new Date(Date.now() - 1000) });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.halted", checkout.subscriptionId) });
    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });
});

// The browser is not the only way a payment is reported, and on a closed tab
// it is not any way at all.
describe("a webhook that arrives before the browser callback", () => {
  it("establishes the subscription from the checkout attempt", async () => {
    const checkout = await subscribe();
    // No confirmCheckout call at all: the tab was closed the moment the
    // payment went through.
    expect(await admin.subscription.count({ where: { userId: alice.id } })).toBe(0);

    providerSays(checkout.subscriptionId, "active", {
      start: new Date(),
      end: new Date(Date.now() + 30 * 86_400_000),
    });
    const result = await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.activated", checkout.subscriptionId),
    });

    expect(result.applied).toBe(true);

    const row = await admin.subscription.findFirst({ where: { userId: alice.id } });
    // Everything that decides money or access came from our own attempt row,
    // not from the event payload and not from the provider's notes.
    expect(row).toMatchObject({
      planId: "pro",
      interval: "MONTHLY",
      amount: 39_900,
      currency: "INR",
      providerPlanId: "plan_pro_monthly",
      status: "ACTIVE",
    });
    expect(await service.effectivePlanId(alice.id)).toBe("pro");
  });

  it("closes the attempt, so another checkout is possible later", async () => {
    const checkout = await activated();

    const attempt = await admin.checkoutAttempt.findUnique({
      where: { providerSubscriptionId: checkout.subscriptionId },
    });
    expect(attempt.status).toBe("COMPLETED");

    // The lockout this prevents: with the attempt left in flight, cancelling
    // and resubscribing would be refused for ever by the one-open-per-user
    // index.
    await admin.subscription.update({
      where: { providerSubscriptionId: checkout.subscriptionId },
      data: { status: "CANCELLED", currentEnd: new Date(Date.now() - 1000) },
    });
    await expect(subscribe()).resolves.toBeTruthy();
  });

  it("will not sell anything once the mandate is authorised", async () => {
    const checkout = await subscribe();
    // The mandate was authorised; Razorpay takes the first charge from here
    // on its own, so there is nothing for a second click to reopen.
    providerSays(checkout.subscriptionId, "authenticated");
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.authenticated", checkout.subscriptionId),
    });

    // The row exists and grants nothing, which is the state the message has
    // to describe honestly -- "you already have this plan" would be false.
    const row = await admin.subscription.findFirst({ where: { userId: alice.id } });
    expect(row.status).toBe("PENDING");
    expect(await service.effectivePlanId(alice.id)).toBe("free");

    await expect(subscribe()).rejects.toMatchObject({
      code: "AWAITING_FIRST_PAYMENT",
      status: 409,
    });
    expect(created).toBe(1);

    // ...and the review page says that rather than offering to sell it again.
    expect(
      await service.checkoutState({
        userId: alice.id,
        planId: "pro",
        interval: "monthly",
        availability: { ready: true },
      })
    ).toMatchObject({ state: "confirming" });
  });

  it("abandons the attempt when the mandate was never authorised", async () => {
    const checkout = await subscribe();
    providerSays(checkout.subscriptionId, "expired");
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.expired", checkout.subscriptionId),
    });

    const attempt = await admin.checkoutAttempt.findUnique({
      where: { providerSubscriptionId: checkout.subscriptionId },
    });
    expect(attempt).toMatchObject({ status: "ABANDONED", failureCode: "EXPIRED_UNPAID" });
    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });

  it("confirms a callback that arrives after the webhook already landed", async () => {
    const checkout = await activated();
    // The browser finally reports in. It must not double-record anything, and
    // it must still answer honestly.
    const result = await service.confirmCheckout({
      userId: alice.id,
      paymentId: "pay_late",
      providerSubscriptionId: checkout.subscriptionId,
      signature: signCheckout("pay_late", checkout.subscriptionId),
    });

    expect(result).toMatchObject({ verified: true, active: true, planId: "pro" });
    expect(await admin.subscription.count({ where: { userId: alice.id } })).toBe(1);
  });
});

describe("what the confirmation page is told", () => {
  it("says it is confirming while a payment is in flight", async () => {
    await subscribe();
    const summary = await service.billingSummary(alice.id);
    expect(summary).toMatchObject({ planId: "free", confirming: true });
    expect(summary.attempt).toMatchObject({ planId: "pro", status: "CREATED" });
  });

  it("stops saying so once the subscription is established", async () => {
    await activated();
    const summary = await service.billingSummary(alice.id);
    expect(summary.planId).toBe("pro");
    expect(summary.confirming).toBe(false);
  });

  it("says nothing is in flight for an account that has done nothing", async () => {
    const summary = await service.billingSummary(alice.id);
    expect(summary).toMatchObject({ planId: "free", confirming: false, attempt: null });
  });
});

// A webhook is not guaranteed to arrive. In development it never does --
// Razorpay cannot reach localhost -- and in production a delivery can be
// delayed, fail, or be sent to an endpoint whose secret has changed.
// Razorpay rejecting OUR credentials is an operator problem. It must not
// reach the browser wearing the clothes of a session problem.
describe("when the merchant credentials are rejected", () => {
  it("answers 503, not 401", async () => {
    const real = fakeClient.subscriptions.create;
    fakeClient.subscriptions.create = async () => {
      const error = new Error("Authentication failed");
      error.statusCode = 401;
      throw error;
    };

    try {
      await expect(subscribe()).rejects.toMatchObject({
        code: "UPSTREAM_UNAUTHORIZED",
        // A 401 from this application's own API means "your session is not
        // valid". Saying that when the real cause is a wrong key secret sends
        // whoever is debugging it to the wrong system entirely -- which is
        // exactly what happened before this was changed.
        status: 503,
      });
    } finally {
      fakeClient.subscriptions.create = real;
    }
  });

  it("says nothing about the merchant account to the caller", async () => {
    const real = fakeClient.subscriptions.create;
    fakeClient.subscriptions.create = async () => {
      const error = new Error("boom");
      error.statusCode = 401;
      // Razorpay's descriptions are written for a developer and can name the
      // account. They are logged, never returned.
      error.error = { description: "Authentication failed for merchant acc_SECRET" };
      throw error;
    };

    try {
      await subscribe();
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error.message).toBe("Payments are not available just now.");
      expect(error.message).not.toMatch(/merchant|acc_/i);
    } finally {
      fakeClient.subscriptions.create = real;
    }
  });

  it("leaves no half-finished attempt behind", async () => {
    const real = fakeClient.subscriptions.create;
    fakeClient.subscriptions.create = async () => {
      const error = new Error("Authentication failed");
      error.statusCode = 401;
      throw error;
    };

    try {
      await subscribe().catch(() => {});
    } finally {
      fakeClient.subscriptions.create = real;
    }

    // A refusal is not a timeout: the credentials were rejected outright, so
    // nothing was created and the slot is freed rather than held for a
    // reconciliation that would find nothing.
    const attempt = await attemptFor();
    expect(attempt).toMatchObject({ status: "FAILED" });

    // ...and once the credentials are fixed, checkout works immediately.
    await expect(subscribe()).resolves.toMatchObject({ resumed: false });
  });
});

describe("confirming without a webhook", () => {
  it("asks Razorpay when the status endpoint is polled", async () => {
    const checkout = await subscribe();
    // The browser callback came back while Razorpay still said `created`.
    await service.confirmCheckout({
      userId: alice.id,
      paymentId: "pay_first",
      providerSubscriptionId: checkout.subscriptionId,
      signature: signCheckout("pay_first", checkout.subscriptionId),
    });

    let summary = await service.billingSummary(alice.id);
    expect(summary).toMatchObject({ planId: "free", confirming: true });

    // The charge lands at Razorpay. No webhook is delivered.
    providerSays(checkout.subscriptionId, "active", {
      start: new Date(),
      end: new Date(Date.now() + 30 * 86_400_000),
    });

    // Reading the database alone still says nothing has changed...
    summary = await service.billingSummary(alice.id);
    expect(summary.planId).toBe("free");

    // ...and the status endpoint's refresh finds it.
    await makeRowStale(checkout.subscriptionId);
    const refreshed = await service.refreshConfirming(alice.id);
    expect(refreshed.planId).toBe("pro");
    expect(refreshed.confirming).toBe(false);
    expect(await service.effectivePlanId(alice.id)).toBe("pro");
  });

  it("does not ask again within the backoff window", async () => {
    const checkout = await subscribe();
    await service.confirmCheckout({
      userId: alice.id,
      paymentId: "pay_first",
      providerSubscriptionId: checkout.subscriptionId,
      signature: signCheckout("pay_first", checkout.subscriptionId),
    });

    // Two tabs polling together must not become two upstream calls.
    const before = fetched;
    await service.refreshConfirming(alice.id);
    await service.refreshConfirming(alice.id);
    expect(fetched - before).toBeLessThanOrEqual(1);
  });

  it("asks nothing at all when there is nothing in flight", async () => {
    const before = fetched;
    const summary = await service.refreshConfirming(alice.id);
    expect(summary).toMatchObject({ planId: "free", confirming: false });
    expect(fetched).toBe(before);
  });

  it("keeps answering honestly when the provider cannot be reached", async () => {
    const checkout = await subscribe();
    await service.confirmCheckout({
      userId: alice.id,
      paymentId: "pay_first",
      providerSubscriptionId: checkout.subscriptionId,
      signature: signCheckout("pay_first", checkout.subscriptionId),
    });
    await makeRowStale(checkout.subscriptionId);

    // Razorpay is down. A status check must not become an error -- the page
    // keeps polling, and the stale answer it already had is still honest.
    remote.delete(checkout.subscriptionId);
    const summary = await service.refreshConfirming(alice.id);
    expect(summary).toMatchObject({ planId: "free", confirming: true });
  });
});

describe("what the review page decides", () => {
  const state = (planId, interval, availability = { ready: true }) =>
    service.checkoutState({ userId: alice.id, planId, interval, availability });

  it("is ready for a plan this deployment sells", async () => {
    expect(await state("pro", "monthly")).toMatchObject({ state: "ready" });
  });

  it("refuses what is not in the catalogue", async () => {
    expect(await state("admin", "monthly")).toMatchObject({ state: "no-selection" });
    expect(await state("pro", "weekly")).toMatchObject({ state: "no-selection" });
    expect(await state(null, null)).toMatchObject({ state: "no-selection" });
  });

  it("separates an unconfigured plan from an unknown one", async () => {
    delete process.env.RAZORPAY_PLAN_INTELLIGENT_YEARLY;
    const resolved = await state("intelligent", "yearly");
    expect(resolved.state).toBe("unavailable");
    // Still priced from our own catalogue, so the page can name the plan.
    expect(resolved.entry.amountRupees).toBe(6710);
    process.env.RAZORPAY_PLAN_INTELLIGENT_YEARLY = "plan_int_yearly";
  });

  it("will not offer to sell a plan somebody is already on", async () => {
    await activated(alice.id, "pro", "monthly");
    expect(await state("pro", "monthly")).toMatchObject({ state: "already-on-plan" });
  });

  it("offers a Pro subscriber a one-step upgrade to Intelligent", async () => {
    await activated(alice.id, "pro", "monthly");
    const resolved = await state("intelligent", "monthly");
    expect(resolved.state).toBe("upgrade");
    expect(resolved.subscription.planId).toBe("pro");
    expect(resolved.upgrade).toMatchObject({ from: "pro" });
    // The date the change lands is the end of the period already paid for --
    // not today, and not computed by the page.
    expect(resolved.upgrade.effectiveFrom).toBeInstanceOf(Date);
    expect(resolved.upgrade.effectiveFrom.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not offer a downgrade as a one-step move", async () => {
    await activated(alice.id, "intelligent", "monthly");
    const resolved = await state("pro", "monthly");
    // Still the two-step panel. A move down mid-period is the case that would
    // need a part-period refund, and there is no policy for one.
    expect(resolved.state).toBe("other-plan");
  });

  it("does not offer a change of billing period as a one-step move", async () => {
    await activated(alice.id, "pro", "monthly");
    const resolved = await state("pro", "yearly");
    expect(resolved.state).toBe("other-plan");
  });

  it("will not offer an upgrade from a subscription that is not active", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    providerSays(checkout.subscriptionId, "halted");
    await service.syncFromProvider(checkout.subscriptionId);
    const resolved = await state("intelligent", "monthly");
    expect(resolved.state).toBe("other-plan");
  });

  it("reports an upgrade already asked for instead of offering it again", async () => {
    await activated(alice.id, "pro", "monthly");
    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });

    const resolved = await state("intelligent", "monthly");
    expect(resolved.state).toBe("upgrade-scheduled");
    // Named and priced from the stored schedule, so the screen can say what
    // is coming and what it will cost.
    expect(resolved.scheduled).toMatchObject({ planId: "intelligent", name: "Intelligent" });
    expect(resolved.subscription.scheduledPlanId).toBe("intelligent");
  });

  it("mentions a resumable attempt rather than looking like a second charge", async () => {
    await subscribe(alice.id, "pro", "monthly");
    const resolved = await state("pro", "monthly");
    expect(resolved.state).toBe("ready");
    expect(resolved.attempt).toMatchObject({ planId: "pro" });
  });

  it("does not leak the provider plan id into what the page renders", async () => {
    const resolved = await state("pro", "monthly");
    const { displayEntry } = await import("@/lib/billing/plans");
    expect(resolved.entry.providerPlanId).toBe("plan_pro_monthly");
    expect(JSON.stringify(displayEntry(resolved.entry))).not.toContain("plan_pro_monthly");
  });
});

describe("entitlements follow the verified subscription", () => {
  it("gives a free account none of the paid features", async () => {
    await expect(requireFeature(alice.id, "budgets")).rejects.toBeInstanceOf(EntitlementError);
    await expect(requireFeature(alice.id, "analytics")).rejects.toBeInstanceOf(EntitlementError);
    await expect(requireFeature(alice.id, "ai.queries")).rejects.toBeInstanceOf(EntitlementError);
  });

  it("gives Pro the Pro features and not the Intelligent ones", async () => {
    const checkout = await subscribe(alice.id, "pro", "monthly");
    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.activated", checkout.subscriptionId) });

    await expect(requireFeature(alice.id, "budgets")).resolves.toBe("pro");
    await expect(requireFeature(alice.id, "dashboard.basic")).resolves.toBe("pro");
    await expect(requireFeature(alice.id, "ai.queries")).rejects.toBeInstanceOf(EntitlementError);
  });

  it("gives Intelligent all three tiers", async () => {
    const checkout = await subscribe(alice.id, "intelligent", "monthly");
    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.activated", checkout.subscriptionId) });

    for (const key of ["dashboard.basic", "budgets", "analytics", "data.export", "ai.queries"]) {
      await expect(requireFeature(alice.id, key)).resolves.toBe("intelligent");
    }
  });

  it("does not leak one account's plan to another", async () => {
    const checkout = await subscribe(alice.id, "intelligent", "monthly");
    providerSays(checkout.subscriptionId, "active", { end: new Date(Date.now() + 86_400_000) });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.activated", checkout.subscriptionId) });

    expect(await service.effectivePlanId(alice.id)).toBe("intelligent");
    expect(await service.effectivePlanId(bob.id)).toBe("free");
    await expect(requireFeature(bob.id, "ai.queries")).rejects.toBeInstanceOf(EntitlementError);
  });
});

describe("cancelling", () => {
  it("keeps the period already paid for, then returns to Free", async () => {
    const checkout = await subscribe();
    const end = new Date(Date.now() + 86_400_000);
    providerSays(checkout.subscriptionId, "active", { end });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.activated", checkout.subscriptionId) });

    await service.requestCancellation(alice.id);

    const row = await admin.subscription.findFirst({ where: { userId: alice.id } });
    expect(row.status).toBe("CANCEL_SCHEDULED");
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(await service.effectivePlanId(alice.id)).toBe("pro");

    providerSays(checkout.subscriptionId, "cancelled", { end: new Date(Date.now() - 1000) });
    await processEvent({ eventId: `evt_${randomUUID()}`, body: delivery("subscription.cancelled", checkout.subscriptionId) });
    expect(await service.effectivePlanId(alice.id)).toBe("free");
  });

  it("refuses to cancel what does not exist", async () => {
    await expect(service.requestCancellation(alice.id)).rejects.toMatchObject({
      code: "NO_SUBSCRIPTION",
      status: 404,
    });
  });
});

// --- The Pro-to-Intelligent upgrade -----------------------------------------
//
// Built 2026-11-11. One step, applied at the end of the period already paid
// for, and no money moves at the moment somebody asks for it.
//
// What these tests are really about is the gap between asking and arriving.
// That gap is weeks long, it is the whole of the product decision behind this
// feature, and it is where every way of getting this wrong lives: granting
// Intelligent on the click, losing the request before the cycle turns, writing
// the new plan at Razorpay and never writing it here, or announcing it twice.
//
// The fake provider models `schedule_change_at: "cycle_end"` the way Razorpay
// does -- the subscription's plan_id does not move until renews() is called --
// because a fake that applied the change at once would make all of this pass
// while the real thing left the account on Pro.
describe("upgrading a live Pro subscription to Intelligent", () => {
  const notificationsFor = (subscriptionRowId) =>
    admin.subscriptionNotification.findMany({
      where: { subscriptionId: subscriptionRowId },
      select: { event: true, idempotencyKey: true, status: true },
      orderBy: { queuedAt: "asc" },
    });

  const rowFor = (providerSubscriptionId) =>
    admin.subscription.findUnique({ where: { providerSubscriptionId } });

  it("schedules the change at the provider without moving the plan", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");

    const result = await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });

    expect(result).toMatchObject({ scheduled: true, planId: "intelligent", from: "pro" });

    // Razorpay was told, and told the right way: scheduled, not immediate.
    const provider = remote.get(checkout.subscriptionId);
    expect(provider.has_scheduled_changes).toBe(true);
    expect(provider.pending_plan_id).toBe("plan_int_monthly");
    expect(provider.plan_id, "the live plan must not move yet").toBe("plan_pro_monthly");

    // And our row records the request without claiming it has happened.
    const row = await rowFor(checkout.subscriptionId);
    expect(row.planId, "entitlement must still be Pro").toBe("pro");
    expect(row.scheduledPlanId).toBe("intelligent");
    expect(row.scheduledInterval).toBe("MONTHLY");
    expect(row.scheduledChangeAt).toBeInstanceOf(Date);
  });

  it("keeps Pro access and withholds Intelligent until the change lands", async () => {
    await activated(alice.id, "pro", "monthly");
    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });

    // §8 of the brief, and the half that is easy to get wrong: asking for an
    // upgrade must not grant it. They are still paying the Pro price for this
    // period, so they still have exactly Pro.
    await expect(service.effectivePlanId(alice.id)).resolves.toBe("pro");
    await expect(requireFeature(alice.id, "budgets")).resolves.toBe("pro");
    await expect(requireFeature(alice.id, "dashboard.basic")).resolves.toBe("pro");
    await expect(requireFeature(alice.id, "ai.queries")).rejects.toBeInstanceOf(
      EntitlementError
    );
  });

  it("moves the plan, and the entitlements with it, when the cycle turns", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });

    // The cycle turns and Razorpay charges the new plan. This is the only
    // moment the upgrade becomes real, and it reaches us as a webhook.
    renews(checkout.subscriptionId);
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.charged", checkout.subscriptionId, {
        payment: {
          entity: {
            id: `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
            status: "captured",
            amount: 129_900,
            currency: "INR",
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      }),
    });

    const row = await rowFor(checkout.subscriptionId);
    // The defect this feature could not have shipped without: before
    // syncFromProvider learned to write planId, this stayed "pro" for ever
    // while Razorpay charged the Intelligent price.
    expect(row.planId).toBe("intelligent");
    expect(row.providerPlanId).toBe("plan_int_monthly");
    expect(row.status).toBe("ACTIVE");

    // The schedule is spent, so no screen goes on promising a change that has
    // already happened.
    expect(row.scheduledPlanId).toBeNull();
    expect(row.scheduledInterval).toBeNull();
    expect(row.scheduledChangeAt).toBeNull();

    // And the entitlement follows the row, through the same engine every
    // other surface authorises against.
    await expect(service.effectivePlanId(alice.id)).resolves.toBe("intelligent");
    await expect(requireFeature(alice.id, "ai.queries")).resolves.toBe("intelligent");
    await expect(requireFeature(alice.id, "budgets")).resolves.toBe("intelligent");
  });

  it("announces the change exactly once, under its own event", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    const before = await rowFor(checkout.subscriptionId);
    expect(await notificationsFor(before.id)).toHaveLength(1);

    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });
    // Asking for it announces nothing: there is nothing to tell somebody
    // about a charge that has not happened on a plan they do not yet have.
    expect(await notificationsFor(before.id)).toHaveLength(1);

    renews(checkout.subscriptionId);
    const charged = () =>
      processEvent({
        eventId: `evt_${randomUUID()}`,
        body: delivery("subscription.charged", checkout.subscriptionId),
      });
    await charged();

    const after = await notificationsFor(before.id);
    expect(after).toHaveLength(2);
    expect(after[1].event).toBe("SUBSCRIPTION_PLAN_CHANGED");
    // The key carries the plan, so a later, different change is its own email
    // while every repeat of this one is a duplicate.
    expect(after[1].idempotencyKey).toBe(`${before.id}:SUBSCRIPTION_PLAN_CHANGED:intelligent`);

    // A second and third delivery of the same thing. Still two rows: the
    // status did not move, so the activation guard does nothing, and the plan
    // now matches, so the plan-change guard does nothing either.
    await charged();
    await charged();
    expect(await notificationsFor(before.id)).toHaveLength(2);
  });

  it("does not re-announce on an ordinary renewal afterwards", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    const row = await rowFor(checkout.subscriptionId);
    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });
    renews(checkout.subscriptionId);
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.charged", checkout.subscriptionId),
    });
    expect(await notificationsFor(row.id)).toHaveLength(2);

    // A month later, another charge on the same plan. Nothing changed, so
    // nobody is told anything.
    renews(checkout.subscriptionId);
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.charged", checkout.subscriptionId),
    });
    expect(await notificationsFor(row.id)).toHaveLength(2);
  });

  it("survives a stale delivery arriving after the change landed", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });
    renews(checkout.subscriptionId);
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.charged", checkout.subscriptionId),
    });
    expect((await rowFor(checkout.subscriptionId)).planId).toBe("intelligent");

    // A week-old `subscription.updated`, delivered late. No event payload is
    // ever the source of state -- it only prompts another question to
    // Razorpay -- so a stale one cannot walk the plan backwards.
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: {
        event: "subscription.updated",
        created_at: seconds(new Date(Date.now() - 7 * 86_400_000)),
        payload: {
          subscription: {
            entity: { ...remote.get(checkout.subscriptionId), plan_id: "plan_pro_monthly" },
          },
        },
      },
    });

    const row = await rowFor(checkout.subscriptionId);
    expect(row.planId, "a stale event must not downgrade anybody").toBe("intelligent");
    await expect(requireFeature(alice.id, "ai.queries")).resolves.toBe("intelligent");
  });

  it("leaves the plan alone when the provider reports one it does not know", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    // A Plan created in the dashboard that this deployment has no variable
    // for -- the normal state when test and live keys share a merchant
    // account. Guessing here would change what somebody is entitled to.
    remote.get(checkout.subscriptionId).plan_id = "plan_someone_elses";
    await service.syncFromProvider(checkout.subscriptionId);

    const row = await rowFor(checkout.subscriptionId);
    expect(row.planId).toBe("pro");
    expect(row.providerPlanId).toBe("plan_pro_monthly");
  });

  it("refuses an upgrade to the plan they are already on", async () => {
    await activated(alice.id, "intelligent", "monthly");
    await expect(
      service.requestPlanChange({ userId: alice.id, planId: "intelligent", interval: "monthly" })
    ).rejects.toMatchObject({ code: "NO_CHANGE" });
  });

  it("refuses a downgrade and a billing-period change, each by name", async () => {
    await activated(alice.id, "intelligent", "monthly");
    await expect(
      service.requestPlanChange({ userId: alice.id, planId: "pro", interval: "monthly" })
    ).rejects.toMatchObject({ code: "NOT_AN_UPGRADE" });

    await expect(
      service.requestPlanChange({ userId: alice.id, planId: "intelligent", interval: "yearly" })
    ).rejects.toMatchObject({ code: "NOT_AN_UPGRADE" });
  });

  it("refuses an upgrade with no subscription to upgrade", async () => {
    await expect(
      service.requestPlanChange({ userId: alice.id, planId: "intelligent", interval: "monthly" })
    ).rejects.toMatchObject({ code: "NO_SUBSCRIPTION" });
  });

  it("cannot be pointed at somebody else's subscription", async () => {
    // Bob pays. Alice asks to upgrade. The function takes a userId and reads
    // the subscription from the database, so there is nothing for Alice to
    // name -- which is the point: the request carries no subscription id at
    // all.
    await activated(bob.id, "pro", "monthly");

    await expect(
      service.requestPlanChange({ userId: alice.id, planId: "intelligent", interval: "monthly" })
    ).rejects.toMatchObject({ code: "NO_SUBSCRIPTION" });

    const bobsRow = await admin.subscription.findFirst({ where: { userId: bob.id } });
    expect(bobsRow.planId).toBe("pro");
    expect(bobsRow.scheduledPlanId).toBeNull();
    await expect(service.effectivePlanId(bob.id)).resolves.toBe("pro");
  });

  it("leaves the subscription untouched when the provider refuses", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    const before = await rowFor(checkout.subscriptionId);

    const failing = {
      ...fakeClient,
      subscriptions: {
        ...fakeClient.subscriptions,
        update: async () => {
          const error = new Error("nope");
          error.statusCode = 400;
          throw error;
        },
      },
    };
    __setClient(failing);
    try {
      await expect(
        service.requestPlanChange({
          userId: alice.id,
          planId: "intelligent",
          interval: "monthly",
        })
      ).rejects.toThrow();
    } finally {
      __setClient(fakeClient);
    }

    // Nothing written. The provider call comes first precisely so that a
    // refusal leaves no local record of a change that is not happening.
    const after = await rowFor(checkout.subscriptionId);
    expect(after.planId).toBe("pro");
    expect(after.scheduledPlanId).toBeNull();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    await expect(requireFeature(alice.id, "budgets")).resolves.toBe("pro");
    await expect(requireFeature(alice.id, "ai.queries")).rejects.toBeInstanceOf(
      EntitlementError
    );
  });

  it("does not open a second subscription for an upgrade", async () => {
    const checkout = await activated(alice.id, "pro", "monthly");
    const openedBefore = created;

    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });
    renews(checkout.subscriptionId);
    await processEvent({
      eventId: `evt_${randomUUID()}`,
      body: delivery("subscription.charged", checkout.subscriptionId),
    });

    // One subscription throughout, which is what the one-live-per-user index
    // requires and what makes an upgrade a change rather than a purchase.
    expect(created).toBe(openedBefore);
    const rows = await admin.subscription.findMany({ where: { userId: alice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].providerSubscriptionId).toBe(checkout.subscriptionId);
  });

  it("takes no payment and opens no checkout attempt", async () => {
    await activated(alice.id, "pro", "monthly");
    await admin.checkoutAttempt.deleteMany({});
    const paymentsBefore = await admin.payment.count();

    await service.requestPlanChange({
      userId: alice.id,
      planId: "intelligent",
      interval: "monthly",
    });

    // The difference between this and a purchase, stated as a fact about the
    // database: no attempt, no payment, no money.
    expect(await admin.checkoutAttempt.count()).toBe(0);
    expect(await admin.payment.count()).toBe(paymentsBefore);
  });
});
