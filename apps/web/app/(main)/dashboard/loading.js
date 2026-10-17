import { Skeleton } from "@/components/ui/skeleton";

// The dashboard's own shape, held while the page's single data transaction
// runs. Next renders this inside the (main) layout, so the sidebar, the app
// header and the theme are already on screen and real -- only the panel area
// is standing in, and nothing here moves when the content arrives.
//
// The grids below are copied from dashboard/page.jsx rather than approximated:
// four stat cards at xl, then a three-across row, then the two-column row with
// transactions on the left and budget over accounts on the right. A skeleton
// that reflows into a different layout than the page it precedes is a layout
// shift with extra steps.
//
// No figures, no labels and no placeholder names: a loading state for a
// financial dashboard must not show anything a reader could mistake for their
// own money, including a plausible-looking zero.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your dashboard</span>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-[26rem] rounded-xl" />
        <div className="flex flex-col gap-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-[13rem] rounded-xl" />
        </div>
      </div>
    </div>
  );
}
