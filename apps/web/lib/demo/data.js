// Sample data for demo mode.
//
// Deliberately deterministic: the same six months of history every time, so a
// guest reloading the page does not watch their figures jump around, and so
// the numbers in a screenshot can be reproduced. Dates are generated relative
// to today on the app's calendar, so the dashboard always has a current month
// to show whenever the demo is opened.

import { monthBoundsFor, zonedYearMonth, zonedDayOfMonth } from "@/lib/time";

// openingBalance, not balance: the shown balance is the opening figure plus
// everything posted against the account, so a transaction the guest adds moves
// the total instead of leaving it stale.
//
// createdAt sits before the sample history begins, so the Total Balance card
// has a real "balance on the 1st" to compare against rather than treating
// these as accounts opened this month.
const OPENED_MONTHS_AGO = 9;

const openedAt = () => {
  const at = new Date();
  at.setUTCMonth(at.getUTCMonth() - OPENED_MONTHS_AGO);
  return at.toISOString();
};

// The currency the sample figures are written in.
//
// Stated rather than assumed, because the guest dashboard shows them in
// whichever currency the visitor is reading in -- and the only honest way to
// do that is to convert them from a known starting currency at a real rate.
// Relabelling ₹84,250 as ¥84,250 would be a lie about roughly a factor of
// two, and it is the specific thing §12 of the multi-currency brief forbids.
export const DEMO_CURRENCY = "INR";

export const DEMO_ACCOUNTS = [
  {
    id: "demo-account-primary",
    name: "Everyday Account",
    type: "CURRENT",
    openingBalance: 84250,
    isDefault: true,
    createdAt: openedAt(),
  },
  {
    id: "demo-account-savings",
    name: "Savings",
    type: "SAVINGS",
    openingBalance: 215000,
    isDefault: false,
    createdAt: openedAt(),
  },
];

// Sized so the sample month lands comfortably inside it: a demo that opens
// on a red, over-budget bar reads as a warning rather than a tour.
export const DEMO_BUDGET = 75000;

// [category, amount, day of month, description]. Repeated each month with a
// small per-month drift, so the cash-flow chart has movement rather than six
// identical bars.
const MONTHLY_INCOME = [
  ["salary", 92000, 1, "Monthly salary"],
  ["freelance", 14500, 12, "Freelance project"],
  ["investments", 3200, 20, "Dividend payout"],
];

const MONTHLY_EXPENSES = [
  ["housing", 24000, 2, "Rent"],
  ["groceries", 9800, 4, "Groceries"],
  ["utilities", 3400, 6, "Electricity and water"],
  ["transportation", 4200, 8, "Fuel and commute"],
  ["food", 6100, 11, "Eating out"],
  ["entertainment", 2300, 15, "Streaming and cinema"],
  ["shopping", 7400, 18, "Clothing"],
  ["healthcare", 2800, 22, "Pharmacy"],
  ["insurance", 5200, 25, "Health cover"],
];

// A repeatable pseudo-random drift so each month differs but never changes
// between reloads.
const drift = (seed) => 0.82 + ((Math.sin(seed) + 1) / 2) * 0.36;

const MONTHS_OF_HISTORY = 6;

function buildTransactions() {
  const { year, month } = zonedYearMonth();
  const rows = [];
  let n = 0;

  for (let back = MONTHS_OF_HISTORY - 1; back >= 0; back--) {
    const { startOfMonth, endOfMonth } = monthBoundsFor(year, month - back);
    const daysInMonth = new Date(endOfMonth).getUTCDate();

    const add = (type) => ([category, base, day, description], index) => {
      const amount = Math.round(base * drift(back * 13 + index * 7));
      // Clamp to a day the month actually has, and never post in the future:
      // a transaction dated later this month would make "this month" wrong.
      //
      // Dropping the future ones outright emptied the current month early in
      // it. The templates put the earliest expense on day 2, so on the 1st
      // every expense was in the future and the demo dashboard showed a
      // salary, no spending, no category breakdown and no donut -- for the
      // whole of the first day of every month, on the page the public "Try
      // it (Sample Data!)" button leads to.
      //
      // So the current month is compressed into the part of it that has
      // happened rather than truncated: a template day maps proportionally
      // into the elapsed days, which keeps every category present and keeps
      // their order. Earlier months are untouched, and nothing is ever dated
      // ahead of now.
      const elapsed = back === 0 ? Math.min(zonedDayOfMonth(), daysInMonth) : daysInMonth;
      const spread = Math.max(1, Math.ceil((Math.min(day, daysInMonth) / daysInMonth) * elapsed));
      const safeDay = Math.min(spread, daysInMonth);
      const date = new Date(startOfMonth);
      date.setUTCDate(date.getUTCDate() + safeDay - 1);
      if (date > new Date()) return;

      rows.push({
        id: `demo-tx-${++n}`,
        type,
        amount,
        description,
        date: date.toISOString(),
        category,
        // Income and the larger bills sit on the everyday account; a slice of
        // spending comes off savings, so both accounts show activity.
        accountId:
          index % 4 === 3 ? "demo-account-savings" : "demo-account-primary",
        isRecurring: false,
      });
    };

    MONTHLY_INCOME.forEach(add("INCOME"));
    MONTHLY_EXPENSES.forEach(add("EXPENSE"));
  }

  return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Built once per page load rather than at module scope, so a tab left open
// across midnight on the 1st still gets the right month on next navigation.
export const demoTransactions = () => buildTransactions();
