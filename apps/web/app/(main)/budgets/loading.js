import { Skeleton } from "@/components/ui/skeleton";

// Matches budgets/page.jsx: heading and its action, the summary strip, then
// the budget cards at the same breakpoints the page uses.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your budgets</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* One block, because the summary is one divided strip. */}
      <Skeleton className="h-28 rounded-xl" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
