import { getAnalytics } from "@/lib/queries";
import FeatureGate from "@/components/billing/feature-gate";
import AnalyticsWorkspace from "./_components/analytics-workspace";

export const metadata = { title: "Analytics" };

// Filters live in the URL, so a particular view can be linked, reloaded and
// shared, and so the aggregation stays on the server where the rows already
// are. Changing a control is a navigation, not a client-side refetch.
// Wrapped from 2026-11-10. getAnalytics() has refused unentitled accounts
// since the gates were written, but nothing caught the refusal, so the day
// enforcement went on was the day /analytics started returning an error page
// to every free account. Same treatment as budgets and goals.
export default function AnalyticsPage({ searchParams }) {
  return (
    <FeatureGate feature="analytics" className="mt-6">
      <Analytics searchParams={searchParams} />
    </FeatureGate>
  );
}

async function Analytics({ searchParams }) {
  const params = await searchParams;

  const data = await getAnalytics({
    months: params?.months,
    accountId: params?.account || null,
    type: params?.type || null,
    cashflow: params?.cash || null,
  });

  return (
    <AnalyticsWorkspace
      data={data}
      filters={{
        months: String(data.span),
        account: params?.account ?? "",
        type: params?.type ?? "",
        cash: data.cashflow.range,
      }}
    />
  );
}
