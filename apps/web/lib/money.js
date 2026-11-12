// How a transaction type moves money, and the one place that decides it.
//
// Lifted out of actions/transaction.js, which is a "use server" module: every
// export of one is a public endpoint and must be async, so nothing else could
// import this. It now lives here because statements, the importer and the
// transfer service all need the same rule.
//
// This is the single definition of how a row moves a balance. An account's
// stored balance is maintained with it on every create, update and delete,
// which is what makes an opening balance recoverable: take the current balance
// and unwind the effects since the period began. A second copy of this formula
// anywhere would silently desynchronise statements from the ledger.

// The two legs of an internal transfer. Named here, as data, so the places
// that have to exclude transfers from a money total can ask rather than
// restate the pair -- and so adding a third transfer-shaped type later is one
// edit instead of a hunt.
export const TRANSFER_TYPES = ["TRANSFER_OUT", "TRANSFER_IN"];

// Does this row represent money entering or leaving the person's finances, or
// merely moving between two places they already own?
//
// This is the distinction every income, expense, savings-rate, category and
// cash-flow figure in the application depends on. A transfer is NOT earnings
// and NOT spending: ₹10,000 moved from savings to current leaves the person
// exactly as well off as before, so counting it anywhere would overstate both
// sides of their month and push the savings rate towards zero.
export const isTransferType = (type) =>
  type === "TRANSFER_OUT" || type === "TRANSFER_IN";

// True only for real earnings. Written as an explicit test for INCOME rather
// than "not an expense", because `type !== "EXPENSE"` was the shape that made
// every transfer out of an account read as income the moment the enum grew.
export const isIncomeType = (type) => type === "INCOME";

// True only for real spending, and for the same reason.
export const isExpenseType = (type) => type === "EXPENSE";

// The signed change a row applies to its account balance.
//
// Both transfer legs are here because both move a balance: the OUT leg takes
// money off the source exactly as an expense would, and the IN leg adds it to
// the destination exactly as income would. That is the whole point of making
// the legs real transactions -- balanceEffect stays the only thing that writes
// to Account.balance, so openingBalance below keeps working unchanged.
export const balanceEffect = (type, amount) =>
  type === "EXPENSE" || type === "TRANSFER_OUT"
    ? -Number(amount)
    : Number(amount);

// The balance an account held at `from`, worked backwards from what it holds
// now by removing everything that has happened since.
//
// Only correct while balanceEffect above is the only thing that writes to
// Account.balance. It is -- including for transfers, which is why they are
// recorded as transaction legs rather than as two bare balance adjustments.
export const openingBalance = (currentBalance, transactionsSince) =>
  transactionsSince.reduce(
    (balance, t) => balance - balanceEffect(t.type, t.amount),
    Number(currentBalance)
  );

// --- presentation -----------------------------------------------------------
//
// How an amount is signed and coloured, decided once rather than in each of
// the four places that render a transaction row. Every one of those places
// wrote `type === "INCOME" ? "+" : "-"` and `text-positive : text-negative`,
// which put a transfer out in red with a minus as though the person had spent
// the money, and a transfer in green as though they had earned it.

/** "+" or "-", from the direction the row moves its account's balance. */
export const amountSign = (type) => (balanceEffect(type, 1) < 0 ? "-" : "+");

/**
 * Which of the three tones an amount should be drawn in.
 *
 * "neutral" for both transfer legs, deliberately. A transfer is not a gain and
 * not a loss -- the person is exactly as well off afterwards -- so colouring
 * it green or red would be the interface making a claim the ledger does not.
 * The sign still shows which way the money went within the account.
 */
export const amountTone = (type) =>
  isTransferType(type) ? "neutral" : isIncomeType(type) ? "positive" : "negative";

/** The Tailwind class for each tone, so the mapping lives in one file too. */
export const AMOUNT_TONE_CLASS = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-muted-foreground",
};

/** Shorthand: the colour class for a transaction type. */
export const amountClass = (type) => AMOUNT_TONE_CLASS[amountTone(type)];

/**
 * What a transaction type is called in the interface.
 *
 * Both transfer legs read simply "Transfer": which side of it a row is on is
 * already said by its sign and by the account it is listed under, and a badge
 * reading "Transfer Out" on the source and "Transfer In" on the destination
 * repeats that in the one place there is least room for it.
 */
export const TYPE_LABEL = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER_OUT: "Transfer",
  TRANSFER_IN: "Transfer",
};

export const typeLabel = (type) => TYPE_LABEL[type] ?? type;
