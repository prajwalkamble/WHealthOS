"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { withCurrentTenant } from "@/lib/prisma";
import { serializeDecimals } from "@/lib/queries";
import { LANDING_STATS_TAG } from "@/lib/stats";
import { ActionError, runAction } from "@/lib/action-error";
import { enforceRateLimit } from "@/lib/arcjet";
import { requireClerkUserId } from "@/lib/session";
import { QuotaError } from "@/lib/billing/quota";
import { messageFor } from "@/lib/transfers/rules";
import {
  createTransfer,
  deleteTransfer,
  TransferError,
} from "@/lib/transfers/service";
import { transferInputSchema, parseOrThrow } from "@/app/lib/schema";

// The public surface of the transfer feature: two endpoints, both of which are
// thin. Everything that decides anything is in lib/transfers/, which is where
// the tests reach it without a Next request.
//
// No entitlement gate, and that is a decision rather than an omission.
// Transfers are part of "Add and manage transactions" in data/pricing.js --
// free on every plan, like adding a transaction -- so gating them would be
// inventing a restriction the pricing page does not advertise. The daily
// transaction quota still applies, at one unit per transfer.
//
// There is deliberately no updateTransfer. A transfer is immutable: correcting
// one means deleting it, which reverses both balances atomically, and making
// another. The RLS policy on the table admits no UPDATE at all, so this is a
// guarantee rather than a convention.

// What the browser is allowed to see of a transfer. Built explicitly rather
// than serialising the row, because `idempotencyKey` must not leave the server
// -- it is scoped with the user's internal id, and the internal id is not
// something a client has any business holding.
const present = (transfer) => ({
  id: transfer.id,
  amount: transfer.amount.toNumber(),
  currency: transfer.currency,
  date: transfer.date,
  description: transfer.description,
  from: transfer.fromAccount
    ? { id: transfer.fromAccount.id, name: transfer.fromAccount.name }
    : { id: transfer.fromAccountId, name: null },
  to: transfer.toAccount
    ? { id: transfer.toAccount.id, name: transfer.toAccount.name }
    : { id: transfer.toAccountId, name: null },
  legs: (transfer.legs ?? []).map(serializeDecimals),
  createdAt: transfer.createdAt,
});

// Both accounts, the dashboard and the two list pages. Called after the commit
// and never before: a view refreshed from an uncommitted transfer would show a
// balance that is about to be rolled back.
function revalidateFor(transfer) {
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath(`/account/${transfer.fromAccountId ?? transfer.from?.id}`);
  revalidatePath(`/account/${transfer.toAccountId ?? transfer.to?.id}`);
  revalidateTag(LANDING_STATS_TAG);
}

export async function createInternalTransfer(rawData) {
  return runAction(async () => {
    const clerkUserId = await requireClerkUserId();
    // The transaction limiter rather than the generic write one: a transfer
    // writes the same kind of rows a transaction does, at the same rate.
    await enforceRateLimit("transaction", clerkUserId);

    // A server action is a public HTTP endpoint, so the payload is validated
    // here and not trusted from the form. Parsing also drops unknown keys, so
    // a crafted body cannot smuggle a userId, a currency or a status into the
    // create.
    const input = parseOrThrow(transferInputSchema, rawData);

    const { transfer, replayed } = await withCurrentTenant((tx, userId) =>
      createTransfer({ tx, userId, input })
    ).catch((error) => {
      // Three kinds of refusal reach a person differently.
      //
      // runAction only passes an ActionError's message through to the browser
      // and turns everything else into "Something went wrong" -- which for
      // "that's more than the account holds" would be a message nobody can
      // act on. So the ones a person can do something about are translated
      // deliberately, and anything else is left to become the generic error
      // rather than leaking a constraint name or a database message.
      if (error instanceof TransferError) {
        throw new ActionError(error.message ?? messageFor(error.code));
      }
      if (error instanceof QuotaError) throw new ActionError(error.message);
      throw error;
    });

    // A replay revalidates too. The first request may have committed and then
    // had its response lost, in which case the client's caches are exactly as
    // stale as they would be after a fresh transfer.
    revalidateFor(transfer);

    return { success: true, data: present(transfer), replayed };
  });
}

export async function deleteInternalTransfer(transferId) {
  return runAction(async () => {
    const clerkUserId = await requireClerkUserId();
    await enforceRateLimit("write", clerkUserId);

    const { transfer } = await withCurrentTenant((tx, userId) =>
      deleteTransfer({ tx, userId, transferId })
    ).catch((error) => {
      if (error instanceof TransferError) {
        throw new ActionError(error.message ?? messageFor(error.code));
      }
      throw error;
    });

    revalidateFor(transfer);

    return { success: true, data: { id: transfer.id } };
  });
}
