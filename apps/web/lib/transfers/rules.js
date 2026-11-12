// What makes an internal transfer legal, as pure functions.
//
// Separate from service.js so every rule here can be tested without a
// database, and so the review screen can apply exactly the same rules the
// server will -- by calling these, not by reimplementing them. A second copy
// of "may this transfer happen" in the browser is how a UI comes to promise
// something the server then refuses.
//
// Nothing here reads a request, a session or the database. The service resolves
// the trusted user, loads both accounts under a row lock and then asks these
// functions about what it found. That order matters: a rule applied to an
// account the client described rather than one the database returned is not a
// rule at all.

import { fractionDigitsOf } from "@/lib/currency/registry";

// The same ceiling every other money value in the application has
// (app/lib/schema.js). Restated as an import would be circular -- schema.js
// imports from here for the transfer schema -- so it is defined here and
// asserted equal in tests/transfers.test.js.
export const AMOUNT_LIMIT = 1_000_000_000;

// Every way a transfer can be refused, as codes rather than sentences.
//
// Codes, because two different callers need two different renderings: the
// server action turns these into the message a person reads, and the review
// screen uses them to decide which field to mark. And because a message is a
// thing that gets reworded, while a code is a thing tests can assert on.
//
// Deliberately coarse on the two "not yours" cases: SOURCE_NOT_FOUND is
// returned both when an account id does not exist and when it exists but
// belongs to somebody else, so a caller cannot use the difference to discover
// whether another user's account id is real.
export const TRANSFER_ERRORS = {
  SOURCE_NOT_FOUND: "SOURCE_NOT_FOUND",
  DESTINATION_NOT_FOUND: "DESTINATION_NOT_FOUND",
  SAME_ACCOUNT: "SAME_ACCOUNT",
  AMOUNT_INVALID: "AMOUNT_INVALID",
  AMOUNT_TOO_LARGE: "AMOUNT_TOO_LARGE",
  AMOUNT_PRECISION: "AMOUNT_PRECISION",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
};

// The message a person sees for each refusal.
//
// None of them names an internal id, a table, a constraint or another user.
// "That account isn't available" is what an attacker probing account ids gets,
// and it is also what somebody whose drawer went stale after deleting an
// account gets, which is the point: the two are indistinguishable.
export const TRANSFER_MESSAGES = {
  SOURCE_NOT_FOUND: "That account isn't available. Pick another one.",
  DESTINATION_NOT_FOUND: "That account isn't available. Pick another one.",
  SAME_ACCOUNT: "Choose two different accounts.",
  AMOUNT_INVALID: "Enter an amount greater than zero.",
  AMOUNT_TOO_LARGE: "That amount is too large.",
  AMOUNT_PRECISION: "That amount has too many decimal places.",
  CURRENCY_MISMATCH:
    "Both accounts have to be in the same currency. Transfers between " +
    "currencies aren't supported yet.",
  INSUFFICIENT_FUNDS: "That's more than the account holds.",
};

export const messageFor = (code) =>
  TRANSFER_MESSAGES[code] ?? "That transfer can't be made.";

/**
 * Is `amount` a well-formed transfer amount in `currency`?
 *
 * Returns a refusal code or null. Three separate checks rather than one,
 * because "too many decimal places" and "too large" are different mistakes and
 * a person can only fix the one they made.
 *
 * The precision check is what stops ₹100.005 -- a value the form accepts, the
 * number type holds exactly, and the database stores faithfully, and which
 * then renders as ₹100.01 on the source and ₹100.01 on the destination while
 * the two balances disagree with the figure by half a paisa each. Digits come
 * from ICU through the registry, so JPY gets zero and INR gets two without
 * this file holding a table that can drift.
 */
export function checkAmount(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return TRANSFER_ERRORS.AMOUNT_INVALID;
  }
  if (value > AMOUNT_LIMIT) return TRANSFER_ERRORS.AMOUNT_TOO_LARGE;

  const digits = fractionDigitsOf(currency);
  // Scale and compare against the rounded value rather than inspecting the
  // decimal string: toFixed would itself round, and a string test would have
  // to cope with exponential notation ("1e-7") that Number happily produces.
  const scaled = value * 10 ** digits;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    return TRANSFER_ERRORS.AMOUNT_PRECISION;
  }
  return null;
}

/**
 * Everything that can be decided about a transfer once both account rows are
 * in hand, in the order a person would want to be told about it.
 *
 * `source` and `destination` are rows from the database -- { id, currency,
 * balance } -- or null when the id did not resolve to one of this user's
 * accounts. `balance` may be a Prisma Decimal or a number.
 *
 * Returns { ok: true } or { ok: false, code }.
 *
 * Order is deliberate. The two "not available" cases come first, because
 * nothing else can be judged without the rows. Same-account next, since it
 * makes every later question meaningless. Currency before the amount, because
 * the amount's own precision rule depends on which currency it is in. Funds
 * last, because it is the only check whose answer can change between one
 * moment and the next -- which is why the service re-runs this one INSIDE the
 * row lock, and why the review screen's version of it is advisory.
 */
export function checkTransfer({ source, destination, amount, allowOverdraft = false }) {
  if (!source) return { ok: false, code: TRANSFER_ERRORS.SOURCE_NOT_FOUND };
  if (!destination) {
    return { ok: false, code: TRANSFER_ERRORS.DESTINATION_NOT_FOUND };
  }
  if (source.id === destination.id) {
    return { ok: false, code: TRANSFER_ERRORS.SAME_ACCOUNT };
  }
  if (source.currency !== destination.currency) {
    return { ok: false, code: TRANSFER_ERRORS.CURRENCY_MISMATCH };
  }

  const amountError = checkAmount(amount, source.currency);
  if (amountError) return { ok: false, code: amountError };

  if (!allowOverdraft) {
    // Compared in minor units as integers. A paisa-level comparison of floats
    // is exactly where "amount equal to the available balance" fails for no
    // reason a person can see: 0.1 + 0.2 > 0.3 is true in binary floating
    // point, and refusing a transfer of the entire balance because of it would
    // be indefensible. Scaling both sides and rounding to integers removes the
    // question.
    const digits = fractionDigitsOf(source.currency);
    const scale = 10 ** digits;
    const available = Math.round(Number(source.balance) * scale);
    const wanted = Math.round(Number(amount) * scale);
    if (wanted > available) {
      return { ok: false, code: TRANSFER_ERRORS.INSUFFICIENT_FUNDS };
    }
  }

  return { ok: true };
}

/**
 * What the two balances become. Display only.
 *
 * The server never computes a balance this way -- it issues `increment`, so
 * the database applies the delta to whatever the row actually holds. This is
 * for the review screen, which has to show the person what they are about to
 * do, and for the tests that assert the review screen and the committed result
 * agree.
 */
export function projectedBalances({ sourceBalance, destinationBalance, amount }) {
  const value = Number(amount);
  return {
    source: Number(sourceBalance) - value,
    destination: Number(destinationBalance) + value,
  };
}
