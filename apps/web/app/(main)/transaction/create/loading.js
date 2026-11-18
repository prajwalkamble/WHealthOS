import { Skeleton } from "@/components/ui/skeleton";

// Matches transaction/create/page.jsx: the centred narrow column, the big
// title, then the form -- the scanner strip, the type toggle, the two-column
// amount and account row, and the fields under it.
//
// Reached from the dashboard's own "Add Transaction" button, so it is one of
// the most-clicked navigations in the shell, and it had no loading state.
// Editing an existing transaction (?edit=) comes through the same route and
// loads a third thing, so this is the slowest of the three cases it covers.
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the transaction form</span>

      {/* The h1 is text-5xl with mb-8 under it. */}
      <Skeleton className="mb-8 h-12 w-72" />

      <div className="space-y-6">
        {/* The receipt-scanner strip, which the page decides whether to
            offer. Dashed-border height either way, so the form below it does
            not shift once that decision arrives. */}
        <Skeleton className="h-20 rounded-lg" />

        {/* Type. */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full" />
        </div>

        {/* Amount and account, side by side from md up. */}
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>

        {/* Category, date, description. */}
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}

        {/* The recurring switch, in its bordered row. */}
        <Skeleton className="h-20 rounded-lg" />

        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 flex-1" />
        </div>
      </div>
    </div>
  );
}
