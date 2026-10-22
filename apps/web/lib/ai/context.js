// Turning the caller's own records into the smallest block of text that can
// answer their question.
//
// Two jobs, and the order matters:
//
//   1. Do every piece of arithmetic here. Net, savings rate, month-on-month
//      change, shares, averages, the biggest mover, how much is left over --
//      all computed in this file from Decimal-free numbers that came out of
//      the database, and handed to the model as finished figures. The model
//      is asked to explain them, never to work them out. A language model
//      doing mental arithmetic on someone's salary is the single worst
//      failure this feature could have.
//
//   2. Send as little as possible. No name, no email address, no account
//      identifier, no transaction description, no merchant, no row-level
//      detail of any kind. Aggregates, the account labels the person chose
//      themselves, and category names.
//
// The caveats at the bottom are not decoration. They are the difference
// between an assistant that reports the ledger and one that quietly implies
// the ledger means more than it does.

import { defaultCategories } from "@/data/categories";
import { change } from "@/lib/analytics";
import { SECTIONS } from "@/lib/ai/intent";

const CATEGORY_NAMES = new Map(defaultCategories.map((c) => [c.id, c.name]));

// A category that was renamed, or arrived through an import with its own
// spelling, is reported under its raw id rather than silently relabelled.
const nameOf = (id) => CATEGORY_NAMES.get(id) ?? id;

// Money, for a model rather than for a screen.
//
// Deliberately not lib/format.js's formatCurrency: that produces
// "₹1,23,456.00", and the trailing zeros are tokens carrying no
// information. Whole rupees unless the paise are non-zero, which is how the
// figures are actually entered.
//
// The Indian grouping is kept, though, and that is worth the handful of extra
// tokens. The assistant is asked to write amounts the way the rest of the app
// does, and it copies the shape it is given: handed "₹21250" it wrote
// "₹21250" back, which is both wrong for this audience and genuinely harder
// to read at a glance than ₹21,250.
const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const money = (value) => {
  const n = Number(value) || 0;
  return `₹${grouped.format(Math.round(n * 100) / 100)}`;
};

const percent = (value) =>
  value == null || !Number.isFinite(value) ? null : `${value.toFixed(1)}%`;

// A change, stated as a direction and a size, or as the fact that it cannot
// be stated. null from change() means there was no baseline, and "up 0%" or
// "up ∞%" would both be inventions.
const movement = (after, before) => {
  const pct = change(after, before);
  const delta = after - before;
  if (pct == null) {
    return before === 0 && after > 0
      ? `${money(after)} against nothing last period (no baseline, so no percentage)`
      : "no comparable figure for last period";
  }
  const direction = delta >= 0 ? "up" : "down";
  return `${direction} ${percent(Math.abs(pct))} (${delta >= 0 ? "+" : "−"}${money(
    Math.abs(delta)
  )})`;
};

const line = (label, value) => `- ${label}: ${value}`;

// --- the sections -----------------------------------------------------------

function totalsBlock({ summary, period }) {
  const { income, expenses } = { income: summary.monthlyIncome, expenses: summary.monthlyExpenses };
  const out = [
    `## This period (${period.label} ${period.year}, calendar of ${period.timeZone})`,
    line("Recorded income", money(income)),
    line("Recorded expenses", money(expenses)),
    line("Net (income minus expenses)", money(income - expenses)),
  ];

  out.push(
    line(
      "Savings rate",
      summary.savingsRate == null
        ? "not meaningful — no income recorded this period"
        : percent(summary.savingsRate)
    )
  );
  out.push(line("Total across all accounts, now", money(summary.totalBalance)));

  out.push(
    "",
    `## Against ${period.previousLabel}`,
    line("Income", movement(income, summary.previous.income)),
    line("Expenses", movement(expenses, summary.previous.expenses)),
    line(
      "Net",
      movement(income - expenses, summary.previous.income - summary.previous.expenses)
    )
  );

  if (summary.previous.income === 0 && summary.previous.expenses === 0) {
    out.push(
      line(
        "Note",
        `nothing is recorded for ${period.previousLabel}, so no comparison is possible`
      )
    );
  }

  return out.join("\n");
}

function accountsBlock(accounts) {
  if (!accounts?.length) return "## Accounts\n- None recorded.";

  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  return [
    "## Accounts (balances maintained by the ledger, not summed from transactions)",
    ...accounts.map((a) =>
      line(
        `${a.name} (${a.type.toLowerCase()}${a.isDefault ? ", default" : ""})`,
        money(a.balance)
      )
    ),
    line("Total", money(total)),
  ].join("\n");
}

// Top spending categories, with what each did against last period.
//
// Capped: a long tail of small categories is tokens spent to say nothing, and
// the cap is stated so the assistant knows the list is not exhaustive.
const CATEGORY_LIMIT = 8;

function categoriesBlock(categories, period) {
  const spending = categories.filter((c) => c.amount > 0 || c.previousAmount > 0);
  if (!spending.length) {
    return `## Spending by category\n- Nothing recorded for ${period.label} or ${period.previousLabel}.`;
  }

  const shown = spending.slice(0, CATEGORY_LIMIT);
  const out = [
    `## Spending by category (${period.label}, with change against ${period.previousLabel})`,
    ...shown.map((c) =>
      line(
        nameOf(c.category),
        `${money(c.amount)} — ${percent(c.share)} of this period's spending, ${movement(
          c.amount,
          c.previousAmount
        )}, ${c.count} ${c.count === 1 ? "transaction" : "transactions"}`
      )
    ),
  ];

  if (spending.length > shown.length) {
    const rest = spending.slice(CATEGORY_LIMIT);
    out.push(
      line(
        `Other ${rest.length} categories combined`,
        money(rest.reduce((sum, c) => sum + c.amount, 0))
      )
    );
  }

  // The biggest mover, computed here so the assistant never has to rank by
  // eye. Increases only: "which went up most" is the question people ask.
  const risen = [...spending]
    .filter((c) => c.changeAmount > 0)
    .sort((a, b) => b.changeAmount - a.changeAmount);
  if (risen.length) {
    out.push(
      "",
      line(
        "Largest increase in rupees",
        `${nameOf(risen[0].category)}, +${money(risen[0].changeAmount)}`
      )
    );
  }
  const fallen = [...spending]
    .filter((c) => c.changeAmount < 0)
    .sort((a, b) => a.changeAmount - b.changeAmount);
  if (fallen.length) {
    out.push(
      line(
        "Largest decrease in rupees",
        `${nameOf(fallen[0].category)}, −${money(Math.abs(fallen[0].changeAmount))}`
      )
    );
  }

  return out.join("\n");
}

function trendsBlock(trends) {
  const active = trends.filter((m) => m.income > 0 || m.expense > 0);
  if (!active.length) {
    return "## Month by month\n- No activity recorded in the last 6 months.";
  }

  const out = [
    "## Month by month (last 6 calendar months)",
    ...trends.map((m) =>
      line(
        m.month,
        `in ${money(m.income)}, out ${money(m.expense)}, net ${money(
          m.income - m.expense
        )}`
      )
    ),
  ];

  // Averages over the months that have data, not over six. A month with
  // nothing recorded is an absence of data, not a month of zero income, and
  // dividing by it understates everything.
  const avgIncome = active.reduce((s, m) => s + m.income, 0) / active.length;
  const avgExpense = active.reduce((s, m) => s + m.expense, 0) / active.length;
  out.push(
    "",
    line(
      `Average per month, over the ${active.length} ${
        active.length === 1 ? "month" : "months"
      } with any activity`,
      `in ${money(avgIncome)}, out ${money(avgExpense)}, net ${money(
        avgIncome - avgExpense
      )}`
    ),
    line(
      "Typical monthly surplus",
      avgIncome - avgExpense >= 0
        ? `${money(avgIncome - avgExpense)} left over on average`
        : `${money(
            Math.abs(avgIncome - avgExpense)
          )} more going out than coming in, on average`
    )
  );

  if (active.length < 3) {
    out.push(
      line(
        "Caution",
        `only ${active.length} ${
          active.length === 1 ? "month has" : "months have"
        } any recorded activity, which is too little to call a pattern`
      )
    );
  }

  return out.join("\n");
}

function budgetsBlock(data) {
  if (!data?.budgets?.length) {
    return "## Budgets\n- None set. There is no limit recorded to measure spending against.";
  }

  const out = [
    `## Budgets (${data.period.label}; ${percent(
      data.progress.percentElapsed
    )} of the month elapsed)`,
  ];

  for (const row of data.budgets) {
    const label = row.category === null ? "Overall monthly budget" : nameOf(row.category);
    const state =
      row.remaining < 0
        ? `over by ${money(Math.abs(row.remaining))}`
        : `${money(row.remaining)} left`;
    out.push(
      line(
        label,
        `limit ${money(row.amount)}, spent ${money(row.spent)} (${percent(
          row.percentUsed
        )}), ${state}`
      )
    );
  }

  out.push(
    "",
    line(
      "Important",
      "a budget is one standing limit with no history — it has always been whatever it is now, so comparing it to a past month compares today's limit with that month's real spending"
    )
  );

  return out.join("\n");
}

function goalsBlock(goals) {
  const active = goals.filter((g) => g.status === "ACTIVE");
  if (!goals.length) return "## Goals\n- None recorded.";
  if (!active.length) {
    return `## Goals\n- ${goals.length} recorded, none active.`;
  }

  return [
    "## Savings goals",
    ...active.map((g) =>
      line(
        g.name,
        `target ${money(g.targetAmount)}, put aside ${money(g.saved)} (${percent(
          g.percentComplete
        )}), ${money(g.remaining)} to go${
          g.targetDate ? `, target date ${g.targetDate.slice(0, 10)}` : ", no target date"
        }`
      )
    ),
  ].join("\n");
}

// --- what the ledger cannot tell anyone -------------------------------------
//
// Every one of these is a property of this schema, verified by reading it,
// and each one is a way an answer could be confidently wrong. They travel
// with the figures so the assistant can qualify a number instead of being
// corrected by the person who knows their own money better than it does.
export function caveatsFor(sections) {
  const caveats = [
    // Transaction has a `type` of INCOME or EXPENSE and nothing else. There is
    // no transfer type and no counterparty column, so money moved between the
    // person's own accounts is recorded as an expense on one and an income on
    // the other, and lands in both totals.
    "The ledger has no concept of a transfer. Money moved between the person's own accounts is recorded as an expense and an income, so it inflates both totals. Nothing here can identify or exclude it.",
    // No currency column on Transaction or Account.
    "Every amount is in Indian rupees. The records have no currency field, so there is no conversion anywhere and no way to hold a foreign-currency amount.",
    // Every existing query -- the dashboard, the budgets, the analytics page --
    // filters by date and type and never by status, so these figures include
    // PENDING and FAILED rows. Matching that is deliberate: an assistant that
    // quietly used a different rule would disagree with the screen behind it.
    "Totals include transactions of every status, pending and failed ones as well as completed. That is how every figure in the rest of WHealthOS is calculated, so these agree with the app's own screens.",
    "These figures are only as complete as what has been entered. Anything not recorded is invisible here, and an unusually low total usually means something was not entered rather than not spent.",
  ];

  if (sections.includes(SECTIONS.ACCOUNTS)) {
    caveats.push(
      "Account balances are the figures the ledger maintains as transactions are added, starting from the opening balance that was typed in when the account was created. They are not fetched from any bank."
    );
  }

  return caveats;
}

// The whole context block, or null when the question needed none.
//
// `data` is exactly what lib/queries.js -> getAgentFinancialContext returned.
export function buildFinancialContext(data) {
  if (!data || !data.sections?.length || !data.period) return null;

  const blocks = [];

  if (data.transactionCount === 0) {
    blocks.push(
      "## Records\n- This account has no transactions recorded at all. Every figure below is therefore zero or empty, and that is an absence of data rather than a financial fact."
    );
  }

  if (data.sections.includes(SECTIONS.TOTALS) && data.summary) {
    blocks.push(totalsBlock({ summary: data.summary, period: data.period }));
  }
  if (data.sections.includes(SECTIONS.ACCOUNTS)) {
    blocks.push(accountsBlock(data.accounts));
  }
  if (data.sections.includes(SECTIONS.CATEGORIES) && data.categories) {
    blocks.push(categoriesBlock(data.categories, data.period));
  }
  if (data.sections.includes(SECTIONS.TRENDS) && data.trends) {
    blocks.push(trendsBlock(data.trends));
  }
  if (data.sections.includes(SECTIONS.BUDGETS)) {
    blocks.push(budgetsBlock(data.budgets));
  }
  if (data.sections.includes(SECTIONS.GOALS) && data.goals) {
    blocks.push(goalsBlock(data.goals));
  }

  blocks.push(
    [
      "## What these records cannot tell you",
      ...caveatsFor(data.sections).map((c) => `- ${c}`),
    ].join("\n")
  );

  return [
    "The figures below were read from this person's own records just now and",
    "are already calculated. Use them exactly as given; do not recompute, round",
    "differently, or add figures together to make a new one.",
    "",
    ...blocks,
  ].join("\n");
}

// Exported for the tests, which assert on the arithmetic rather than on prose.
export const _internals = { money, movement, nameOf };
