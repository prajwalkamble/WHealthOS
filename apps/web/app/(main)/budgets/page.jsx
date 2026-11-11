import { getBudgets } from "@/lib/queries";
import { monthName, previousMonth, zonedYearMonth } from "@/lib/time";
import FeatureGate from "@/components/billing/feature-gate";
import BudgetsClient from "./_components/budgets-client";

export const metadata = { title: "Budgets" };

// The period lives in the URL so a view can be linked and reloaded, and so the
// aggregation stays on the server where the rows are. Only the current month
// and the one before it are offered: a Budget row stores one standing limit
// with no history, so going further back would compare old spending against a
// limit that may since have changed, with no way to know.
// Wrapped from 2026-11-10, when enforcement was switched on: getBudgets()
// refuses a plan without budgets, and an error page is the wrong way to say
// so. The fetch stays inside this component, so a denied account never runs
// the query -- see the note in ../goals/page.jsx.
export default function BudgetsPage({ searchParams }) {
  return (
    <FeatureGate feature="budgets" className="mt-6">
      <Budgets searchParams={searchParams} />
    </FeatureGate>
  );
}

async function Budgets({ searchParams }) {
  const params = await searchParams;
  const current = zonedYearMonth();
  const prior = previousMonth(current);

  const showPrevious = params?.period === "previous";
  const target = showPrevious ? prior : current;

  const data = await getBudgets(target);

  return (
    <BudgetsClient
      data={data}
      period={showPrevious ? "previous" : "current"}
      // Labelled from today, not from the period being viewed. Deriving these
      // from the viewed period made the menu re-label itself: viewing
      // September, its "previous" option read August, so the control
      // contradicted the data it had just loaded.
      options={{
        current: monthName(current.year, current.month),
        previous: monthName(prior.year, prior.month),
      }}
    />
  );
}
