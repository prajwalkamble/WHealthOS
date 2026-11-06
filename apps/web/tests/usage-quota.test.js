import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PLANS } from "@/data/pricing";
import {
  QuotaError,
  consumeDailyTransaction,
  dailyTransactionLimit,
  quotaEnforcementEnabled,
  quotaSummary,
} from "@/lib/billing/quota";
import { dayWindowBounds } from "@/lib/time";

// The one metered feature WHealthOS sells: transactions added per day.
//
// What is tested here is the arithmetic and the refusal, not Postgres. The
// advisory lock that makes it atomic cannot be exercised without a database,
// so what these assert is that it is *taken*, in the same transaction, before
// anything is counted -- which is the part that would be silently dropped by
// a refactor and would not fail anything else.

let saved;
beforeEach(() => {
  saved = process.env.BILLING_QUOTA_ENFORCEMENT;
  process.env.BILLING_QUOTA_ENFORCEMENT = "on";
});
afterEach(() => {
  if (saved === undefined) delete process.env.BILLING_QUOTA_ENFORCEMENT;
  else process.env.BILLING_QUOTA_ENFORCEMENT = saved;
  vi.restoreAllMocks();
});

// A transaction client that records what was asked of it.
const fakeTx = (count) => {
  const calls = { raw: [], counted: [] };
  return {
    calls,
    $executeRaw: (...args) => {
      calls.raw.push(args);
      return Promise.resolve(1);
    },
    transaction: {
      count: (args) => {
        calls.counted.push(args);
        return Promise.resolve(count);
      },
    },
  };
};

describe("the advertised figure is the enforced figure", () => {
  it("reads the number from the published table", () => {
    expect(dailyTransactionLimit("free")).toBe(5);
    expect(dailyTransactionLimit("pro")).toBe(15);
    expect(dailyTransactionLimit("intelligent")).toBeNull();
  });

  it("says the same thing as the pricing page's own copy", () => {
    // Two fields, one promise. If somebody rewords the cell without changing
    // the number -- or changes the number without the cell -- the page and
    // the server stop agreeing about what people are allowed to do, and
    // nothing else in the codebase would notice.
    for (const plan of PLANS) {
      const enforced = plan.dailyTransactions;
      const advertised = plan.limit;
      if (enforced === null) {
        expect(advertised, `${plan.id} is uncapped but does not say so`).toMatch(
          /unlimited/i
        );
        continue;
      }
      const printed = Number(String(advertised).match(/\d+/)?.[0]);
      expect(printed, `${plan.id}: "${advertised}" does not say ${enforced}`).toBe(
        enforced
      );
      expect(advertised).toMatch(/per day/i);
    }
  });

  it("gives an unknown plan the free allowance, not an unlimited one", () => {
    // Fails closed. A plan id this module does not recognise is a bug, and a
    // bug must not be a licence -- least of all the most generous one.
    expect(dailyTransactionLimit("enterprise")).toBe(5);
    expect(dailyTransactionLimit(undefined)).toBe(5);
    expect(dailyTransactionLimit(null)).toBe(5);
  });
});

describe("consuming today's allowance", () => {
  it("takes a per-account lock before it counts anything", () => {
    // Counting is not enough on its own: under READ COMMITTED two concurrent
    // requests cannot see each other's uncommitted insert, so both read "4
    // used", both insert, and the day ends with 6. The lock is what makes
    // the check atomic, and it has to be taken first.
    const tx = fakeTx(0);
    return consumeDailyTransaction(tx, "user-1", "free").then(() => {
      expect(tx.calls.raw).toHaveLength(1);
      const sql = tx.calls.raw[0][0].join("?");
      expect(sql).toContain("pg_advisory_xact_lock");
      expect(tx.calls.raw[0].slice(1)).toContain("user-1");
      expect(tx.calls.counted).toHaveLength(1);
    });
  });

  it("counts only the transactions created today, in the app's zone", async () => {
    const now = new Date("2026-06-15T09:30:00.000Z");
    const tx = fakeTx(2);
    await consumeDailyTransaction(tx, "user-1", "free", { now });

    const where = tx.calls.counted[0].where;
    const { from, to } = dayWindowBounds(1, now);
    expect(where.userId).toBe("user-1");
    expect(where.createdAt.gte.getTime()).toBe(from.getTime());
    expect(where.createdAt.lte.getTime()).toBe(to.getTime());
  });

  it("reports what is left", async () => {
    const result = await consumeDailyTransaction(fakeTx(2), "user-1", "free");
    expect(result).toMatchObject({ limit: 5, used: 2, remaining: 3 });
    expect(result.resetsAt).toBeInstanceOf(Date);
  });

  it("allows the last one in the allowance", async () => {
    // Four used, a fifth being added: within "5 per day".
    await expect(consumeDailyTransaction(fakeTx(4), "u", "free")).resolves.toMatchObject({
      remaining: 1,
    });
  });

  it("refuses the one after that", async () => {
    await expect(consumeDailyTransaction(fakeTx(5), "u", "free")).rejects.toThrow(
      QuotaError
    );
  });

  it("refuses with 429, not 403", async () => {
    // Nothing is wrong with the plan; the allowance resets. A 403 would tell
    // somebody to upgrade when waiting would do.
    const error = await consumeDailyTransaction(fakeTx(5), "u", "free").catch((e) => e);
    expect(error).toBeInstanceOf(QuotaError);
    expect(error.status).toBe(429);
    expect(error.code).toBe("QUOTA_EXCEEDED");
    expect(error.limit).toBe(5);
    expect(error.used).toBe(5);
    expect(error.resetsAt).toBeInstanceOf(Date);
    expect(error.message).toMatch(/resets at midnight/i);
  });

  it("holds a Pro account to fifteen, not five", async () => {
    await expect(consumeDailyTransaction(fakeTx(5), "u", "pro")).resolves.toMatchObject({
      limit: 15,
      remaining: 10,
    });
    await expect(consumeDailyTransaction(fakeTx(15), "u", "pro")).rejects.toThrow(QuotaError);
  });

  it("does not count, lock or refuse on an uncapped plan", async () => {
    const tx = fakeTx(9999);
    const result = await consumeDailyTransaction(tx, "u", "intelligent");
    expect(result.limit).toBeNull();
    expect(result.remaining).toBeNull();
    // No lock and no count: an uncapped plan must not pay for either.
    expect(tx.calls.raw).toHaveLength(0);
    expect(tx.calls.counted).toHaveLength(0);
  });
});

describe("the switch is off until the Terms are rewritten", () => {
  it("defaults to off", () => {
    delete process.env.BILLING_QUOTA_ENFORCEMENT;
    expect(quotaEnforcementEnabled()).toBe(false);
    process.env.BILLING_QUOTA_ENFORCEMENT = "off";
    expect(quotaEnforcementEnabled()).toBe(false);
    process.env.BILLING_QUOTA_ENFORCEMENT = "ON";
    expect(quotaEnforcementEnabled()).toBe(true);
  });

  it("still counts and logs while it is off, but lets the write through", async () => {
    // The dry run. Every refusal is visible before anybody is held to it --
    // the same shape as BILLING_ENFORCEMENT and Arcjet's DRY_RUN.
    process.env.BILLING_QUOTA_ENFORCEMENT = "off";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(consumeDailyTransaction(fakeTx(99), "u", "free")).resolves.toMatchObject(
      { limit: 5, used: 99, remaining: 0 }
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ code: "QUOTA_WOULD_DENY" });
  });

  it("tells the browser what the cap is and whether it bites", () => {
    process.env.BILLING_QUOTA_ENFORCEMENT = "off";
    expect(quotaSummary("pro")).toEqual({
      planId: "pro",
      dailyTransactions: 15,
      enforced: false,
    });
    expect(quotaSummary(null).planId).toBe("free");
  });
});
