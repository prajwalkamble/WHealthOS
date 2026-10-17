import { Skeleton } from "@/components/ui/skeleton";

// Matches transactions/page.jsx: a title and summary line on the left, the
// import, export and add controls on the right, then the table. The row of
// controls is held at its real width so the header does not jump sideways
// when the buttons arrive.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your transactions</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      {/* The filter bar above the table, then the rows. */}
      <Skeleton className="h-11 rounded-lg" />
      <div className="space-y-px overflow-hidden rounded-xl border">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
