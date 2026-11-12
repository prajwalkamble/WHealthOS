import { describe, it, expect } from "vitest";

const {
  AMOUNT_LIMIT,
  TRANSFER_ERRORS,
  TRANSFER_MESSAGES,
  checkAmount,
  checkTransfer,
  messageFor,
  projectedBalances,
} = await import("@/lib/transfers/rules");

const {
  TRANSFER_TYPES,
  TYPE_LABEL,
  amountClass,
  amountSign,
  amountTone,
  balanceEffect,
  isExpenseType,
  isIncomeType,
  isTransferType,
  openingBalance,
  typeLabel,
} = await import("@/lib/money");

const { transferInputSchema, transferSchema, parseOrThrow } = await import(
  "@/app/lib/schema"
);

// Everything a transfer can be refused for, decided without a database.
//
// The integration suite (tests/transfer-integration.test.js) proves the
// service applies these against real rows under a real lock. This file proves
// the rules themselves, which is the cheaper half and the one that can
// enumerate every edge the brief lists.

const account = (over = {}) => ({
  id: "acc-1",
  name: "Savings",
  currency: "INR",
  balance: 50000,
  ...over,
});

describe("balanceEffect and the transfer types", () => {
  it("signs both legs the way the ledger needs", () => {
    expect(balanceEffect("INCOME", 500)).toBe(500);
    expect(balanceEffect("EXPENSE", 500)).toBe(-500);
    expect(balanceEffect("TRANSFER_OUT", 500)).toBe(-500);
    expect(balanceEffect("TRANSFER_IN", 500)).toBe(500);
  });

  it("conserves value: the two legs of one transfer sum to zero", () => {
    // Invariant 1 and invariant 2 in their smallest form. Whatever else is
    // true, the debit and the credit of one transfer must cancel -- otherwise
    // an internal transfer changes the person's total net worth.
    for (const amount of [1, 0.01, 999.99, 123456.78, AMOUNT_LIMIT]) {
      expect(
        balanceEffect("TRANSFER_OUT", amount) + balanceEffect("TRANSFER_IN", amount)
      ).toBe(0);
    }
  });

  it("classifies the four types without a binary fallback", () => {
    // The bug this guards is specific: every aggregation in the app used to
    // read `type === "INCOME" ? income : expenses`, so a transfer became an
    // expense the moment the enum grew. isIncomeType/isExpenseType are
    // positive tests for exactly one type each, so neither can collect a new
    // one by default.
    expect(isIncomeType("INCOME")).toBe(true);
    expect(isExpenseType("EXPENSE")).toBe(true);
    for (const type of TRANSFER_TYPES) {
      expect(isTransferType(type)).toBe(true);
      expect(isIncomeType(type)).toBe(false);
      expect(isExpenseType(type)).toBe(false);
    }
    expect(isTransferType("INCOME")).toBe(false);
    expect(isTransferType("EXPENSE")).toBe(false);
  });

  it("keeps openingBalance correct across transfer legs", () => {
    // openingBalance unwinds history through balanceEffect, and lib/money.js
    // states the invariant it depends on: balanceEffect is the only thing that
    // writes to Account.balance. Transfers are recorded as transaction legs
    // precisely so that stays true, and this is the assertion of it.
    const since = [
      { type: "INCOME", amount: 20000 },
      { type: "EXPENSE", amount: 5000 },
      { type: "TRANSFER_OUT", amount: 10000 },
      { type: "TRANSFER_IN", amount: 2500 },
    ];
    const opening = openingBalance(50000, since);
    expect(opening).toBe(50000 - 20000 + 5000 + 10000 - 2500);

    // And replaying forwards from the opening balance lands back on today's.
    const replayed = since.reduce(
      (balance, t) => balance + balanceEffect(t.type, t.amount),
      opening
    );
    expect(replayed).toBe(50000);
  });

  it("draws both transfer legs neutrally, and signs them by direction", () => {
    expect(amountTone("INCOME")).toBe("positive");
    expect(amountTone("EXPENSE")).toBe("negative");
    // Not green and not red: a transfer is neither a gain nor a loss.
    expect(amountTone("TRANSFER_OUT")).toBe("neutral");
    expect(amountTone("TRANSFER_IN")).toBe("neutral");
    expect(amountClass("TRANSFER_OUT")).toBe("text-muted-foreground");

    expect(amountSign("TRANSFER_OUT")).toBe("-");
    expect(amountSign("TRANSFER_IN")).toBe("+");
    expect(amountSign("EXPENSE")).toBe("-");
    expect(amountSign("INCOME")).toBe("+");
  });

  it("labels both legs simply Transfer", () => {
    expect(typeLabel("TRANSFER_OUT")).toBe("Transfer");
    expect(typeLabel("TRANSFER_IN")).toBe("Transfer");
    expect(typeLabel("INCOME")).toBe("Income");
    // Every type has a label, so no badge can render a raw enum value.
    for (const type of ["INCOME", "EXPENSE", ...TRANSFER_TYPES]) {
      expect(TYPE_LABEL[type]).toBeTruthy();
    }
  });
});

describe("Amount validation", () => {
  it("refuses everything that is not a positive number", () => {
    for (const bad of ["", null, undefined, 0, -1, -0.01, NaN, Infinity, -Infinity, "abc", {}, []]) {
      expect(checkAmount(bad, "INR")).toBe(TRANSFER_ERRORS.AMOUNT_INVALID);
    }
  });

  it("accepts a decimal amount, and whitespace or leading zeros around one", () => {
    expect(checkAmount(1234.56, "INR")).toBeNull();
    // Number() handles these, which is what the schema coerces through.
    expect(checkAmount(" 1234.56 ", "INR")).toBeNull();
    expect(checkAmount("007.50", "INR")).toBeNull();
  });

  it("accepts scientific notation that lands on a legal value", () => {
    // "1e3" is 1000, which is a perfectly good transfer. Refusing it for its
    // notation would be refusing a number for how it was typed.
    expect(checkAmount("1e3", "INR")).toBeNull();
    // But 1e-7 is a sub-paisa amount and fails on precision, not on format.
    expect(checkAmount("1e-7", "INR")).toBe(TRANSFER_ERRORS.AMOUNT_PRECISION);
  });

  it("refuses more decimal places than the currency has", () => {
    expect(checkAmount(100.005, "INR")).toBe(TRANSFER_ERRORS.AMOUNT_PRECISION);
    expect(checkAmount(100.01, "INR")).toBeNull();
    // Yen has no minor unit at all, so anything after the point is too much.
    expect(checkAmount(100.5, "JPY")).toBe(TRANSFER_ERRORS.AMOUNT_PRECISION);
    expect(checkAmount(100, "JPY")).toBeNull();
  });

  it("caps the amount at the same ceiling as every other money value", () => {
    expect(checkAmount(AMOUNT_LIMIT, "INR")).toBeNull();
    expect(checkAmount(AMOUNT_LIMIT + 1, "INR")).toBe(
      TRANSFER_ERRORS.AMOUNT_TOO_LARGE
    );
    expect(checkAmount(1e308, "INR")).toBe(TRANSFER_ERRORS.AMOUNT_TOO_LARGE);
  });

  it("uses the same ceiling the transaction schema does", () => {
    // rules.js defines AMOUNT_LIMIT itself rather than importing it from
    // app/lib/schema.js, which would be circular. This is the assertion that
    // keeps the two from drifting: a transfer and a transaction must not
    // disagree about how much money is too much.
    const tooBig = parseOrThrow.name && AMOUNT_LIMIT + 1;
    let schemaRefused = false;
    try {
      parseOrThrow(transferInputSchema, {
        fromAccountId: "a",
        toAccountId: "b",
        amount: tooBig,
        date: new Date(),
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      });
    } catch {
      schemaRefused = true;
    }
    expect(schemaRefused).toBe(true);
  });
});

describe("checkTransfer", () => {
  it("accepts a plain same-currency transfer within the balance", () => {
    expect(
      checkTransfer({
        source: account(),
        destination: account({ id: "acc-2", name: "Current", balance: 20000 }),
        amount: 10000,
      })
    ).toEqual({ ok: true });
  });

  it("accepts a transfer of the entire balance", () => {
    // The boundary, and a case that a naive float comparison gets wrong. See
    // the minor-unit comparison in rules.js.
    expect(
      checkTransfer({
        source: account({ balance: 0.3 }),
        destination: account({ id: "acc-2", balance: 0 }),
        amount: 0.3,
      }).ok
    ).toBe(true);
  });

  it("refuses more than the balance", () => {
    expect(
      checkTransfer({
        source: account({ balance: 10000 }),
        destination: account({ id: "acc-2" }),
        amount: 10000.01,
      })
    ).toEqual({ ok: false, code: TRANSFER_ERRORS.INSUFFICIENT_FUNDS });
  });

  it("allows an overdraft only when explicitly asked to", () => {
    // Not reachable from the application -- nothing passes this flag -- but it
    // is the seam the policy lives on, so it is asserted rather than assumed.
    expect(
      checkTransfer({
        source: account({ balance: 10 }),
        destination: account({ id: "acc-2" }),
        amount: 1000,
        allowOverdraft: true,
      }).ok
    ).toBe(true);
  });

  it("refuses the same account on both sides", () => {
    const one = account();
    expect(checkTransfer({ source: one, destination: one, amount: 1 })).toEqual({
      ok: false,
      code: TRANSFER_ERRORS.SAME_ACCOUNT,
    });
  });

  it("refuses a missing account on either side", () => {
    expect(
      checkTransfer({ source: null, destination: account(), amount: 1 })
    ).toEqual({ ok: false, code: TRANSFER_ERRORS.SOURCE_NOT_FOUND });
    expect(
      checkTransfer({ source: account(), destination: null, amount: 1 })
    ).toEqual({ ok: false, code: TRANSFER_ERRORS.DESTINATION_NOT_FOUND });
  });

  it("refuses two different currencies", () => {
    expect(
      checkTransfer({
        source: account({ currency: "USD", balance: 1000 }),
        destination: account({ id: "acc-2", currency: "INR" }),
        amount: 10,
      })
    ).toEqual({ ok: false, code: TRANSFER_ERRORS.CURRENCY_MISMATCH });
  });

  it("gives away nothing about whether another user's account exists", () => {
    // The two "not available" messages are deliberately identical, so a caller
    // probing account ids cannot tell a non-existent one from one that belongs
    // to somebody else.
    expect(TRANSFER_MESSAGES.SOURCE_NOT_FOUND).toBe(
      TRANSFER_MESSAGES.DESTINATION_NOT_FOUND
    );
    for (const message of Object.values(TRANSFER_MESSAGES)) {
      expect(message).not.toMatch(/user|tenant|row|table|constraint|null/i);
    }
  });

  it("has a message for every code, and a fallback for an unknown one", () => {
    for (const code of Object.values(TRANSFER_ERRORS)) {
      expect(TRANSFER_MESSAGES[code]).toBeTruthy();
      expect(messageFor(code)).toBe(TRANSFER_MESSAGES[code]);
    }
    // Never the raw code -- the thing TransferError's constructor exists to
    // prevent reaching a person.
    expect(messageFor("SOMETHING_NEW")).toBe("That transfer can't be made.");
    expect(messageFor(undefined)).not.toMatch(/undefined/);
  });

  it("checks the currency before the amount's precision", () => {
    // Order matters: the precision rule depends on which currency the amount
    // is in, so a mismatched pair has to be refused first or a JPY amount
    // would be judged by INR's digits.
    expect(
      checkTransfer({
        source: account({ currency: "JPY", balance: 100000 }),
        destination: account({ id: "acc-2", currency: "INR" }),
        amount: 100.5,
      }).code
    ).toBe(TRANSFER_ERRORS.CURRENCY_MISMATCH);
  });
});

describe("projectedBalances", () => {
  it("moves exactly the amount, and no more", () => {
    const { source, destination } = projectedBalances({
      sourceBalance: 50000,
      destinationBalance: 20000,
      amount: 10000,
    });
    expect(source).toBe(40000);
    expect(destination).toBe(30000);
    // The brief's worked example: the combined total does not change.
    expect(source + destination).toBe(70000);
  });
});

describe("The transfer payload schema", () => {
  const valid = {
    fromAccountId: "acc-1",
    toAccountId: "acc-2",
    amount: "2500.50",
    date: "2026-11-12T00:00:00.000Z",
    description: "  moving some over  ",
    idempotencyKey: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  };

  it("coerces and trims what it keeps", () => {
    const parsed = parseOrThrow(transferInputSchema, valid);
    expect(parsed.amount).toBe(2500.5);
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.description).toBe("moving some over");
  });

  it("drops anything it was not asked for", () => {
    // The reason the payload is parsed rather than spread: a crafted body
    // offering a user id, a currency, a status or a transfer id must lose
    // those keys before they can reach a Prisma create.
    const parsed = parseOrThrow(transferInputSchema, {
      ...valid,
      userId: "someone-else",
      currency: "USD",
      status: "COMPLETED",
      id: "forged",
      sourceAmount: 1,
      exchangeRate: 83,
    });
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed).not.toHaveProperty("currency");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("exchangeRate");
    expect(Object.keys(parsed).sort()).toEqual([
      "amount",
      "date",
      "description",
      "fromAccountId",
      "idempotencyKey",
      "toAccountId",
    ]);
  });

  it("requires an idempotency key, and requires it to be a UUID", () => {
    const refuse = (over) => {
      let failed = false;
      try {
        parseOrThrow(transferInputSchema, { ...valid, ...over });
      } catch {
        failed = true;
      }
      return failed;
    };
    expect(refuse({ idempotencyKey: undefined })).toBe(true);
    expect(refuse({ idempotencyKey: "" })).toBe(true);
    expect(refuse({ idempotencyKey: "not-a-uuid" })).toBe(true);
    expect(refuse({ idempotencyKey: "a".repeat(400) })).toBe(true);
  });

  it("refuses the same account twice, naming the field the form marks", () => {
    let issue = null;
    try {
      parseOrThrow(transferInputSchema, { ...valid, toAccountId: "acc-1" });
    } catch (error) {
      issue = error;
    }
    expect(issue).toBeTruthy();
    expect(issue.message).toMatch(/two different accounts/i);
  });

  it("refuses a zero, negative or non-numeric amount", () => {
    for (const amount of ["0", "-100", "abc", ""]) {
      let failed = false;
      try {
        parseOrThrow(transferInputSchema, { ...valid, amount });
      } catch {
        failed = true;
      }
      expect(failed, `amount ${JSON.stringify(amount)}`).toBe(true);
    }
  });

  it("keeps the form schema in step with the server one", () => {
    // The form schema is what the browser validates against; the server one is
    // what actually decides. They must agree about the same-account rule, or
    // the form lets through something the server then refuses with no field
    // marked.
    const result = transferSchema.safeParse({
      fromAccountId: "acc-1",
      toAccountId: "acc-1",
      amount: "100",
      date: new Date(),
      description: "",
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(["toAccountId"]);
  });
});
