"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import BudgetProgress from "@/app/(main)/dashboard/_components/budget-progress";
import CategoryDonut from "@/app/(main)/dashboard/_components/category-donut";
import IncomeSources from "@/app/(main)/dashboard/_components/income-sources";
import RecentTransactions from "@/app/(main)/dashboard/_components/recent-transactions";
import { landingDashboard } from "@/lib/demo/landing-data";
import { BODY, EYEBROW, HEADING, LEAD, SHELL } from "./section";
import { cn } from "@/lib/utils";

// Three things the product does, each shown doing it.
//
// Every panel on the right of these rows is the signed-in dashboard's own
// component -- the same files app/(main)/dashboard/page.jsx renders -- handed
// the demo dataset instead of database rows. Nothing here is a marketing
// rebuild or a screenshot of one: change the real budget card and this page
// changes with it, which is the only arrangement under which a landing page
// stays honest about what the application looks like.
//
// It is also why there is no fabricated interface anywhere in this section.
// The alternative -- drawing a picture of a budget card -- would have let the
// picture drift from the product, and a visitor cannot tell the difference
// until they have signed up.
//
// Distinct from the hero's walkthrough on purpose. That one is the whole
// dashboard, animated, demonstrating the product as a single surface. These
// are single panels, still, each next to the one idea it carries. They share
// the dataset so the figures agree, and nothing here is animated at all.
//
// Read-only throughout. `guest` strips the budget card's edit control, the
// transaction list points at the public demo rather than the signed-in
// ledger, and no server action is reachable from this section.

const SOLUTIONS = [
  {
    id: "record",
    eyebrow: "Record",
    title: "Every payment, in one ledger",
    // actions/transaction.js: create, update, bulk delete, scanReceipt.
    body: "Add income, expenses and transfers as they happen, or photograph a receipt and confirm what it read. Each one carries its account and its category, so the month adds up without a spreadsheet.",
    href: "/demo/transactions",
    linkLabel: "Open the ledger",
    panelLabel:
      "The Recent Transactions panel, listing five sample payments with their category, account, date and amount.",
  },
  {
    id: "plan",
    eyebrow: "Plan",
    title: "A budget that tells you in time",
    // lib/inngest/functions.js checkBudgetAlert / sendBudgetAlert.
    body: "Set a monthly limit and WHealthOS measures it against what you have actually spent on your default account. The email arrives as you approach the limit, which is while it can still change anything.",
    panelLabel:
      "The Monthly Budget panel, showing a sample limit, how much of it has been spent and the progress bar between them.",
  },
  {
    id: "understand",
    eyebrow: "Understand",
    title: "Where it came from, where it went",
    // CategoryDonut and IncomeSources, both from the real dashboard.
    body: "Spending grouped by category and income by source, each against the same month last time, so a change shows up as a change rather than as a number you have to remember.",
    panelLabel:
      "The Expense Breakdown and Income Sources panels, showing sample spending grouped by category and sample income grouped by source.",
  },
];

const Row = ({ solution, index, children }) => {
  const flipped = index % 2 === 1;

  return (
    <div
      className={cn(
        "grid items-center gap-8 lg:grid-cols-2 lg:gap-14",
        index > 0 && "mt-16 border-t pt-16 md:mt-24 md:pt-24"
      )}
    >
      <div className={cn("min-w-0", flipped && "lg:order-2")}>
        <p className={EYEBROW}>{solution.eyebrow}</p>
        <h3 className="mt-3 text-balance text-2xl font-semibold tracking-tight md:text-3xl">
          {solution.title}
        </h3>
        <p className={cn("mt-4 max-w-xl", BODY)}>{solution.body}</p>
        {solution.href && (
          <Link
            href={solution.href}
            className="mt-5 inline-flex w-fit items-center gap-1 rounded-sm py-1 text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {solution.linkLabel}
            <ArrowUpRight aria-hidden className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* pointer-events-none: these are the real components, and they are here
          to be read rather than operated. The budget card's editor is already
          gone through `guest`; this stops a reader discovering that the
          donut's legend is live on a page where nothing can be saved.

          role="img" with a label, the same treatment the hero's walkthrough
          gets, and for the same two reasons. Each of these panels is a real
          dashboard component and brings its own <h2> -- "Transactions",
          "Monthly Budget", "Expense Breakdown" -- which inside an <h3> row
          put the page's heading outline out of order. It also stops a screen
          reader walking a table of sample figures it has no reason to read
          row by row. Children of role="img" are presentational, so the
          outline is the page's own again and the label says what the panel
          shows. */}
      <div
        role="img"
        aria-label={solution.panelLabel}
        className={cn("min-w-0 pointer-events-none", flipped && "lg:order-1")}
      >
        {children}
      </div>
    </div>
  );
};

const Solutions = () => {
  // The sample rows are dated relative to new Date(), so the server and the
  // browser can land a tick apart and React reports a hydration mismatch. The
  // hero's walkthrough and the demo page both gate on mount for the same
  // reason. The frame keeps its height across the swap, so nothing moves.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { transactions, accounts, dashboard } = useMemo(() => landingDashboard(), []);
  const { breakdown, summary, budget } = dashboard;

  return (
    <section aria-labelledby="solutions" className="reveal mt-20 md:mt-28">
      <div className={SHELL}>
        <p className={EYEBROW}>In the product</p>
        <h2
          id="solutions"
          className={cn("mt-3 max-w-3xl scroll-mt-28", HEADING)}
        >
          The same screens you get after signing in
        </h2>
        <p className={cn("mt-4 max-w-2xl", LEAD)}>
          Not mockups. Every panel below is the dashboard&rsquo;s own component,
          running on sample figures.
        </p>

        <div className="mt-12">
          {SOLUTIONS.map((solution, index) => (
            <Row key={solution.id} solution={solution} index={index}>
              {/* `invisible` is visibility:hidden, which keeps the panel in
                  the layout, and the tree it renders is the same before and
                  after mount -- so the row has its final height from the first
                  paint and the swap costs no shift. There is deliberately no
                  min-height propping it up: the budget card is short, and a
                  forced 20rem left it floating in a box of dead space.

                  inert, not aria-hidden: the panels carry a "View All" link
                  and a legend of their own, and pointer-events-none takes
                  those out of reach of a mouse while leaving them in the tab
                  order -- so a keyboard user would tab into controls that
                  cannot be operated and lead out of the page. inert removes
                  the whole subtree from focus. It belongs on this inner
                  wrapper rather than on the role="img" element above, which
                  still has to expose its label. React 19 passes inert through
                  to the DOM as the boolean attribute it is. */}
              <div inert className={cn(!mounted && "invisible")}>
                {solution.id === "record" && (
                  <RecentTransactions
                    transactions={transactions}
                    accounts={accounts}
                    limit={5}
                    viewAllHref="/demo/transactions"
                  />
                )}

                {solution.id === "plan" && (
                  <BudgetProgress
                    initialBudget={budget.budget}
                    currentExpenses={budget.currentExpenses}
                    hasAccount
                    guest
                  />
                )}

                {solution.id === "understand" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <CategoryDonut
                      title="Expense Breakdown"
                      rows={breakdown.expenses}
                      emptyLabel="No expenses this month"
                    />
                    <IncomeSources
                      rows={breakdown.income}
                      total={summary.monthlyIncome}
                      previousTotal={summary.previous.income}
                    />
                  </div>
                )}
              </div>
            </Row>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Solutions;
