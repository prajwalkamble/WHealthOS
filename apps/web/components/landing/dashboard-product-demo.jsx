"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  Moon,
  PiggyBank,
  Plus,
  Settings,
  Sun,
  Target,
  Wallet,
} from "lucide-react";

import StatCards from "@/app/(main)/dashboard/_components/stat-cards";
import BudgetProgress from "@/app/(main)/dashboard/_components/budget-progress";
import CashFlowChart from "@/app/(main)/dashboard/_components/cash-flow-chart";
import CategoryDonut from "@/app/(main)/dashboard/_components/category-donut";
import IncomeSources from "@/app/(main)/dashboard/_components/income-sources";
import RecentTransactions from "@/app/(main)/dashboard/_components/recent-transactions";
import AccountsPanel from "@/app/(main)/dashboard/_components/accounts-panel";
import { landingDashboard } from "@/lib/demo/landing-data";
import { cn } from "@/lib/utils";
import DemoCursor from "./demo-cursor";
import { useDashboardDemoTimeline } from "./use-dashboard-demo-timeline";

// The landing page's product walkthrough.
//
// Every panel below is the signed-in dashboard's own component, imported from
// app/(main)/dashboard/_components and handed demo data instead of database
// rows. Nothing here is a marketing rebuild of the product: if the real
// dashboard changes, this changes with it, which is the only way a landing
// page stays honest about what the application looks like.
//
// Nothing it does leaves the browser. The rows the walkthrough adds live in
// React state for the length of a loop; there is no provider, no localStorage,
// no server action and no mutation path.

// The application's own navigation, in its own order. Every one of these is a
// built section with a route behind it -- kept in step with NAV_ITEMS in
// components/app-sidebar.jsx, which is what a visitor sees after signing in.
// Showing a section greyed out here after it has shipped undersells the
// product as surely as showing one that does not exist would oversell it.
const NAV = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Transactions", icon: ArrowLeftRight },
  { label: "Accounts", icon: Wallet },
  { label: "Cards", icon: CreditCard },
  { label: "Budgets", icon: PiggyBank },
  { label: "Goals", icon: Target },
  { label: "Analytics", icon: BarChart3 },
  { label: "Settings", icon: Settings },
];

// A focus treatment that costs one custom property, so the timeline can raise
// and lower it on any panel without knowing what the panel contains. Kept
// quiet on purpose: a ring and a touch of lift, never a spotlight that dims
// the rest of the interface.
const panelClass =
  "[--demo-ring:0] relative rounded-xl transition-shadow " +
  "shadow-[0_0_0_calc(var(--demo-ring)*2px)_hsl(var(--primary)/calc(var(--demo-ring)*0.45))]";

const Panel = ({ name, className, children }) => (
  <div data-demo={name} data-demo-panel="" className={cn(panelClass, className)}>
    {children}
  </div>
);


// className overrides the outer figure's sizing, so the same demo can sit full
// width under the landing headline or inside the narrower column on About
// without either page keeping its own copy of it.
const DashboardProductDemo = ({ className }) => {
  const rootRef = useRef(null);
  const cursorRef = useRef(null);

  // The sample rows are dated from new Date(), so the server and the browser
  // can disagree by a tick and React reports a hydration mismatch. The demo
  // page gates on mount for the same reason. The frame keeps its height
  // across the swap, so nothing on the page moves.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The demo deliberately runs in the opposite theme to the site, so a visitor
  // sees the other one without changing their own. The class goes on the demo
  // frame, never on <html>: clicking the toggle in the walkthrough must not
  // re-theme the page someone is reading.
  const { resolvedTheme } = useTheme();
  // Shown in the opposite theme to the site, so a visitor sees the other one
  // without their own page changing. The class goes on the demo frame, never
  // on <html>.
  const demoDark = resolvedTheme !== "dark";

  const { transactions, accounts, dashboard } = useMemo(() => landingDashboard(), []);
  const { summary, cashFlow, breakdown, budget } = dashboard;

  useDashboardDemoTimeline({
    rootRef,
    cursorRef,
    balance: summary.totalBalance,
  });

  return (
    <figure className={cn("mx-auto w-full", className ?? "mt-16 max-w-6xl 2xl:max-w-7xl")}>
      <div
        ref={rootRef}
        // select-none plus pointer-events-none on the contents: the panel is a
        // demonstration, not a document, and it should behave like a video --
        // nothing to drag-select, nothing to right-click into. The timeline
        // still drives it, because element.click() ignores pointer-events.
        //
        // Worth being clear that this is a deterrent, not protection: the text
        // is in the DOM and anyone who opens the inspector can read it. The
        // numbers are sample data, so there is nothing here worth protecting
        // harder than this.
        className={cn(
          "hero-demo-shadow relative min-h-[26rem] select-none overflow-hidden rounded-xl border text-left sm:min-h-[34rem] lg:min-h-[41rem]",
          // text-foreground as well as bg-background: body resolves
          // text-foreground against the SITE's tokens, and plain text inherits
          // that resolved colour rather than re-reading the variable under the
          // demo's scope. Without it the form page rendered near-black text on
          // the demo's dark background.
          "bg-background text-foreground",
          // Only once mounted. resolvedTheme is undefined on the server, so
          // deciding the class during SSR renders "dark" there and possibly
          // "theme-light" on the client, which is a hydration mismatch. The
          // contents are already hidden until mount, so there is nothing to
          // see in the gap.
          mounted && (demoDark ? "dark" : "theme-light")
        )}
        // Not aria-hidden: the figures, transaction names and account names
        // below are real content and stay readable with the animation off.
        role="img"
        aria-label="The WHealthOS dashboard, showing balance, income, expenses, savings rate, cash flow, expense breakdown, recent transactions, the monthly budget and account balances."
      >
        {/* inert as well as pointer-events-none. pointer-events-none puts the
            walkthrough out of a mouse's reach but leaves its controls in the
            tab order, so a keyboard user landed on the Bars/Flow switch, the
            donut's legend and the transaction list's "View All" -- five stops
            inside a demonstration, none of which can be operated and one of
            which leads off the page. inert removes the whole subtree from
            focus and from the accessibility tree; the aria-label on the frame
            above still describes what it shows.

            The timeline is unaffected. It drives the switch with
            element.click(), which dispatches the event directly rather than
            going through user interaction, exactly as it already does past
            pointer-events-none. */}
        <div inert className={cn("flex pointer-events-none", !mounted && "invisible")}>
          {/* Sidebar: the application's real navigation, with the same
              sections a signed-in visitor gets. */}
          <div
            data-demo="sidebar"
            data-demo-panel=""
            className="hidden w-44 shrink-0 border-r bg-card/40 p-3 lg:block"
          >
            {/* Sentence case at 12px, not 10px tracked capitals. The real
                sidebar does not label its own navigation at all; this one
                keeps the word because the rail is only 11rem wide here and a
                bare list of eight items reads as a menu more slowly without
                it. */}
            <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
              Menu
            </p>
            <ul className="space-y-0.5">
              {NAV.map(({ label, icon: Icon, active, muted }) => (
                <li key={label}>
                  <span
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                      active && "bg-accent font-medium text-accent-foreground",
                      muted && "text-muted-foreground/50",
                      !active && !muted && "text-muted-foreground"
                    )}
                  >
                    <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 flex-1">
            <div
              data-demo="topbar"
              data-demo-panel=""
              className="flex items-center justify-between gap-3 border-b px-4 py-3"
            >
              <h3 className="text-base font-bold tracking-tight">Dashboard</h3>
              <div className="flex items-center gap-2">
                <span className="hidden h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-xs tabular-nums text-muted-foreground sm:inline-flex">
                  <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                  This month
                </span>
                {/* The real app header carries a theme toggle; so does this. */}
                <button
                  type="button"
                  data-demo-theme
                  tabIndex={-1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground"
                >
                  {/* Sun until mounted, on both sides. demoDark depends on
                      resolvedTheme, which is undefined during SSR, so picking
                      the icon before mount renders one glyph on the server and
                      possibly the other on the client -- a different <svg>,
                      which fails hydration outright. */}
                  {mounted && demoDark ? (
                    <Moon aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <Sun aria-hidden className="h-3.5 w-3.5" />
                  )}
                </button>
                <span
                  data-demo-add
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" />
                  Add Transaction
                </span>
              </div>
            </div>

            <div className="relative space-y-4 p-4">
              <Panel name="stats">
                <StatCards
                  summary={summary}
                  accountCount={accounts.length}
                  hasTransactions={transactions.length > 0}
                  guest
                />
              </Panel>

              <div className="grid gap-4 lg:grid-cols-3">
                <Panel name="income" className="min-w-0">
                  <IncomeSources
                    rows={breakdown.income}
                    total={summary.monthlyIncome}
                    previousTotal={summary.previous.income}
                  />
                </Panel>
                <Panel name="cashflow" className="min-w-0">
                  <CashFlowChart months={cashFlow} />
                </Panel>
                <Panel name="breakdown" className="min-w-0">
                  <CategoryDonut
                    title="Expense Breakdown"
                    rows={breakdown.expenses}
                    emptyLabel="No expenses this month"
                  />
                </Panel>
              </div>

              {/* The signed-in dashboard's own last row, and now the same
                  one: two equal halves, transactions filling the left, the
                  budget card over the accounts panel on the right. The budget
                  card was the one panel a visitor met only after signing up --
                  the walkthrough showed seven of the dashboard's eight and
                  left out the one that tells you something before you have
                  overspent. app/(main)/dashboard/page.jsx:41-64 is the
                  arrangement this mirrors. */}
              <div className="grid gap-4 xl:grid-cols-2">
                <Panel name="transactions" className="flex min-w-0">
                  <RecentTransactions
                    transactions={transactions}
                    accounts={accounts}
                    limit={6}
                    viewAllHref="/demo/transactions"
                  />
                </Panel>
                <div className="flex min-w-0 flex-col gap-4">
                  {/* shrink-0 for the same reason the real dashboard needs it:
                      the accounts card otherwise claims the column's full
                      height and squeezes the budget bar out of its card. */}
                  <Panel name="budget" className="shrink-0">
                    <BudgetProgress
                      initialBudget={budget.budget}
                      currentExpenses={budget.currentExpenses}
                      hasAccount
                      guest
                    />
                  </Panel>
                  <Panel name="accounts" className="flex min-w-0 flex-1">
                    <AccountsPanel accounts={accounts} guest />
                  </Panel>
                </div>
              </div>

            </div>
          </div>
        </div>

        <DemoCursor ref={cursorRef} />
      </div>
    </figure>
  );
};

export default DashboardProductDemo;
