// The internal transfer operation.
//
// One function writes a transfer and one deletes it, and both of them expect
// to be handed a transaction client by the caller -- `withCurrentTenant` from
// actions/transfers.js in production, the test's own tenant transaction in the
// suite. Nothing here opens its own transaction, because the whole point is
// that everything a transfer does commits together or not at all, and a
// function that starts its own transaction cannot be composed into a larger
// one that needs to.
//
// ---------------------------------------------------------------------------
// WHAT COMMITS TOGETHER
// ---------------------------------------------------------------------------
//   the transfers row
//   the TRANSFER_OUT leg against the source account
//   the TRANSFER_IN  leg against the destination account
//   the decrement of the source balance
//   the increment  of the destination balance
//   the day's quota consumption
//
// Six writes, one transaction. There is no ordering of them that can leave
// money debited and not credited, because a failure anywhere rolls back all
// six. This is the brief's invariant 4, and it is not something this module
// implements so much as something it declines to work around: the temptation
// would be a second request, a queue or a callback, and each of those is a
// window in which half a transfer exists.
//
// ---------------------------------------------------------------------------
// WHAT IS NEVER TRUSTED
// ---------------------------------------------------------------------------
// The caller supplies account ids, an amount, a date and a note. That is all.
// Not a user id, not a balance, not a currency, not a computed destination
// amount, not a status. Both account rows are read from the database under the
// tenant's own RLS scope, and every decision is made from those rows -- so an
// id belonging to somebody else is not "rejected", it is simply never found.

import { randomUUID } from "node:crypto";
import { balanceEffect } from "@/lib/money";
import { consumeDailyTransaction } from "@/lib/billing/quota";
import { effectivePlanId } from "@/lib/billing/service";
import { checkTransfer, messageFor, TRANSFER_ERRORS } from "./rules";

// Thrown for every refusal this module makes.
//
// Carries the code so tests can assert on it without matching prose, and
// resolves its own message through rules.js so a caller that forwards
// `error.message` to a person can never accidentally show them the code. That
// is not hypothetical: `super(message ?? code)` would have put
// "INSUFFICIENT_FUNDS" in a toast.
export class TransferError extends Error {
  constructor(code, message) {
    super(message ?? messageFor(code));
    this.name = "TransferError";
    this.code = code;
  }
}

// The reserved categories from data/categories.js. Set here, never submitted:
// Transaction.category is NOT NULL and these are the only two values a leg is
// ever allowed to carry.
const LEG_CATEGORY = {
  TRANSFER_OUT: "transfer-out",
  TRANSFER_IN: "transfer-in",
};

// Transaction.description is capped at 500 by app/lib/schema.js.
const DESCRIPTION_LIMIT = 500;

// This module's own advisory-lock namespace, so a lock taken here can never
// collide with one taken elsewhere for an unrelated reason. The same
// convention lib/billing/quota.js uses, and a different number.
const LOCK_NAMESPACE = 5_120_883;

/**
 * What a leg says in account history.
 *
 * The counterpart account is named on the row itself rather than resolved
 * through a join, so the account page, the transactions table and global
 * search -- none of which know what a transfer is -- all show "To Savings"
 * instead of an unexplained debit. The same trick the recurring processor
 * uses for "(Recurring)".
 */
const legDescription = (counterpartName, note) => {
  const prefix = `To ${counterpartName}`;
  const base = note ? `${prefix} — ${note}` : prefix;
  return base.slice(0, DESCRIPTION_LIMIT);
};

const inboundDescription = (counterpartName, note) => {
  const prefix = `From ${counterpartName}`;
  const base = note ? `${prefix} — ${note}` : prefix;
  return base.slice(0, DESCRIPTION_LIMIT);
};

/**
 * Locks one account row and returns it, or null if it is not this user's.
 *
 * `FOR UPDATE` is what makes the balance it returns authoritative rather than
 * a guess that was true a moment ago. Without it, two transfers of ₹7,000 from
 * an account holding ₹10,000 both read 10,000, both pass the funds check and
 * both commit -- leaving −4,000 in an account that is not allowed to go
 * negative. With it, the second waits for the first to commit and then reads
 * 3,000 and is refused.
 *
 * The lock also blocks a concurrent ordinary transaction's `increment` on the
 * same row for the duration of this transaction, since that UPDATE needs the
 * same lock. (It does not stop an expense landing immediately AFTER the
 * transfer commits and overdrawing the account that way -- but expenses are
 * deliberately allowed to overdraw in WHealthOS, so that is existing behaviour
 * and not something a transfer rule should silently change.)
 *
 * `"userId" = ...` in the predicate as well as RLS: RLS already scopes the
 * read, and this makes the intent legible at the call site and keeps the query
 * correct if it is ever run as the job runner.
 */
async function lockAccount(tx, userId, accountId) {
  if (typeof accountId !== "string" || accountId === "") return null;
  const rows = await tx.$queryRaw`
    SELECT "id", "name", "currency", "balance"
    FROM accounts
    WHERE "id" = ${accountId} AND "userId" = ${userId}
    FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Locks both accounts, always in the same order.
 *
 * Sorted by id, which is the entire deadlock story. A transfer A→B and a
 * transfer B→A arriving together would otherwise each hold the row the other
 * wants, and Postgres would resolve it by killing one of them -- a transfer
 * failing with a deadlock error rather than a reason. Locking in a total order
 * every caller agrees on makes the second one simply wait.
 *
 * Returns the rows mapped back to source/destination, so callers never have to
 * think about the order the locks were taken in.
 */
async function lockBothAccounts(tx, userId, fromAccountId, toAccountId) {
  const ids = [fromAccountId, toAccountId].sort();
  const first = await lockAccount(tx, userId, ids[0]);
  // The second lookup is skipped when both ids are the same string: there is
  // one row, and asking for it twice would be a second lock on a row this
  // transaction already holds. checkTransfer refuses the pair anyway.
  const second =
    ids[0] === ids[1] ? first : await lockAccount(tx, userId, ids[1]);

  const byId = new Map();
  for (const row of [first, second]) if (row) byId.set(row.id, row);

  return {
    source: byId.get(fromAccountId) ?? null,
    destination: byId.get(toAccountId) ?? null,
  };
}

// Transfers that are the same request, for idempotency purposes.
//
// The brief requires that reusing a key with a DIFFERENT payload is refused
// rather than quietly answered with the earlier transfer -- otherwise a client
// bug that reuses one key for two genuinely different transfers loses the
// second one silently. Compared against the stored columns rather than a hash
// column, which keeps the schema smaller and means there is nothing that can
// disagree with the row it describes.
const sameRequest = (
  existing,
  { fromAccountId, toAccountId, amount, date, description }
) =>
  existing.fromAccountId === fromAccountId &&
  existing.toAccountId === toAccountId &&
  // Decimal, so .equals() -- `==` would compare an object to a number and a
  // retry would read as a different request every time.
  existing.amount.equals(amount) &&
  existing.date.getTime() === new Date(date).getTime() &&
  // The note counts too, even though it moves no money. A caller that sends
  // one key with two different notes has two different requests, and silently
  // answering the second with the first would lose whatever it meant. Not
  // reachable from the interface -- going back and changing anything mints a
  // fresh key -- so this is for direct callers. Normalised, because the action
  // sends null for an empty note and a direct caller may send "".
  (existing.description ?? null) === (description ?? null);

const withLegs = {
  include: {
    legs: {
      select: { id: true, type: true, accountId: true, amount: true },
    },
    fromAccount: { select: { id: true, name: true, type: true } },
    toAccount: { select: { id: true, name: true, type: true } },
  },
};

/**
 * Creates one transfer, or returns the one this request already created.
 *
 * @param {object}  args
 * @param {object}  args.tx      a Prisma transaction client, tenant-scoped
 * @param {string}  args.userId  resolved server-side; never from a request
 * @param {object}  args.input   validated payload: fromAccountId, toAccountId,
 *                               amount, date, description, idempotencyKey
 * @returns {Promise<{ transfer: object, replayed: boolean }>}
 */
export async function createTransfer({ tx, userId, input }) {
  const { fromAccountId, toAccountId, amount, date, description } = input;

  // Scoped to the user, so one person's key cannot collide with -- or be
  // guessed into replaying -- another's. The unique index is on this whole
  // string.
  const idempotencyKey = `${userId}:${input.idempotencyKey}`;

  // Serialise every request carrying this key, before the read below.
  //
  // The unique index alone is not enough. Two simultaneous confirmations both
  // miss the read, both insert, and one gets a constraint violation -- which
  // aborts its transaction, so it cannot recover and answer with the transfer
  // that did commit; it can only fail. The person double-clicked and is told
  // something went wrong, while their money moved.
  //
  // Held until this transaction ends, so the second request waits, and then --
  // READ COMMITTED, so its read is a fresh statement -- sees the committed row
  // and returns it as a replay. The unique index stays as the backstop that
  // makes a duplicate impossible rather than merely unlikely.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${idempotencyKey})::int)`;

  // This key has been seen. Checked before any row lock is taken and before
  // the quota is touched, because a replay must cost nothing.
  const existing = await tx.transfer.findUnique({
    where: { idempotencyKey },
    ...withLegs,
  });
  if (existing) {
    if (
      !sameRequest(existing, {
        fromAccountId,
        toAccountId,
        amount,
        date,
        description: description ?? null,
      })
    ) {
      throw new TransferError(
        "IDEMPOTENCY_CONFLICT",
        "That transfer was already made with different details."
      );
    }
    return { transfer: existing, replayed: true };
  }

  const { source, destination } = await lockBothAccounts(
    tx,
    userId,
    fromAccountId,
    toAccountId
  );

  // Every rule, against the rows the database returned under the lock -- never
  // against anything the caller said about them. The funds check in here is
  // the one that needed the lock to mean anything.
  const verdict = checkTransfer({ source, destination, amount });
  if (!verdict.ok) throw new TransferError(verdict.code);

  // The plan comes from the database, like every other authorisation decision.
  // One unit for the whole transfer -- see lib/billing/quota.js. A refusal
  // throws and the transaction rolls back, so nothing has to be given back.
  const planId = await effectivePlanId(userId, { tx });
  await consumeDailyTransaction(tx, userId, planId);

  const transfer = await tx.transfer.create({
    data: {
      id: randomUUID(),
      userId,
      fromAccountId: source.id,
      toAccountId: destination.id,
      amount,
      // Both accounts', verified equal by checkTransfer above. Read from the
      // row, never from the payload and never from the currency the person
      // happens to be reading in.
      currency: source.currency,
      date,
      description: description ?? null,
      idempotencyKey,
      legs: {
        create: [
          {
            type: "TRANSFER_OUT",
            amount,
            currency: source.currency,
            date,
            category: LEG_CATEGORY.TRANSFER_OUT,
            description: legDescription(destination.name, description),
            userId,
            accountId: source.id,
          },
          {
            type: "TRANSFER_IN",
            amount,
            currency: destination.currency,
            date,
            category: LEG_CATEGORY.TRANSFER_IN,
            description: inboundDescription(source.name, description),
            userId,
            accountId: destination.id,
          },
        ],
      },
    },
    ...withLegs,
  });

  // The same function that moves a balance for an ordinary transaction, which
  // is what keeps openingBalance() and the statements drawn from it correct.
  // `increment`, not an absolute write computed from the balance read above:
  // the read is for deciding, the increment is for applying, and only the
  // second is safe.
  await tx.account.update({
    where: { id: source.id },
    data: { balance: { increment: balanceEffect("TRANSFER_OUT", amount) } },
  });
  await tx.account.update({
    where: { id: destination.id },
    data: { balance: { increment: balanceEffect("TRANSFER_IN", amount) } },
  });

  return { transfer, replayed: false };
}

/**
 * Deletes a transfer and reverses both balances.
 *
 * Transfers are immutable -- there is no update path and the RLS policy admits
 * none -- so this is how a mistake is corrected: delete it and make another.
 *
 * Both legs go with the row, by `ON DELETE CASCADE`, in the same statement.
 * The balances are reversed by unwinding each leg through balanceEffect, which
 * is the same arithmetic bulkDeleteTransactions does for an ordinary
 * transaction, so there is one rule for "deleting a row gives the money back"
 * rather than two that can disagree.
 *
 * Locks both accounts first, for the same reason the create does: the
 * reversal is an increment, but taking the lock serialises a delete against a
 * concurrent transfer out of the same account so the funds check that one
 * makes sees a settled balance.
 */
export async function deleteTransfer({ tx, userId, transferId }) {
  if (typeof transferId !== "string" || transferId === "") {
    throw new TransferError("NOT_FOUND", "That transfer no longer exists.");
  }

  const transfer = await tx.transfer.findFirst({
    where: { id: transferId, userId },
    ...withLegs,
  });
  // findFirst scoped to the tenant, so somebody else's transfer is not found
  // rather than refused -- the same reason rules.js keeps its two "not
  // available" messages identical.
  if (!transfer) {
    throw new TransferError("NOT_FOUND", "That transfer no longer exists.");
  }

  await lockBothAccounts(tx, userId, transfer.fromAccountId, transfer.toAccountId);

  const amount = transfer.amount.toNumber();

  // Deleted by id, so the cascade removes exactly these two legs.
  await tx.transfer.delete({ where: { id: transfer.id } });

  // Backing out each leg's effect: the negation of what it applied.
  await tx.account.updateMany({
    where: { id: transfer.fromAccountId, userId },
    data: { balance: { increment: -balanceEffect("TRANSFER_OUT", amount) } },
  });
  await tx.account.updateMany({
    where: { id: transfer.toAccountId, userId },
    data: { balance: { increment: -balanceEffect("TRANSFER_IN", amount) } },
  });

  return { transfer };
}

/** One transfer of this user's, with both legs and both account names. */
export async function findTransfer({ tx, userId, transferId }) {
  if (typeof transferId !== "string" || transferId === "") return null;
  return tx.transfer.findFirst({ where: { id: transferId, userId }, ...withLegs });
}

export { TRANSFER_ERRORS };
