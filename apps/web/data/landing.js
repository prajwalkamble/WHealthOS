import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  LayoutDashboard,
  PiggyBank,
  Target,
} from "lucide-react";

// The landing page's content.
//
// Icons are exported as components rather than as rendered elements. The data
// file used to hold JSX, which meant every consumer inherited its imports and
// a copy change could not be made without touching markup.
//
// EVERY LINE BELOW WAS CHECKED AGAINST THE APPLICATION. The notes say where, so
// the next person can re-check a claim instead of trusting this file. Two
// statements that were here before are gone because they were not true:
//
//   "Automatically categorize and track your transactions in real-time"
//       Nothing categorises automatically. A category is chosen when the
//       transaction is recorded (actions/transaction.js), or read off a
//       photographed receipt for the person to confirm. "Real-time" described
//       nothing at all.
//
//   "Receive AI-powered insights and recommendations to optimize your finances"
//       The monthly email is real (lib/inngest/functions.js sendMonthlyReport)
//       and it does carry written commentary -- but "optimize your finances"
//       promises an outcome, and the broader intelligence layer is Planned on
//       the About page. The step now says what the email actually contains.
//
// Multi-currency is absent from this file on purpose. The pricing table lists
// it as a Pro feature and the About page labels it Planned; there is no
// implementation, so the landing page does not describe it as something the
// product does. See the PLANNED note that Capabilities renders.

export const CAPABILITIES = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    benefit: "The whole month, on one screen.",
    // app/(main)/dashboard/_components: stat-cards, cash-flow-chart,
    // category-donut, income-sources, recent-transactions, accounts-panel.
    body: "Balances across every account, income and spending for the month, your savings rate, and six months of cash flow — with the spending breakdown and the latest transactions beside them.",
    href: "/demo",
    linkLabel: "Open the live demo",
    wide: true,
  },
  {
    icon: ArrowLeftRight,
    title: "Transactions",
    benefit: "Know where the money went.",
    // actions/transaction.js: create, update, bulk delete, scanReceipt.
    // lib/recurring.js posts scheduled commitments.
    body: "Record income, expenses and transfers, edit them, or clear several at once. Photograph a receipt and it is read into a draft for you to confirm. Recurring commitments post on their own schedule.",
    href: "/demo/transactions",
    linkLabel: "See the ledger",
  },
  {
    icon: CreditCard,
    title: "Accounts and cards",
    benefit: "Current and savings, side by side.",
    // Balances are derived from transactions (lib/demo/compute.js mirrors the
    // real aggregation). The Card model has no column for a card number, a CVV
    // or a PIN -- see lib/legal/security.js noCardNumbersOrBankCredentials.
    body: "Balances stay in step with every transaction you record. Cards sit alongside the accounts they draw on as reference — issuer, network, last four digits, limit and billing dates. There is no field for a full card number, a CVV or a PIN.",
  },
  {
    icon: PiggyBank,
    title: "Budgets",
    benefit: "A limit you hear about before you pass it.",
    // lib/inngest/functions.js checkBudgetAlert / sendBudgetAlert.
    body: "Set a monthly limit and WHealthOS tracks it against what you have actually spent, then emails you as you approach it rather than once it is gone.",
  },
  {
    icon: Target,
    title: "Goals",
    benefit: "Progress you can trust.",
    // Progress is computed from contribution rows, not a stored running total.
    body: "Set a target and record what you put towards it. Progress is derived from those contributions, so it cannot drift away from the money that is actually there.",
  },
  {
    icon: BarChart3,
    title: "Analytics and your data",
    benefit: "Yours to read, yours to take.",
    // lib/export/{csv,xlsx,pdf}.js and lib/import/{parse-csv,xlsx}.js.
    // The monthly email is sendMonthlyReport; its commentary is opt-out
    // through the monthlyInsights flag in Settings.
    body: "Spending by category, income by source and month against month. A monthly email summarises what changed, with written commentary you can switch off. Export everything as CSV, XLSX or PDF, and import from CSV or XLSX.",
    // Spans the full row rather than two of three columns: six cells across a
    // three-column grid leaves the last row half empty otherwise, and an empty
    // cell reads as something that failed to load.
    full: true,
  },
];

// How someone actually gets from nothing to a month they can read. Three steps
// because there are three: the dashboard animation in the hero already shows
// what the end of this looks like, so this says how to reach it and stops.
export const WORKFLOW = [
  {
    title: "Add your accounts",
    body: "Current and savings, with the balance each one starts at. Cards go in beside them if you want to track limits and billing dates.",
  },
  {
    title: "Record what moves",
    body: "Add income and expenses as they happen, or photograph a receipt and confirm what it read. Anything that repeats every month is set up once and posts itself.",
  },
  {
    title: "Read the month",
    body: "Cash flow, spending by category, income by source and your savings rate — against the budget you set. A summary arrives by email at the start of the next month.",
  },
];

// Questions the rest of the page does not already answer better.
//
// Deliberately NOT the pricing FAQ. data/pricing.js FAQS covers plans, caps,
// upgrades and cancellation, it is rendered in full on /pricing, and repeating
// any of it here would be the same answer in two places.
//
// Every answer below is checked:
//   demo           app/demo and app/demo/transactions exist, are excluded from
//                  isProtectedRoute, and keep a guest's rows in localStorage.
//   currency       lib/format.js formats in INR with the en-IN locale
//                  throughout; there is no currency setting.
//   not built yet  About's Capabilities marks multi-currency and the
//                  intelligence layer Planned; ADR-004 holds the reasoning.
//   data handling  lib/legal/security.js, and /security is the page.
//   advice         the same position the AI Usage and pricing pages take.
export const LANDING_FAQS = [
  {
    question: "What is WHealthOS?",
    answer:
      "A place to keep your own financial records: accounts, the transactions that move through them, a monthly budget, and goals you are saving towards — with the analysis of all of it on one dashboard.",
  },
  {
    question: "Can I try it without signing up?",
    answer:
      "Yes. The demo is the real application running on sample data, and anything you add there stays in your own browser. No account, no email address, nothing to cancel.",
  },
  {
    question: "Which currency does it use?",
    answer:
      "Indian rupees. Amounts are formatted for an Indian audience throughout, and holding balances in more than one currency is not built yet.",
  },
  {
    question: "What is not built yet?",
    answer:
      "Multi-currency, and the financial intelligence layer in full. The About page lists what works today and marks everything else Planned rather than describing it as though it shipped.",
  },
  {
    question: "How is my financial data handled?",
    answer:
      "Your sign-in credentials are held by Clerk and never reach WHealthOS. Every read and write is scoped to your own user on the server. The Security page sets out what has been verified — and, just as importantly, what has not.",
  },
  {
    question: "Does WHealthOS give financial advice?",
    answer:
      "No. It describes your own money and points at things worth looking at. That is not regulated financial advice, and anything significant is worth putting to a qualified adviser.",
  },
];
