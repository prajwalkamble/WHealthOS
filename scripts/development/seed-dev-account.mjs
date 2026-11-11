// Fills the development account with six months of plausible financial
// history, so the screens the development feature override unlocks have
// something in them.
//
// Why this exists: the override grants every entitlement to one designated
// account, and that account was created to test with -- so it has no
// transactions, no accounts, no budgets and no goals. Budgets, Goals,
// Analytics and the AI surfaces then render unlocked and completely empty,
// which looks identical to a feature that does not work. This gives them
// data to render.
//
// Usage, from the repository root:
//
//   node --env-file=apps/web/.env scripts/development/seed-dev-account.mjs
//
// --dry-run prints the plan and writes nothing.
// --replace deletes the development account's own financial rows first.
//   Without it, the script refuses to run on an account that already has
//   data rather than doubling it.
//
// Deterministic: the same seed produces the same figures on every run, so a
// screenshot or a number you noted yesterday still means something today.
//
// WHAT IT WILL NOT TOUCH, and what stops it:
//
//   1. It takes no account argument. The target is DEV_FEATURE_OVERRIDE_USER_ID
//      and nothing else, and it refuses to start unless devOverrideEnabled()
//      agrees -- the same four conditions that gate the override itself,
//      including "not on Vercel".
//   2. It connects through DATABASE_URL, the role that is subject to row-level
//      security, and sets app.tenant_id to that one id. Every isolation policy
//      carries an explicit WITH CHECK, so the database itself rejects an
//      INSERT that names any other user. A bug here cannot reach another
//      account; it can only fail.
//   3. It writes to accounts, transactions, budgets, goals, goal_contributions
//      and cards. It does not go near subscriptions, payments, checkout
//      attempts, billing events or legal consents.

import { randomUUID } from "node:crypto";
import { PrismaClient } from "../../database/generated/client/index.js";
import { balanceEffect } from "../../apps/web/lib/money.js";
import { defaultCategories } from "../../apps/web/data/categories.js";
import {
  configuredEmail,
  configuredUserId,
  devOverrideEnabled,
  devOverrideProblems,
} from "../../apps/web/lib/billing/dev-override.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const replace = args.includes("--replace");

// Asia/Kolkata, because lib/time.js buckets every month boundary in it. A
// transaction written at 06:30 UTC is midday there, which keeps it in the
// month it looks like it is in rather than on the edge of the one before.
const ZONE = process.env.APP_TIME_ZONE || "Asia/Kolkata";
const IST_NOON_UTC_HOUR = 6;

// Six months, matching CASH_FLOW_MONTHS in apps/web/lib/queries.js -- the
// cash-flow chart's window, and therefore the shortest history that fills it.
const MONTHS = 6;

const zonedToday = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
};

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const at = (year, month, day) =>
  new Date(Date.UTC(year, month - 1, day, IST_NOON_UTC_HOUR, 30));

// mulberry32. A seeded generator rather than Math.random so that re-running
// this does not silently change every figure on every screen.
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = mulberry32(0x5748_4c54); // "WHLT"
const rand = {
  int: (min, max) => min + Math.floor(next() * (max - min + 1)),
  money: (min, max) => Math.round((min + next() * (max - min)) * 100) / 100,
  pick: (list) => list[Math.floor(next() * list.length)],
};

// ---------------------------------------------------------------------------
// The dataset
// ---------------------------------------------------------------------------

const ACCOUNTS = [
  {
    key: "current",
    name: "Salary account",
    type: "CURRENT",
    currency: "INR",
    isDefault: true,
    opening: 18500,
  },
  {
    key: "savings",
    name: "Savings account",
    type: "SAVINGS",
    currency: "INR",
    isDefault: false,
    opening: 210000,
  },
  // Deliberately NOT a second currency.
  //
  // A multi-currency ledger is the one state this seed must not manufacture.
  // lib/currency/presentation.js is explicit that a single conversion scalar
  // is only valid while the ledger holds one currency, and that the two-
  // currency case "cannot arise" because no account can be given a currency
  // through the UI -- so presentationFor() detects it and REFUSES, formatting
  // every figure in whichever currency the distinct query happens to return
  // first. Writing a USD account straight into the database reaches that
  // branch: the dashboard would then label an unconverted mixed-currency
  // total of 335,643 as "$335,643". A development account exists to show the
  // features working, not to sit in a state the application says is
  // unreachable.
];

// Same amount, same day, every month. Descriptions are deliberately generic:
// seed data should not read like a claim about a real merchant.
const RECURRING = [
  { day: 1, type: "INCOME", category: "salary", description: "Monthly salary", amount: 112000, account: "current" },
  { day: 3, type: "EXPENSE", category: "housing", description: "Rent", amount: 26500, account: "current" },
  { day: 2, type: "EXPENSE", category: "bills", description: "Broadband", amount: 1199, account: "current" },
  { day: 5, type: "EXPENSE", category: "entertainment", description: "Streaming subscription", amount: 649, account: "current" },
  { day: 6, type: "EXPENSE", category: "insurance", description: "Term insurance premium", amount: 1850, account: "current" },
  { day: 7, type: "EXPENSE", category: "personal", description: "Gym membership", amount: 1500, account: "current" },
  { day: 5, type: "INCOME", category: "investments", description: "Savings interest", amount: null, range: [900, 2600], account: "savings" },
  { day: 4, type: "INCOME", category: "freelance", description: "Retainer client", amount: null, range: [8000, 18000], account: "current" },
  { day: 2, type: "EXPENSE", category: "bills", description: "Cloud hosting", amount: null, range: [1500, 2800], account: "current" },
];

// Day-to-day spending: how many a month, and how big.
const VARIABLE = [
  { category: "groceries", count: [4, 7], amount: [620, 3200], descriptions: ["Weekly groceries", "Supermarket", "Fruit and vegetables", "Household supplies"] },
  { category: "food", count: [5, 9], amount: [180, 1400], descriptions: ["Lunch", "Dinner out", "Coffee", "Food delivery"] },
  { category: "transportation", count: [3, 6], amount: [120, 900], descriptions: ["Cab fare", "Fuel", "Metro top-up", "Parking"] },
  { category: "entertainment", count: [1, 3], amount: [300, 1600], descriptions: ["Cinema", "Live music", "Books"] },
  { category: "shopping", count: [1, 3], amount: [800, 7500], descriptions: ["Clothing", "Electronics accessory", "Home goods"] },
  { category: "healthcare", count: [0, 1], amount: [500, 4200], descriptions: ["Pharmacy", "Doctor's visit", "Dental check-up"] },
  { category: "personal", count: [1, 2], amount: [400, 1800], descriptions: ["Haircut", "Toiletries"] },
  { category: "utilities", count: [1, 2], amount: [2400, 3900], descriptions: ["Electricity", "Water and gas"] },
];

// One-offs, placed in a named month. offset 0 is the current month.
const OCCASIONAL = [
  { offset: 5, day: 18, type: "INCOME", category: "freelance", description: "Freelance invoice", amount: 38000, account: "current" },
  { offset: 4, day: 12, type: "EXPENSE", category: "travel", description: "Flights and hotel", amount: 21400, account: "current" },
  { offset: 4, day: 22, type: "INCOME", category: "investments", description: "Mutual fund dividend", amount: 4200, account: "savings" },
  { offset: 3, day: 9, type: "INCOME", category: "freelance", description: "Freelance invoice", amount: 26500, account: "current" },
  { offset: 3, day: 16, type: "EXPENSE", category: "education", description: "Online course", amount: 6500, account: "current" },
  { offset: 3, day: 20, type: "EXPENSE", category: "shopping", description: "Software licence", amount: 6900, account: "current" },
  { offset: 2, day: 14, type: "EXPENSE", category: "gifts", description: "Festival gifts", amount: 5500, account: "current" },
  { offset: 1, day: 11, type: "INCOME", category: "freelance", description: "Freelance invoice", amount: 41200, account: "current" },
  { offset: 1, day: 21, type: "EXPENSE", category: "travel", description: "Train tickets", amount: 8600, account: "current" },
  { offset: 1, day: 26, type: "INCOME", category: "investments", description: "Mutual fund dividend", amount: 5800, account: "savings" },
  // Two in the current month left PENDING, so the status filter has both
  // states to show and the dashboard is not uniformly COMPLETED.
  { offset: 0, day: 8, type: "EXPENSE", category: "shopping", description: "Replacement phone", amount: 34999, account: "current", status: "PENDING" },
  { offset: 0, day: 9, type: "EXPENSE", category: "healthcare", description: "Annual health check", amount: 3200, account: "current", status: "PENDING" },
];

const BUDGETS = [
  { category: null, amount: 72000 },
  { category: "groceries", amount: 14000 },
  { category: "food", amount: 9000 },
  { category: "transportation", amount: 5000 },
  { category: "entertainment", amount: 4000 },
  { category: "shopping", amount: 12000 },
  { category: "utilities", amount: 5000 },
];

// Goals, with the contributions that make up their progress. There is no
// stored total on a goal -- progress is the sum of these rows -- so the
// percentages below are whatever the arithmetic says.
const GOALS = [
  {
    name: "Emergency fund",
    description: "Six months of expenses, kept liquid.",
    targetAmount: 400000,
    targetDate: { year: 2027, month: 9, day: 30 },
    status: "ACTIVE",
    contributions: { monthly: 18000, months: 6, day: 2 },
  },
  {
    name: "Japan, spring 2027",
    description: "Flights, rail pass and two weeks of it.",
    targetAmount: 220000,
    targetDate: { year: 2027, month: 3, day: 15 },
    status: "ACTIVE",
    contributions: { monthly: 24000, months: 6, day: 15, extra: [{ offset: 2, amount: 12000, note: "Bonus" }] },
  },
  {
    name: "Laptop upgrade",
    description: "Replaced the five-year-old one.",
    targetAmount: 165000,
    targetDate: { year: 2026, month: 10, day: 1 },
    status: "COMPLETED",
    // Five of these sum to exactly targetAmount, and day 8 is early enough to
    // land in the current month too -- a COMPLETED goal sitting at 80% would
    // read as a bug in the progress calculation.
    contributions: { monthly: 33000, months: 5, day: 8 },
  },
  {
    name: "Home deposit",
    description: "The long one.",
    targetAmount: 1500000,
    targetDate: { year: 2029, month: 12, day: 31 },
    status: "ACTIVE",
    contributions: { monthly: 10000, months: 6, day: 25 },
  },
  {
    name: "Motorcycle",
    description: "Shelved -- kept for the history.",
    targetAmount: 90000,
    targetDate: null,
    status: "ARCHIVED",
    contributions: { monthly: 6000, months: 2, day: 8 },
  },
];

const CARDS = [
  { name: "Everyday credit card", issuer: "HDFC Bank", network: "VISA", type: "CREDIT", last4: "4821", expiryMonth: 11, expiryYear: 2029, creditLimit: 300000, currency: "INR", billingDay: 18, dueDay: 5, status: "ACTIVE", account: "current" },
  { name: "Debit card", issuer: "ICICI Bank", network: "RUPAY", type: "DEBIT", last4: "0417", expiryMonth: 3, expiryYear: 2028, creditLimit: null, currency: "INR", billingDay: null, dueDay: null, status: "ACTIVE", account: "savings" },
  { name: "Travel credit card", issuer: "American Express", network: "AMEX", type: "CREDIT", last4: "1006", expiryMonth: 6, expiryYear: 2028, creditLimit: 200000, currency: "INR", billingDay: 24, dueDay: 12, status: "ACTIVE", account: null },
  { name: "Old debit card", issuer: "State Bank of India", network: "MASTERCARD", type: "DEBIT", last4: "9930", expiryMonth: 1, expiryYear: 2026, creditLimit: null, currency: "INR", billingDay: null, dueDay: null, status: "ARCHIVED", account: null },
];

// ---------------------------------------------------------------------------
// Building the rows
// ---------------------------------------------------------------------------

const CATEGORY = new Map(defaultCategories.map((c) => [c.id, c]));

// A category that is not in data/categories.js renders as an unknown chip with
// no colour and no icon. Catch it here rather than on the screen.
function assertCategory(id, type, where) {
  const category = CATEGORY.get(id);
  if (!category) throw new Error(`${where}: "${id}" is not a category in data/categories.js`);
  if (category.type !== type) {
    throw new Error(`${where}: "${id}" is a ${category.type} category, used as ${type}`);
  }
}

function build(accounts, userId, today) {
  const transactions = [];
  const accountOf = (key) => accounts.find((a) => a.key === key);

  const push = ({ year, month, day, type, category, description, amount, accountKey, status = "COMPLETED" }) => {
    assertCategory(category, type, `${year}-${String(month).padStart(2, "0")} ${description}`);
    const account = accountOf(accountKey);
    const date = at(year, month, day);
    transactions.push({
      id: randomUUID(),
      type,
      amount,
      currency: account.currency,
      description,
      date,
      category,
      isRecurring: false,
      recurringInterval: null,
      nextRecurringDate: null,
      lastProcessed: null,
      status,
      userId,
      accountId: account.id,
      createdAt: date,
      updatedAt: date,
      // Not a column. Used below to mark the latest instance of a series.
      _series: null,
    });
    return transactions[transactions.length - 1];
  };

  for (let offset = MONTHS - 1; offset >= 0; offset -= 1) {
    const anchor = new Date(Date.UTC(today.year, today.month - 1 - offset, 1));
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth() + 1;
    // The current month stops today; nothing is dated in the future.
    const lastDay = offset === 0 ? today.day : daysInMonth(year, month);

    for (const item of RECURRING) {
      if (item.day > lastDay) continue;
      const row = push({
        year,
        month,
        day: item.day,
        type: item.type,
        category: item.category,
        description: item.description,
        amount: item.amount ?? rand.money(item.range[0], item.range[1]),
        accountKey: item.account,
      });
      row._series = `${item.account}:${item.category}:${item.description}`;
    }

    // The current month is only part over, so it gets a proportionate share
    // of the month's day-to-day spending. Generating a full month of it into
    // ten elapsed days leaves every budget wildly overspent and the pacing
    // figures meaningless -- the screen reads as broken rather than as full.
    const share = offset === 0 ? lastDay / daysInMonth(year, month) : 1;

    for (const group of VARIABLE) {
      const full = rand.int(group.count[0], group.count[1]);
      const count = share === 1 ? full : Math.max(group.count[0] > 0 ? 1 : 0, Math.round(full * share));
      for (let i = 0; i < count; i += 1) {
        const day = rand.int(1, lastDay);
        push({
          year,
          month,
          day,
          type: "EXPENSE",
          category: group.category,
          description: rand.pick(group.descriptions),
          amount: rand.money(group.amount[0], group.amount[1]),
          accountKey: "current",
        });
      }
    }

    for (const item of OCCASIONAL) {
      if (item.offset !== offset || item.day > lastDay) continue;
      push({
        year,
        month,
        day: item.day,
        type: item.type,
        category: item.category,
        description: item.description,
        amount: item.amount,
        accountKey: item.account,
        status: item.status ?? "COMPLETED",
      });
    }
  }

  // Mark the latest instance of each fixed series as the recurring one.
  //
  // Only the latest, and always with nextRecurringDate in the future. The
  // `process-recurring-transactions` Inngest job selects isRecurring rows
  // whose nextRecurringDate has passed -- or whose nextRecurringDate and
  // lastProcessed are both null -- and writes a fresh transaction for each.
  // Flagging every historical copy, or leaving the date null, would have that
  // job quietly manufacture duplicates the first time it ran.
  const latest = new Map();
  for (const row of transactions) {
    if (!row._series) continue;
    const held = latest.get(row._series);
    if (!held || row.date > held.date) latest.set(row._series, row);
  }
  for (const row of latest.values()) {
    const nextMonth = new Date(row.date);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    row.isRecurring = true;
    row.recurringInterval = "MONTHLY";
    row.nextRecurringDate = nextMonth;
    row.lastProcessed = row.date;
  }
  for (const row of transactions) delete row._series;

  // Balances, by the application's own rule rather than a second copy of it.
  const balances = new Map(accounts.map((a) => [a.id, a.opening]));
  for (const row of transactions) {
    balances.set(row.accountId, balances.get(row.accountId) + balanceEffect(row.type, row.amount));
  }

  return {
    transactions: transactions.sort((a, b) => a.date - b.date),
    balances: new Map([...balances].map(([id, value]) => [id, Math.round(value * 100) / 100])),
  };
}

function buildGoals(userId, today) {
  const goals = [];
  const contributions = [];

  for (const spec of GOALS) {
    const id = randomUUID();
    const created = at(today.year, today.month - MONTHS + 1, 1);
    goals.push({
      id,
      name: spec.name,
      description: spec.description,
      targetAmount: spec.targetAmount,
      currency: "INR",
      targetDate: spec.targetDate ? at(spec.targetDate.year, spec.targetDate.month, spec.targetDate.day) : null,
      status: spec.status,
      userId,
      createdAt: created,
      updatedAt: created,
    });

    const { monthly, months, day, extra = [] } = spec.contributions;
    for (let offset = months - 1; offset >= 0; offset -= 1) {
      const anchor = new Date(Date.UTC(today.year, today.month - 1 - offset, 1));
      const year = anchor.getUTCFullYear();
      const month = anchor.getUTCMonth() + 1;
      if (offset === 0 && day > today.day) continue;
      const date = at(year, month, day);
      contributions.push({
        id: randomUUID(),
        amount: monthly,
        date,
        note: "Monthly transfer",
        goalId: id,
        userId,
        createdAt: date,
      });
    }
    for (const one of extra) {
      const anchor = new Date(Date.UTC(today.year, today.month - 1 - one.offset, 1));
      const date = at(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, day);
      contributions.push({
        id: randomUUID(),
        amount: one.amount,
        date,
        note: one.note,
        goalId: id,
        userId,
        createdAt: date,
      });
    }
  }

  return { goals, contributions };
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

const money = (value, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

async function main() {
  if (!devOverrideEnabled()) {
    console.error("Refusing to run: the development feature override is not enabled.\n");
    for (const problem of devOverrideProblems()) {
      console.error(`  ${problem.code}`);
      console.error(`    ${problem.detail}`);
    }
    console.error(
      "\nThis script seeds the account named by DEV_FEATURE_OVERRIDE_USER_ID and\n" +
        "takes no account argument, so it will not run while that configuration is\n" +
        "incomplete -- or on Vercel, where the override is never active.\n" +
        "Pass --env-file=apps/web/.env if you have not."
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Pass --env-file=apps/web/.env.");
    process.exit(1);
  }

  const userId = configuredUserId();
  const email = configuredEmail();
  const today = zonedToday();

  const db = new PrismaClient({ datasourceUrl: url });

  try {
    await db.$transaction(
      async (tx) => {
        // Everything below runs as this tenant. The isolation policies carry
        // WITH CHECK, so the database rejects a row belonging to anyone else.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${userId}, true)`;

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, displayCurrency: true },
        });

        if (!user) {
          throw new Error(
            `No user with id ${userId}. DEV_FEATURE_OVERRIDE_USER_ID does not name a row in this database.`
          );
        }
        // The id is the authorisation; this is the second opinion, and it is
        // the one that catches an id copied from the wrong environment.
        if ((user.email ?? "").toLowerCase() !== email) {
          throw new Error(
            "DEV_FEATURE_OVERRIDE_USER_ID and DEV_FEATURE_OVERRIDE_EMAIL name different accounts. " +
              "Refusing to write to an account that does not match both."
          );
        }

        const existing = {
          accounts: await tx.account.count(),
          transactions: await tx.transaction.count(),
          budgets: await tx.budget.count(),
          goals: await tx.goal.count(),
          contributions: await tx.goalContribution.count(),
          cards: await tx.card.count(),
        };
        const populated = Object.values(existing).some((n) => n > 0);

        console.log(`Development account ${user.id}`);
        console.log(`  ${user.email}`);
        console.log(
          `  holds: ${Object.entries(existing).map(([k, v]) => `${v} ${k}`).join(", ")}`
        );

        if (populated && !replace) {
          throw new Error(
            "This account already has data. Re-run with --replace to delete its accounts,\n" +
              "transactions, budgets, goals, contributions and cards and seed them again.\n" +
              "Nothing outside those six tables is touched either way."
          );
        }

        const accounts = ACCOUNTS.map((a) => ({ ...a, id: randomUUID() }));
        const { transactions, balances } = build(accounts, userId, today);
        const { goals, contributions } = buildGoals(userId, today);

        const budgets = BUDGETS.map((b) => {
          if (b.category !== null) assertCategory(b.category, "EXPENSE", `budget ${b.category}`);
          return {
            id: randomUUID(),
            amount: b.amount,
            currency: "INR",
            category: b.category,
            userId,
            createdAt: at(today.year, today.month - MONTHS + 1, 1),
            updatedAt: at(today.year, today.month - MONTHS + 1, 1),
          };
        });

        const cards = CARDS.map((c) => ({
          id: randomUUID(),
          name: c.name,
          issuer: c.issuer,
          network: c.network,
          type: c.type,
          last4: c.last4,
          expiryMonth: c.expiryMonth,
          expiryYear: c.expiryYear,
          creditLimit: c.creditLimit,
          currency: c.currency,
          billingDay: c.billingDay,
          dueDay: c.dueDay,
          status: c.status,
          userId,
          accountId: c.account ? accounts.find((a) => a.key === c.account).id : null,
        }));

        console.log("\nPlanned:");
        for (const account of accounts) {
          const mine = transactions.filter((t) => t.accountId === account.id);
          console.log(
            `  ${account.name.padEnd(18)} ${account.type.padEnd(8)} ${account.currency}  ` +
              `${String(mine.length).padStart(3)} transactions, ` +
              `opening ${money(account.opening, account.currency)} -> ` +
              `closing ${money(balances.get(account.id), account.currency)}`
          );
        }
        const income = transactions.filter((t) => t.type === "INCOME").length;
        console.log(
          `  ${transactions.length} transactions over ${MONTHS} months (${income} income, ${transactions.length - income} expense)`
        );
        console.log(`  ${budgets.length} budgets (1 overall, ${budgets.length - 1} per category)`);
        console.log(`  ${goals.length} goals, ${contributions.length} contributions`);
        console.log(`  ${cards.length} cards`);

        if (dryRun) {
          console.log("\n--dry-run: nothing written.");
          // Roll the transaction back rather than commit an empty one.
          throw new DryRun();
        }

        if (populated) {
          // Tenant-scoped deletes. RLS limits them to this account's rows even
          // if the where clause were wrong, which it is not.
          await tx.goalContribution.deleteMany({ where: { userId } });
          await tx.goal.deleteMany({ where: { userId } });
          await tx.budget.deleteMany({ where: { userId } });
          await tx.card.deleteMany({ where: { userId } });
          await tx.transaction.deleteMany({ where: { userId } });
          await tx.account.deleteMany({ where: { userId } });
          console.log("\nCleared the previous seed.");
        }

        await tx.account.createMany({
          data: accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            balance: balances.get(a.id),
            currency: a.currency,
            isDefault: a.isDefault,
            userId,
          })),
        });
        await tx.transaction.createMany({ data: transactions });
        await tx.budget.createMany({ data: budgets });
        await tx.goal.createMany({ data: goals });
        await tx.goalContribution.createMany({ data: contributions });
        await tx.card.createMany({ data: cards });

        // A display preference, not a statement about any account: it decides
        // which currency the figures are read in, and rewrites nothing. Set so
        // the seeded INR figures read as INR rather than as whatever country
        // the request appears to come from.
        if (user.displayCurrency !== "INR") {
          await tx.user.update({ where: { id: userId }, data: { displayCurrency: "INR" } });
          console.log("\nSet displayCurrency to INR (a display preference; no amount changed).");
        }

        console.log("\nWritten.");
      },
      { maxWait: 15000, timeout: 120000 }
    );
  } catch (error) {
    if (error instanceof DryRun) return;
    throw error;
  } finally {
    await db.$disconnect();
  }
}

class DryRun extends Error {}

main().catch((error) => {
  const detail = error?.message?.trim() || error?.code || error?.name || String(error) || "no detail";
  console.error(`\nFailed: ${detail}`);
  if (/P1001|ECONNREFUSED|Can't reach/i.test(detail)) {
    console.error("The database is not reachable. If you have just started it, wait and retry.");
  }
  process.exit(1);
});
