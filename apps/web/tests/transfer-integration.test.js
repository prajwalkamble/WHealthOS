import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@whealthos/database";

// Internal transfers, against a real database.
//
// tests/transfers.test.js proves the rules. This file proves the things only a
// database can answer: that six writes commit together, that two concurrent
// transfers out of one account cannot both succeed, that a replayed
// confirmation produces one transfer and not two, that another tenant's
// account is invisible rather than merely refused, and that every money figure
// in the application ignores a transfer.

let currentClerkId = null;
let rateLimitDenied = false;

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

vi.mock("@/lib/arcjet", async () => {
  const { ActionError } = await import("@/lib/action-error");
  return {
    enforceRateLimit: async () => {
      if (rateLimitDenied) {
        throw new ActionError("Too many requests. Please try again later.");
      }
    },
  };
});

const expectFailure = async (promise, pattern) => {
  const result = await promise;
  expect(result.success).toBe(false);
  if (pattern) expect(result.error).toMatch(pattern);
  return result;
};

const { createInternalTransfer, deleteInternalTransfer } = await import(
  "@/actions/transfers"
);
const { bulkDeleteTransactions, getAccountWithTransactions } = await import(
  "@/actions/accounts"
);
const { createTransaction, updateTransaction, getTransaction } = await import(
  "@/actions/transaction"
);
const { getDashboardSummary, getAnalytics } = await import("@/lib/queries");
const { createTransfer, deleteTransfer, TransferError } = await import(
  "@/lib/transfers/service"
);
const { TRANSFER_ERRORS } = await import("@/lib/transfers/rules");
const { withTenant } = await import("@/lib/prisma");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

const TENANTS = {
  tina: { clerkUserId: "clerk_tr_tina", email: "tr-tina@example.test" },
  theo: { clerkUserId: "clerk_tr_theo", email: "tr-theo@example.test" },
};

const asTenant = (name) => {
  currentClerkId = TENANTS[name].clerkUserId;
};

const balanceOf = async (accountId) => {
  const row = await admin.account.findUnique({ where: { id: accountId } });
  return row === null ? null : row.balance.toNumber();
};

const key = () => randomUUID();

// Tina's accounts, recreated before every test so one case's balances cannot
// decide another's. Theo exists only to be somebody else.
let savings;
let current;
let usd;
let theoAccount;

const makeAccount = async (userId, over = {}) =>
  admin.account.create({
    data: {
      userId,
      name: "Account",
      type: "SAVINGS",
      balance: 0,
      currency: "INR",
      ...over,
    },
  });

beforeAll(async () => {
  await admin.user.deleteMany({
    where: {
      clerkUserId: { in: Object.values(TENANTS).map((t) => t.clerkUserId) },
    },
  });

  for (const [name, t] of Object.entries(TENANTS)) {
    const user = await admin.user.create({
      data: { ...t, name, imageUrl: "https://example.test/avatar.png" },
    });
    TENANTS[name].id = user.id;

    // Entitled, for the same reason tests/actions-integration.test.js does it:
    // BILLING_ENFORCEMENT is on, and this suite is about transfers, not gates.
    // (Transfers themselves are free on every plan -- see actions/transfers.js
    // -- but getAnalytics below is a paid read.)
    await admin.subscription.create({
      data: {
        userId: user.id,
        planId: "intelligent",
        interval: "MONTHLY",
        providerSubscriptionId: `sub_tr_${name}_${user.id.slice(0, 8)}`,
        status: "ACTIVE",
        amount: 69900,
        currency: "INR",
        currentStart: new Date("2026-01-01T00:00:00Z"),
        currentEnd: new Date("2099-01-01T00:00:00Z"),
      },
    });
  }

  theoAccount = await makeAccount(TENANTS.theo.id, { name: "Theo Savings", balance: 1000 });
});

beforeEach(async () => {
  rateLimitDenied = false;
  await admin.transfer.deleteMany({ where: { userId: TENANTS.tina.id } });
  await admin.transaction.deleteMany({ where: { userId: TENANTS.tina.id } });
  await admin.account.deleteMany({ where: { userId: TENANTS.tina.id } });

  savings = await makeAccount(TENANTS.tina.id, {
    name: "Tina Savings",
    type: "SAVINGS",
    balance: 50000,
    isDefault: true,
  });
  current = await makeAccount(TENANTS.tina.id, {
    name: "Tina Current",
    type: "CURRENT",
    balance: 20000,
  });
  usd = await makeAccount(TENANTS.tina.id, {
    name: "Tina Dollars",
    type: "CURRENT",
    balance: 500,
    currency: "USD",
  });
  asTenant("tina");
});

afterAll(async () => {
  await admin.user.deleteMany({
    where: {
      clerkUserId: { in: Object.values(TENANTS).map((t) => t.clerkUserId) },
    },
  });
  await admin.$disconnect();
  const { db, adminDb } = await import("@/lib/prisma");
  await db.$disconnect();
  await adminDb.$disconnect();
});

const transfer = (over = {}) =>
  createInternalTransfer({
    fromAccountId: savings.id,
    toAccountId: current.id,
    amount: 10000,
    date: new Date("2026-11-12T06:00:00Z"),
    description: null,
    idempotencyKey: key(),
    ...over,
  });

// ---------------------------------------------------------------------------

describe("A successful transfer", () => {
  it("moves the amount, and only the amount", async () => {
    // The brief's worked example, end to end: ₹50,000 and ₹20,000, move
    // ₹10,000, and the two accounts hold ₹40,000 and ₹30,000 with ₹70,000
    // between them before and after.
    const before = (await balanceOf(savings.id)) + (await balanceOf(current.id));

    const res = await transfer();
    expect(res.success).toBe(true);

    expect(await balanceOf(savings.id)).toBe(40000);
    expect(await balanceOf(current.id)).toBe(30000);
    expect((await balanceOf(savings.id)) + (await balanceOf(current.id))).toBe(
      before
    );
  });

  it("writes one transfer and exactly two linked legs", async () => {
    const res = await transfer();

    const rows = await admin.transfer.findMany({
      where: { userId: TENANTS.tina.id },
      include: { legs: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.data.id);
    expect(rows[0].legs).toHaveLength(2);

    const out = rows[0].legs.find((l) => l.type === "TRANSFER_OUT");
    const into = rows[0].legs.find((l) => l.type === "TRANSFER_IN");
    expect(out.accountId).toBe(savings.id);
    expect(into.accountId).toBe(current.id);
    // Invariant 1: the debit equals the credit.
    expect(out.amount.toNumber()).toBe(into.amount.toNumber());
    // Both legs point at the same logical transfer.
    expect(out.transferId).toBe(rows[0].id);
    expect(into.transferId).toBe(rows[0].id);
    // And both carry the account currency, read from the row and not supplied.
    expect(out.currency).toBe("INR");
    expect(into.currency).toBe("INR");
  });

  it("names the other account on each leg, so account history explains itself", async () => {
    await transfer({ description: "deposit fund" });
    const legs = await admin.transaction.findMany({
      where: { userId: TENANTS.tina.id, transferId: { not: null } },
    });
    const out = legs.find((l) => l.type === "TRANSFER_OUT");
    const into = legs.find((l) => l.type === "TRANSFER_IN");
    expect(out.description).toBe("To Tina Current — deposit fund");
    expect(into.description).toBe("From Tina Savings — deposit fund");
    expect(out.category).toBe("transfer-out");
    expect(into.category).toBe("transfer-in");
  });

  it("never returns the idempotency key to the browser", async () => {
    // It is scoped with the internal user id, which is not something a client
    // has any business holding.
    const res = await transfer();
    expect(JSON.stringify(res.data)).not.toMatch(/idempotencyKey/i);
    expect(JSON.stringify(res.data)).not.toContain(TENANTS.tina.id);
  });

  it("shows both sides in the two accounts' histories", async () => {
    await transfer();

    const from = await getAccountWithTransactions(savings.id);
    const to = await getAccountWithTransactions(current.id);

    const fromLeg = from.transactions.find((t) => t.transferId);
    const toLeg = to.transactions.find((t) => t.transferId);
    expect(fromLeg.type).toBe("TRANSFER_OUT");
    expect(toLeg.type).toBe("TRANSFER_IN");
    // Both entries reference the same logical transfer.
    expect(fromLeg.transferId).toBe(toLeg.transferId);
  });
});

describe("Refusals", () => {
  it("refuses more than the account holds", async () => {
    await expectFailure(transfer({ amount: 50000.01 }), /more than the account holds/i);
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(current.id)).toBe(20000);
    expect(await admin.transfer.count({ where: { userId: TENANTS.tina.id } })).toBe(0);
    expect(
      await admin.transaction.count({ where: { userId: TENANTS.tina.id } })
    ).toBe(0);
  });

  it("allows a transfer of the entire balance", async () => {
    const res = await transfer({ amount: 50000 });
    expect(res.success).toBe(true);
    expect(await balanceOf(savings.id)).toBe(0);
    expect(await balanceOf(current.id)).toBe(70000);
  });

  it("refuses the same account on both sides", async () => {
    await expectFailure(
      transfer({ toAccountId: savings.id }),
      /two different accounts/i
    );
    expect(await balanceOf(savings.id)).toBe(50000);
  });

  it("refuses two different currencies, and says why", async () => {
    await expectFailure(
      transfer({ toAccountId: usd.id, amount: 100 }),
      /same currency/i
    );
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(usd.id)).toBe(500);
  });

  it("refuses an amount with too many decimal places", async () => {
    await expectFailure(transfer({ amount: 100.005 }), /decimal places/i);
    expect(await balanceOf(savings.id)).toBe(50000);
  });

  it("refuses a zero or negative amount before it reaches the service", async () => {
    await expectFailure(transfer({ amount: 0 }));
    await expectFailure(transfer({ amount: -100 }));
    expect(await balanceOf(savings.id)).toBe(50000);
  });

  it("refuses an unsigned-in caller", async () => {
    currentClerkId = null;
    await expectFailure(transfer(), /unauthorized/i);
    expect(await admin.transfer.count({ where: { userId: TENANTS.tina.id } })).toBe(0);
  });

  it("refuses when rate limited, before anything is written", async () => {
    rateLimitDenied = true;
    await expectFailure(transfer(), /too many requests/i);
    expect(await balanceOf(savings.id)).toBe(50000);
  });

  it("never puts a refusal code in front of a person", async () => {
    // TransferError resolves its own message through rules.js precisely so
    // that `error.message` is never the bare code.
    const res = await transfer({ amount: 999999 });
    expect(res.success).toBe(false);
    for (const code of Object.values(TRANSFER_ERRORS)) {
      expect(res.error).not.toBe(code);
    }
    expect(res.error).not.toMatch(/^[A-Z_]+$/);
  });
});

describe("Authorization", () => {
  it("cannot transfer out of another tenant's account", async () => {
    await expectFailure(
      transfer({ fromAccountId: theoAccount.id }),
      /isn't available/i
    );
    expect(await balanceOf(theoAccount.id)).toBe(1000);
  });

  it("cannot transfer INTO another tenant's account", async () => {
    await expectFailure(
      transfer({ toAccountId: theoAccount.id }),
      /isn't available/i
    );
    expect(await balanceOf(theoAccount.id)).toBe(1000);
    expect(await balanceOf(savings.id)).toBe(50000);
  });

  it("refuses an account id that does not exist, with the same message", async () => {
    // Indistinguishable from "belongs to somebody else", by design.
    const absent = await expectFailure(transfer({ toAccountId: randomUUID() }));
    const foreign = await expectFailure(transfer({ toAccountId: theoAccount.id }));
    expect(absent.error).toBe(foreign.error);
  });

  it("cannot delete another tenant's transfer", async () => {
    const res = await transfer();
    asTenant("theo");
    await expectFailure(deleteInternalTransfer(res.data.id), /no longer exists/i);
    asTenant("tina");
    // Still there, and both balances untouched by the attempt.
    expect(await admin.transfer.count({ where: { id: res.data.id } })).toBe(1);
    expect(await balanceOf(savings.id)).toBe(40000);
  });

  it("cannot see another tenant's transfer through RLS", async () => {
    const res = await transfer();
    const seen = await withTenant(TENANTS.theo.id, (tx) =>
      tx.transfer.findMany({})
    );
    expect(seen.map((t) => t.id)).not.toContain(res.data.id);
  });

  it("cannot insert a transfer attributed to another tenant", async () => {
    // The WITH CHECK on transfers_insert, not the service: this is the
    // guarantee that holds even if the service stopped resolving the id.
    await expect(
      withTenant(TENANTS.theo.id, (tx) =>
        tx.transfer.create({
          data: {
            userId: TENANTS.tina.id,
            fromAccountId: savings.id,
            toAccountId: current.id,
            amount: 1,
            currency: "INR",
            date: new Date(),
            idempotencyKey: `forged:${randomUUID()}`,
          },
        })
      )
    ).rejects.toThrow();
  });

  it("cannot update a transfer at all -- not even its own", async () => {
    // Transfers are immutable by policy. The UPDATE policy admits only the job
    // runner, so there is no application path to changing one.
    const res = await transfer();
    const updated = await withTenant(TENANTS.tina.id, (tx) =>
      tx.transfer.updateMany({
        where: { id: res.data.id },
        data: { amount: 1 },
      })
    );
    expect(updated.count).toBe(0);
    const row = await admin.transfer.findUnique({ where: { id: res.data.id } });
    expect(row.amount.toNumber()).toBe(10000);
  });
});

describe("Idempotency", () => {
  it("answers a replayed confirmation with the first transfer", async () => {
    const k = key();
    const first = await transfer({ idempotencyKey: k });
    const second = await transfer({ idempotencyKey: k });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.data.id).toBe(first.data.id);
    expect(second.replayed).toBe(true);
    expect(first.replayed).toBe(false);

    // One transfer, two legs, one set of balance movements.
    expect(await admin.transfer.count({ where: { userId: TENANTS.tina.id } })).toBe(1);
    expect(
      await admin.transaction.count({ where: { userId: TENANTS.tina.id } })
    ).toBe(2);
    expect(await balanceOf(savings.id)).toBe(40000);
    expect(await balanceOf(current.id)).toBe(30000);
  });

  it("refuses the same key with different details", async () => {
    const k = key();
    await transfer({ idempotencyKey: k, amount: 10000 });
    await expectFailure(
      transfer({ idempotencyKey: k, amount: 20000 }),
      /already made with different details/i
    );
    // And the first transfer is untouched by the attempt.
    expect(await balanceOf(savings.id)).toBe(40000);
  });

  it("counts a changed note as different details, not as a retry", async () => {
    // A note moves no money, but a caller sending one key with two notes has
    // two requests -- and answering the second with the first would silently
    // lose whatever the change meant.
    const k = key();
    await transfer({ idempotencyKey: k, description: "for the deposit" });
    await expectFailure(
      transfer({ idempotencyKey: k, description: "for the car" }),
      /already made with different details/i
    );
    // And an unchanged note still replays, including null against null.
    const k2 = key();
    const first = await transfer({ idempotencyKey: k2, description: null });
    const again = await transfer({ idempotencyKey: k2, description: null });
    expect(again.replayed).toBe(true);
    expect(again.data.id).toBe(first.data.id);
  });

  it("refuses the same key for a different pair of accounts", async () => {
    const k = key();
    await transfer({ idempotencyKey: k });
    await expectFailure(
      transfer({
        idempotencyKey: k,
        fromAccountId: current.id,
        toAccountId: savings.id,
      }),
      /already made with different details/i
    );
  });

  it("refuses the same key for a different date", async () => {
    const k = key();
    await transfer({ idempotencyKey: k });
    await expectFailure(
      transfer({ idempotencyKey: k, date: new Date("2026-11-11T06:00:00Z") }),
      /already made with different details/i
    );
  });

  it("scopes the key to the user, so two people can use the same one", async () => {
    const k = key();
    await transfer({ idempotencyKey: k });

    const theoSecond = await makeAccount(TENANTS.theo.id, {
      name: "Theo Current",
      balance: 0,
    });
    asTenant("theo");
    const res = await createInternalTransfer({
      fromAccountId: theoAccount.id,
      toAccountId: theoSecond.id,
      amount: 100,
      date: new Date("2026-11-12T06:00:00Z"),
      description: null,
      idempotencyKey: k,
    });
    expect(res.success).toBe(true);
    expect(res.replayed).toBe(false);
    asTenant("tina");

    await admin.transfer.deleteMany({ where: { userId: TENANTS.theo.id } });
    await admin.transaction.deleteMany({ where: { userId: TENANTS.theo.id } });
    await admin.account.delete({ where: { id: theoSecond.id } });
    await admin.account.update({
      where: { id: theoAccount.id },
      data: { balance: 1000 },
    });
  });

  it("makes one transfer out of two simultaneous confirmations", async () => {
    // The double click. Both requests arrive before either commits, so the
    // advisory lock on the key is what serialises them -- and the second,
    // reading afterwards under READ COMMITTED, finds the committed row and
    // replays it instead of inserting a second.
    const k = key();
    const results = await Promise.all([
      transfer({ idempotencyKey: k }),
      transfer({ idempotencyKey: k }),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);

    expect(await admin.transfer.count({ where: { userId: TENANTS.tina.id } })).toBe(1);
    expect(
      await admin.transaction.count({ where: { userId: TENANTS.tina.id } })
    ).toBe(2);
    // The money moved once.
    expect(await balanceOf(savings.id)).toBe(40000);
    expect(await balanceOf(current.id)).toBe(30000);
  });
});

describe("Concurrency", () => {
  it("cannot overdraw through two simultaneous transfers", async () => {
    // Invariant 8. ₹50,000 available, two requests for ₹30,000 each, arriving
    // together with different idempotency keys so neither is a replay. Exactly
    // one may win: the FOR UPDATE lock makes the second read a settled
    // balance instead of the one the first saw.
    const results = await Promise.all([
      transfer({ amount: 30000 }),
      transfer({ amount: 30000 }),
    ]);

    const ok = results.filter((r) => r.success);
    const refused = results.filter((r) => !r.success);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].error).toMatch(/more than the account holds/i);

    expect(await balanceOf(savings.id)).toBe(20000);
    expect(await balanceOf(current.id)).toBe(50000);
    expect(await admin.transfer.count({ where: { userId: TENANTS.tina.id } })).toBe(1);
  });

  it("lets both through when both fit", async () => {
    const results = await Promise.all([
      transfer({ amount: 20000 }),
      transfer({ amount: 20000 }),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(await balanceOf(savings.id)).toBe(10000);
    expect(await balanceOf(current.id)).toBe(60000);
  });

  it("does not deadlock on two transfers in opposite directions", async () => {
    // A→B and B→A at the same moment. Both accounts are locked in id order by
    // every caller, so the second waits rather than each holding what the
    // other wants.
    const results = await Promise.all([
      transfer({ amount: 5000 }),
      transfer({
        fromAccountId: current.id,
        toAccountId: savings.id,
        amount: 5000,
      }),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
    for (const r of results) expect(r.error).toBeUndefined();
    // They cancel.
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(current.id)).toBe(20000);
  });

  it("serialises against an ordinary transaction on the same account", async () => {
    const results = await Promise.all([
      transfer({ amount: 10000 }),
      createTransaction({
        type: "INCOME",
        amount: 1000,
        date: new Date("2026-11-12T06:00:00Z"),
        accountId: savings.id,
        category: "salary",
        isRecurring: false,
      }),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
    // Both applied, neither lost: the balance writes are increments.
    expect(await balanceOf(savings.id)).toBe(50000 - 10000 + 1000);
  });
});

describe("Atomicity", () => {
  it("commits nothing when the surrounding transaction fails afterwards", async () => {
    // Invariant 4. createTransfer writes six things -- the transfer, two legs
    // and two balance movements, plus the quota consumption -- and all of them
    // belong to the caller's transaction. A failure after the last of them
    // must undo all of them, with no state in which money is debited and not
    // credited.
    await expect(
      withTenant(TENANTS.tina.id, async (tx, userId) => {
        await createTransfer({
          tx,
          userId,
          input: {
            fromAccountId: savings.id,
            toAccountId: current.id,
            amount: 10000,
            date: new Date("2026-11-12T06:00:00Z"),
            description: null,
            idempotencyKey: key(),
          },
        });
        throw new Error("something downstream failed");
      })
    ).rejects.toThrow(/something downstream failed/);

    expect(await admin.transfer.count({ where: { userId: TENANTS.tina.id } })).toBe(0);
    expect(
      await admin.transaction.count({ where: { userId: TENANTS.tina.id } })
    ).toBe(0);
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(current.id)).toBe(20000);
  });
});

describe("Database constraints", () => {
  it("refuses a second leg of the same side", async () => {
    // Invariant 5, in the database. A duplicate debit for one transfer is
    // impossible rather than merely prevented.
    const res = await transfer();
    await expect(
      admin.transaction.create({
        data: {
          type: "TRANSFER_OUT",
          amount: 10000,
          currency: "INR",
          date: new Date(),
          category: "transfer-out",
          userId: TENANTS.tina.id,
          accountId: savings.id,
          transferId: res.data.id,
        },
      })
    ).rejects.toThrow();
  });

  it("refuses a transfer leg with no transfer", async () => {
    await expect(
      admin.transaction.create({
        data: {
          type: "TRANSFER_OUT",
          amount: 10000,
          currency: "INR",
          date: new Date(),
          category: "transfer-out",
          userId: TENANTS.tina.id,
          accountId: savings.id,
        },
      })
    ).rejects.toThrow();
  });

  it("refuses an ordinary transaction attached to a transfer", async () => {
    const res = await transfer();
    await expect(
      admin.transaction.create({
        data: {
          type: "EXPENSE",
          amount: 10000,
          currency: "INR",
          date: new Date(),
          category: "groceries",
          userId: TENANTS.tina.id,
          accountId: savings.id,
          transferId: res.data.id,
        },
      })
    ).rejects.toThrow();
  });

  it("refuses a zero or negative transfer amount at the table", async () => {
    for (const amount of [0, -1]) {
      await expect(
        admin.transfer.create({
          data: {
            userId: TENANTS.tina.id,
            fromAccountId: savings.id,
            toAccountId: current.id,
            amount,
            currency: "INR",
            date: new Date(),
            idempotencyKey: `check:${randomUUID()}`,
          },
        })
      ).rejects.toThrow();
    }
  });

  it("refuses a transfer to and from the same account at the table", async () => {
    await expect(
      admin.transfer.create({
        data: {
          userId: TENANTS.tina.id,
          fromAccountId: savings.id,
          toAccountId: savings.id,
          amount: 1,
          currency: "INR",
          date: new Date(),
          idempotencyKey: `check:${randomUUID()}`,
        },
      })
    ).rejects.toThrow();
  });

  it("refuses a duplicate idempotency key at the table", async () => {
    const k = `dup:${randomUUID()}`;
    const row = {
      userId: TENANTS.tina.id,
      fromAccountId: savings.id,
      toAccountId: current.id,
      amount: 1,
      currency: "INR",
      date: new Date(),
      idempotencyKey: k,
    };
    await admin.transfer.create({ data: row });
    await expect(admin.transfer.create({ data: row })).rejects.toThrow();
  });
});

describe("Deleting a transfer", () => {
  it("removes both legs and restores both balances", async () => {
    const res = await transfer();
    expect(await balanceOf(savings.id)).toBe(40000);

    const del = await deleteInternalTransfer(res.data.id);
    expect(del.success).toBe(true);

    expect(await admin.transfer.count({ where: { id: res.data.id } })).toBe(0);
    expect(
      await admin.transaction.count({ where: { transferId: res.data.id } })
    ).toBe(0);
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(current.id)).toBe(20000);
  });

  it("cannot be deleted twice", async () => {
    const res = await transfer();
    await deleteInternalTransfer(res.data.id);
    await expectFailure(deleteInternalTransfer(res.data.id), /no longer exists/i);
    // And the balances were restored once, not twice.
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(current.id)).toBe(20000);
  });

  it("refuses an unknown id without touching anything", async () => {
    await transfer();
    await expectFailure(deleteInternalTransfer(randomUUID()));
    await expectFailure(deleteInternalTransfer(""));
    await expectFailure(deleteInternalTransfer(null));
    expect(await balanceOf(savings.id)).toBe(40000);
  });

  it("is safe under two simultaneous deletions", async () => {
    const res = await transfer();
    const results = await Promise.all([
      deleteInternalTransfer(res.data.id),
      deleteInternalTransfer(res.data.id),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    // Restored exactly once.
    expect(await balanceOf(savings.id)).toBe(50000);
    expect(await balanceOf(current.id)).toBe(20000);
  });

  it("frees its slot: the same idempotency key works again afterwards", async () => {
    const k = key();
    const first = await transfer({ idempotencyKey: k });
    await deleteInternalTransfer(first.data.id);
    const second = await transfer({ idempotencyKey: k });
    expect(second.success).toBe(true);
    expect(second.replayed).toBe(false);
    expect(second.data.id).not.toBe(first.data.id);
  });
});

describe("A transfer leg is not an ordinary transaction", () => {
  it("cannot be deleted through the transactions table", async () => {
    // The dangerous one. Deleting one leg would back the debit out of the
    // source and leave the credit on the destination: money from nothing.
    const res = await transfer();
    const leg = await admin.transaction.findFirst({
      where: { transferId: res.data.id, type: "TRANSFER_OUT" },
    });

    await expectFailure(bulkDeleteTransactions([leg.id]), /part of a transfer/i);
    expect(await balanceOf(savings.id)).toBe(40000);
    expect(await balanceOf(current.id)).toBe(30000);
    expect(await admin.transaction.count({ where: { id: leg.id } })).toBe(1);
  });

  it("refuses a mixed selection whole, rather than deleting the rest", async () => {
    // Filtering would delete the ordinary transaction and silently keep the
    // leg, while reporting the count the person asked for.
    await createTransaction({
      type: "EXPENSE",
      amount: 500,
      date: new Date("2026-11-12T06:00:00Z"),
      accountId: savings.id,
      category: "groceries",
      isRecurring: false,
    });
    const res = await transfer();
    const leg = await admin.transaction.findFirst({
      where: { transferId: res.data.id },
    });
    const ordinary = await admin.transaction.findFirst({
      where: { userId: TENANTS.tina.id, transferId: null },
    });

    await expectFailure(
      bulkDeleteTransactions([ordinary.id, leg.id]),
      /part of a transfer/i
    );
    // Both still there.
    expect(await admin.transaction.count({ where: { id: ordinary.id } })).toBe(1);
    expect(await admin.transaction.count({ where: { id: leg.id } })).toBe(1);
  });

  it("cannot be loaded by the transaction edit page", async () => {
    const res = await transfer();
    const leg = await admin.transaction.findFirst({
      where: { transferId: res.data.id },
    });
    expect(await getTransaction(leg.id)).toBeNull();
  });

  it("cannot be edited as a transaction", async () => {
    const res = await transfer();
    const leg = await admin.transaction.findFirst({
      where: { transferId: res.data.id, type: "TRANSFER_OUT" },
    });
    await expectFailure(
      updateTransaction(leg.id, {
        type: "EXPENSE",
        amount: 1,
        date: new Date("2026-11-12T06:00:00Z"),
        accountId: savings.id,
        category: "groceries",
        isRecurring: false,
      }),
      /part of a transfer/i
    );
    // Unchanged, and the balances with it.
    const after = await admin.transaction.findUnique({ where: { id: leg.id } });
    expect(after.type).toBe("TRANSFER_OUT");
    expect(after.amount.toNumber()).toBe(10000);
    expect(await balanceOf(savings.id)).toBe(40000);
  });

  it("cannot be created through the transaction action", async () => {
    await expectFailure(
      createTransaction({
        type: "TRANSFER_OUT",
        amount: 100,
        date: new Date("2026-11-12T06:00:00Z"),
        accountId: savings.id,
        category: "transfer-out",
        isRecurring: false,
      })
    );
    expect(
      await admin.transaction.count({ where: { userId: TENANTS.tina.id } })
    ).toBe(0);
  });
});

describe("A transfer is neither income nor an expense", () => {
  it("leaves the dashboard's income, expenses and savings rate alone", async () => {
    // Invariant 3, through the real query the dashboard uses.
    await createTransaction({
      type: "INCOME",
      amount: 80000,
      date: new Date(),
      accountId: savings.id,
      category: "salary",
      isRecurring: false,
    });
    await createTransaction({
      type: "EXPENSE",
      amount: 20000,
      date: new Date(),
      accountId: savings.id,
      category: "groceries",
      isRecurring: false,
    });

    const before = await getDashboardSummary();
    await transfer({ amount: 10000, date: new Date() });
    const after = await getDashboardSummary();

    expect(after.monthlyIncome).toBe(before.monthlyIncome);
    expect(after.monthlyExpenses).toBe(before.monthlyExpenses);
    expect(after.savingsRate).toBe(before.savingsRate);
    expect(after.net).toBe(before.net);
    // And the one figure that SHOULD be unchanged for a different reason:
    // money moved between owned accounts does not alter the total.
    expect(after.totalBalance).toBeCloseTo(before.totalBalance, 6);
  });

  it("leaves the analytics totals and category breakdown alone", async () => {
    await createTransaction({
      type: "EXPENSE",
      amount: 5000,
      date: new Date(),
      accountId: savings.id,
      category: "groceries",
      isRecurring: false,
    });

    const before = await getAnalytics({ months: 2 });
    await transfer({ amount: 10000, date: new Date() });
    const after = await getAnalytics({ months: 2 });

    expect(after.current).toEqual(before.current);
    expect(after.categories.map((c) => c.category)).toEqual(
      before.categories.map((c) => c.category)
    );
    // No transfer category appears anywhere in the breakdown or the Sankey.
    const names = JSON.stringify(after.categories) + JSON.stringify(after.cashflow);
    expect(names).not.toMatch(/transfer/i);
  });

  it("does not change the total balance across the two accounts", async () => {
    // Invariant 2, read back from the database rather than projected.
    const before = (await balanceOf(savings.id)) + (await balanceOf(current.id));
    await transfer({ amount: 12345.67 });
    const after = (await balanceOf(savings.id)) + (await balanceOf(current.id));
    expect(after).toBeCloseTo(before, 6);
  });

  it("counts as one unit of the daily transaction allowance, not two", async () => {
    // One user action, one unit. The quota counts rows, so a transfer's two
    // legs would otherwise charge double -- see lib/billing/quota.js.
    const { dailyTransactionLimit } = await import("@/lib/billing/quota");
    const { consumeDailyTransaction } = await import("@/lib/billing/quota");
    expect(dailyTransactionLimit("intelligent")).toBeDefined();

    await transfer();
    const used = await withTenant(TENANTS.tina.id, (tx, userId) =>
      consumeDailyTransaction(tx, userId, "free")
    );
    // Two legs exist; one unit has been spent.
    expect(
      await admin.transaction.count({ where: { userId: TENANTS.tina.id } })
    ).toBe(2);
    expect(used.used).toBe(1);
  });
});
