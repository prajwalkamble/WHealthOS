import { Skeleton } from "@/components/ui/skeleton";

// Matches account/[id]/page.jsx: the name and its account-type line on the
// left, the balance and its two actions on the right, then the chart and the
// transaction table.
//
// This route had no loading boundary at all. The Suspense wrappers inside the
// page cannot stand in for one: the page awaits getAccountWithTransactions()
// and getUserAccounts() above its JSX, so by the time those boundaries render
// there is nothing left to suspend on and their fallbacks never appear. The
// await happens before any of it, which is precisely the part that is slow,
// and until that resolved the navigation showed the previous page.
//
// No figures and no name: whose account it is and what is in it are the two
// things this page exists to say, and a skeleton must not guess at either.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading this account</span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {/* The h1 and the "Current Account · 12 transactions" line. */}
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>

        {/* Balance above the Transfer and Export buttons, right-aligned like
            the real header so nothing slides across when it arrives. */}
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <Skeleton className="h-9 w-36" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
