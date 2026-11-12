// Analytics aggregation.
//
// Every figure on the Analytics page is computed here from real transaction
// rows. Nothing is estimated, projected or interpreted: the page reports what
// the ledger says and stops.
//
// Two rules this file exists to enforce:
//
//   1. A percentage change against a zero baseline is not 0%, and it is not
//      infinity. It is unanswerable, and `change()` returns null so the UI can
//      say "no prior data" instead of printing a number that means nothing.
//
//   2. Amounts are summed directly because the schema has no currency column:
//      every transaction is in one currency. If a currency column is ever
//      added, these sums become wrong and must be grouped by it first.

import { APP_TIME_ZONE, monthBoundsFor, previousMonth, zonedYearMonth } from "./time";
// isTransferType / isIncomeType rather than a local `type === "INCOME"` test.
// Every money total in this file used a binary split, which silently filed
// internal transfers as spending the moment the transaction types grew.
import { isIncomeType, isTransferType } from "./money";

// Percentage change from `before` to `after`.
//
// null means "cannot be expressed": there was nothing before, so any increase
// is an infinite proportion of it. The caller is expected to render that as
// text rather than as a number.
export function change(after, before) {
  if (!Number.isFinite(after) || !Number.isFinite(before)) return null;
  if (before === 0) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

// The month a period starts in, and the N months before it, oldest first.
export function monthWindow(months, from = new Date()) {
  const out = [];
  let cursor = zonedYearMonth(from);
  for (let i = 0; i < months; i++) {
    out.unshift(cursor);
    cursor = previousMonth(cursor);
  }
  return out;
}

// Bounds covering a whole window, so one query can fetch every month at once.
export function windowBounds(window) {
  const first = monthBoundsFor(window[0].year, window[0].month);
  const last = monthBoundsFor(
    window[window.length - 1].year,
    window[window.length - 1].month
  );
  return { startOfMonth: first.startOfMonth, endOfMonth: last.endOfMonth };
}

// Which month of the window a date belongs to, in the app's timezone rather
// than the server's, so a transaction at 23:30 on the 31st does not land in
// the following month for a user in another zone.
// month + 1 because lib/time.js works in 0-11, as JS Date does. Padding the
// raw index produced "2026-09" for October: self-consistent for bucketing, but
// a key nobody could read correctly and a month out for anything that later
// formats from it.
export function monthKeyOf(date, timeZone = APP_TIME_ZONE) {
  return keyOf(zonedYearMonth(date, timeZone));
}

export const keyOf = ({ year, month }) =>
  `${year}-${String(month + 1).padStart(2, "0")}`;

// Income, expenses and net per month across the window.
//
// Months with no activity are present with zeros rather than missing, so the
// chart has a continuous axis instead of silently collapsing a quiet month.
export function monthlyFlow(window, transactions) {
  const buckets = new Map(
    window.map((m) => [keyOf(m), { income: 0, expenses: 0 }])
  );

  for (const row of transactions) {
    const bucket = buckets.get(monthKeyOf(row.date));
    if (!bucket) continue;
    // Transfer legs are neither, and are skipped rather than falling into the
    // `else`. Moving money between two of your own accounts is not a month's
    // spending, and the old binary split counted every TRANSFER_OUT as one.
    if (isTransferType(row.type)) continue;
    if (isIncomeType(row.type)) bucket.income += row.amount;
    else bucket.expenses += row.amount;
  }

  return window.map((m) => {
    const { income, expenses } = buckets.get(keyOf(m));
    return { year: m.year, month: m.month, income, expenses, net: income - expenses };
  });
}

// Spending by category for one period, with the same categories in the period
// before it, so each row can carry its own change.
export function categoryBreakdown(current, previous) {
  const sum = (rows) => {
    const out = new Map();
    for (const row of rows) {
      if (row.type !== "EXPENSE") continue;
      const entry = out.get(row.category) ?? { amount: 0, count: 0 };
      entry.amount += row.amount;
      entry.count += 1;
      out.set(row.category, entry);
    }
    return out;
  };

  const now = sum(current);
  const before = sum(previous);
  const total = [...now.values()].reduce((s, e) => s + e.amount, 0);

  // Every category present in either period, so one that stopped entirely is
  // still reported rather than vanishing from the comparison.
  const categories = new Set([...now.keys(), ...before.keys()]);

  return [...categories]
    .map((category) => {
      const amount = now.get(category)?.amount ?? 0;
      const previousAmount = before.get(category)?.amount ?? 0;
      return {
        category,
        amount,
        count: now.get(category)?.count ?? 0,
        previousAmount,
        // Guarded: a period with no spending at all would divide by zero.
        share: total > 0 ? (amount / total) * 100 : 0,
        changePercent: change(amount, previousAmount),
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

// The totals the page leads with, for one period and the one before it.
export function periodTotals(rows) {
  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    // Skipped, not defaulted into expenses. This function also feeds the
    // savings rate, where counting a transfer as spending would report
    // somebody who moved ₹10,000 into savings as having saved less.
    if (isTransferType(row.type)) continue;
    if (isIncomeType(row.type)) income += row.amount;
    else expenses += row.amount;
  }
  const net = income - expenses;
  return {
    income,
    expenses,
    net,
    // Savings rate is only meaningful against income that exists. With no
    // income the rate is undefined, not zero -- spending with no earnings is
    // not a 0% savings rate, it is a question the data cannot answer.
    savingsRate: income > 0 ? (net / income) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Cashflow
//
// The Sankey on the Analytics page: income on the left, one pool in the
// middle, expenses and whatever is left over on the right.
//
// What the shape does and does not claim
// --------------------------------------
// A Sankey normally says "this much of that flowed into this". The ledger here
// cannot support that claim: a transaction has a type, an amount, a date and a
// category, and nothing records that a particular salary payment paid a
// particular rent. Drawing Salary straight through to Housing would be an
// invention.
//
// So every income category flows into one node and every expense category
// flows out of it. That is arithmetic rather than attribution: it says only
// that the period took in this much in total and paid out this much in total,
// which is exactly what the rows support. The middle node is the period's
// cash, not an account and not a balance.
//
// When the period spends more than it earns there is no surplus to draw, and
// the difference did not come from income. It is shown as its own inflow --
// money drawn from what was already there -- so the diagram balances without
// claiming the period funded itself.
//
// Period, not balance: everything here is the movement inside the window. It
// is not what anyone has.

// The ranges the chart offers, in the vocabulary the account chart already
// uses, with a year added because a cashflow is worth seeing annually.
export const CASHFLOW_RANGES = {
  "7D": { days: 7, label: "Last 7 days" },
  "1M": { days: 30, label: "Last 30 days" },
  "3M": { days: 90, label: "Last 90 days" },
  "6M": { days: 180, label: "Last 180 days" },
  "1Y": { days: 365, label: "Last 12 months" },
};

export const DEFAULT_CASHFLOW_RANGE = "1M";

export function resolveCashflowRange(key) {
  return Object.hasOwn(CASHFLOW_RANGES, String(key)) ? String(key) : DEFAULT_CASHFLOW_RANGE;
}

// What a transaction with no usable category is filed under. The id is not one
// of data/categories.js's, deliberately: it is this chart's own bucket and
// nothing else should pick it up as a real category.
export const UNCATEGORIZED = "__uncategorized__";

// The three nodes that are not categories. Namespaced for the same reason.
export const POOL = "__pool__";
export const SURPLUS = "__surplus__";
export const DRAWN_FROM_BALANCES = "__drawn__";

const bucketKey = (category, known) => {
  const id = typeof category === "string" ? category.trim() : "";
  if (!id) return UNCATEGORIZED;
  return known && !known.has(id) ? UNCATEGORIZED : id;
};

// Income and expenses for one window, grouped by category.
//
// `knownCategories` is optional: when given, a category outside it is filed as
// uncategorised rather than drawn as a node nobody can name.
//
// Rows are counted once each. Nothing is filtered by status, which is what
// every other figure on this page does -- changing that here would make the
// chart disagree with the totals directly above it.
//
// A category whose rows net to zero or less cannot be drawn: a ribbon has no
// negative width. Those are excluded from the diagram and reported separately
// so the caller can say so rather than quietly dropping money.
export function cashflowSummary(transactions, { knownCategories = null } = {}) {
  const income = new Map();
  const expenses = new Map();

  for (const row of transactions) {
    // A transfer has no side of this diagram to be on: it is not money
    // arriving and not money leaving. Drawn as an expense ribbon -- which is
    // what the old ternary did -- it invented a spending category called
    // "Transfer Out" and widened the outflow by money that never left.
    if (isTransferType(row.type)) continue;
    const side = isIncomeType(row.type) ? income : expenses;
    const key = bucketKey(row.category, knownCategories);
    const amount = Number(row.amount) || 0;
    side.set(key, (side.get(key) ?? 0) + amount);
  }

  const split = (map) => {
    const drawn = [];
    const excluded = [];
    for (const [key, amount] of map) {
      (amount > 0 ? drawn : excluded).push({ key, amount });
    }
    drawn.sort((a, b) => b.amount - a.amount);
    return { drawn, excluded };
  };

  const sources = split(income);
  const destinations = split(expenses);
  const total = (rows) => rows.reduce((sum, row) => sum + row.amount, 0);

  // Totals are of what is drawn, so the diagram balances: a ribbon out of the
  // pool for every rupee into it. `excluded` carries the rest.
  const incomeTotal = total(sources.drawn);
  const expenseTotal = total(destinations.drawn);
  const net = incomeTotal - expenseTotal;

  return {
    sources: sources.drawn,
    destinations: destinations.drawn,
    excluded: [...sources.excluded, ...destinations.excluded],
    income: incomeTotal,
    expenses: expenseTotal,
    net,
    // Only one of these is ever non-zero. Surplus is what the period did not
    // spend; drawn is what it spent beyond what it took in, which came from
    // money that was already there.
    surplus: net > 0 ? net : 0,
    drawnFromBalances: net < 0 ? -net : 0,
    transactionCount: transactions.length,
  };
}

// The diagram's own shape: which node is where, and what joins them.
//
// Here rather than in the component because it is index arithmetic over
// amounts, which is the kind of thing that breaks silently and is worth a
// test. It carries no names and no colours -- a node is a key and a side, and
// the drawing decides what either looks like.
//
// Node order is inflows, pool, outflows. Recharts derives depth from the links
// rather than from this order, but keeping it in reading order makes the data
// legible and the indexes stable.
export function cashflowDiagram({ sources, destinations, surplus, drawnFromBalances }) {
  const inflows = [
    ...sources.map(({ key, amount }) => ({ key, amount })),
    ...(drawnFromBalances > 0 ? [{ key: DRAWN_FROM_BALANCES, amount: drawnFromBalances }] : []),
  ];
  const outflows = [
    ...destinations.map(({ key, amount }) => ({ key, amount })),
    ...(surplus > 0 ? [{ key: SURPLUS, amount: surplus }] : []),
  ];

  if (inflows.length === 0 && outflows.length === 0) {
    return { nodes: [], links: [] };
  }

  const pooled = inflows.reduce((sum, row) => sum + row.amount, 0);
  const nodes = [
    ...inflows.map((row) => ({ ...row, side: "source" })),
    { key: POOL, side: "pool", amount: pooled },
    ...outflows.map((row) => ({ ...row, side: "destination" })),
  ];
  const pool = inflows.length;

  return {
    nodes,
    links: [
      ...inflows.map((row, i) => ({ source: i, target: pool, value: row.amount, key: row.key })),
      ...outflows.map((row, i) => ({
        source: pool,
        target: pool + 1 + i,
        value: row.amount,
        key: row.key,
      })),
    ],
  };
}
