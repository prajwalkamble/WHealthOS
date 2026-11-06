import { getCurrentUserId, withTenant } from "@/lib/prisma";
import { formatCurrency } from "./format.js";
import { rateFor, rateTable } from "./rates/store.js";
import { convertWithRate, presentationFor } from "./convert-client.js";
import { DEFAULT_CURRENCY, coerceCurrency } from "./registry.js";

// Turning "what currency do they want to read in" into "what should this page
// multiply by".
//
// The observation this rests on: every money figure on a dashboard is a LINEAR
// aggregate of the records behind it -- a sum, a difference, a subtotal. So if
// every record is in one currency, one scalar converts all of them, exactly,
// and in a way that can be reproduced later from the stored rate. Percentages
// and savings rates are ratios and are unaffected, which is why they need no
// special handling anywhere.
//
// That is only true while the ledger holds ONE currency. The moment it holds
// two, a single scalar is wrong and each component has to be converted from
// its own currency -- which is what lib/currency/convert.js sumInCurrency
// does, per figure, and what the loaders would have to call. Until an account
// can be given a currency through the UI that case cannot arise, so it is
// detected and refused rather than approximated.

/**
 * The distinct currencies this person's accounts are held in.
 *
 * Accounts rather than transactions: a transaction's currency is copied from
 * its account at write time, so the accounts are the authority and the query
 * is one indexed read instead of a scan.
 */
export async function ledgerCurrencies(userId) {
  const rows = await withTenant(userId, (tx) =>
    tx.account.findMany({ select: { currency: true }, distinct: ["currency"] })
  );
  const codes = [...new Set(rows.map((row) => coerceCurrency(row.currency)))];
  // No accounts yet: nothing to convert, and the default is as good an answer
  // as any for a dashboard with no figures on it.
  return codes.length ? codes : [DEFAULT_CURRENCY];
}

/**
 * Everything the browser needs to decide presentation for itself.
 *
 * The ledger it holds, and the current rate table -- both plain, serialisable
 * and small. Handed to the client ONCE per page load, after which changing
 * currency is a local state update: the client has the same inputs the server
 * had, so it reaches the same answer without asking.
 *
 * This is the whole of the optimisation. Everything else follows from the
 * client no longer needing permission to do arithmetic.
 */
export async function presentationData(userId) {
  const [ledger, rates] = await Promise.all([
    ledgerCurrencies(userId).catch(() => [DEFAULT_CURRENCY]),
    rateTable().catch(() => ({ base: "EUR", rates: {}, asOf: null, stale: true })),
  ]);
  return { ledger, rates };
}

/**
 * How this request's figures should be presented, resolved on the server.
 *
 * Delegates the decision to the same pure function the browser runs, so the
 * two cannot disagree -- a server that converted and a client that refused
 * would flicker on hydration and argue about a balance.
 *
 * Kept for server components, which cannot read React context.
 */
export async function displayConversion(userId, display, { on = new Date() } = {}) {
  let ledger = [DEFAULT_CURRENCY];
  try {
    ledger = await ledgerCurrencies(userId);
  } catch {
    // A dashboard must not fail over a presentation detail.
  }

  let table = { base: "EUR", rates: {}, asOf: null, stale: true };
  try {
    table = await rateTable({ on });
  } catch {
    // No rates: the decision below refuses, which formats in the ledger's
    // own currency. Correct, and the same answer the client would reach.
  }

  const decision = presentationFor({
    ledger,
    target: coerceCurrency(display),
    rates: table.rates,
    base: table.base,
    asOf: table.asOf,
    stale: table.stale,
  });

  return {
    ...decision,
    // No `scale` field. There used to be a Number here and it is exactly the
    // trap worth removing: the arithmetic is integer now, and a float called
    // "scale" invites a caller to multiply by it and reintroduce the error
    // the BigInt path exists to avoid. `convert` is the only way in.
    convert: (amount) =>
      decision.applies
        ? convertWithRate(amount, decision.rate, decision.from, decision.currency)
        : Number(amount),
  };
}

/**
 * A formatter for a SERVER component, carrying this request's conversion.
 *
 * Server components cannot read the provider, so without this they would
 * format with the raw display currency -- which is exactly the relabelling
 * the provider exists to prevent, reintroduced on the one page that renders
 * on the server. It resolves the signed-in user itself so a caller only has
 * to ask for a formatter.
 *
 * Returns the conversion alongside, for a page that wants to say something
 * about it.
 */
export async function serverCurrency(display) {
  let userId = null;
  try {
    userId = await getCurrentUserId();
  } catch {
    // Signed out, or no row yet. The refusal path below formats in the
    // ledger default and converts nothing, which is correct for both.
  }

  const conversion = userId
    ? await displayConversion(userId, display)
    : {
        applies: false,
        currency: DEFAULT_CURRENCY,
        from: DEFAULT_CURRENCY,
        target: coerceCurrency(display),
        exact: false,
        stale: false,
        asOf: null,
        reason: "no-user",
        ledger: [DEFAULT_CURRENCY],
        // No user, so nothing to convert: the figure is already in the
        // currency it will be shown in.
        convert: (amount) => Number(amount),
      };

  return {
    conversion,
    currency: conversion.currency,
    // The same conversion the browser applies, through the same integer
    // arithmetic. A server-rendered figure and a client-rendered one on the
    // same page must agree to the paisa.
    format: (value) => formatCurrency(conversion.convert(value), conversion.currency),
  };
}
