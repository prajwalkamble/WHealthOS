import { getGoals } from "@/lib/queries";
import FeatureGate from "@/components/billing/feature-gate";
import GoalsClient from "./_components/goals-client";

export const metadata = { title: "Goals" };

// Wrapped from 2026-11-10, when enforcement was switched on.
//
// getGoals() refuses an account whose plan does not include goals, and a
// server component that lets that throw gives the person an error page for
// something that is not an error. FeatureGate renders the padlock card and the
// route to the plans instead -- and, because the fetch lives in the child, a
// denied account never runs the query at all.
//
// The gate here is presentation. The authority is in lib/queries.js, next to
// the rows, where a direct call cannot route around it.
const Goals = async () => <GoalsClient goals={await getGoals()} />;

export default function GoalsPage() {
  return (
    <FeatureGate feature="goals" className="mt-6">
      <Goals />
    </FeatureGate>
  );
}
