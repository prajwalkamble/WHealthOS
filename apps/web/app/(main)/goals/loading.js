import { Skeleton } from "@/components/ui/skeleton";

// Matches goals/page.jsx. The summary is one divided strip, not four cards:
// this drew four separate tiles, so the row visibly regrouped itself the
// moment the data arrived.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your goals</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <Skeleton className="h-28 rounded-xl" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
