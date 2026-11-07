import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your analytics</span>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      {/* The filter bar. */}
      <Skeleton className="h-14 rounded-xl" />

      {/* The four headline figures. This was missing entirely, so every card
          below it shifted up the page while loading and then jumped down
          when the figures arrived. */}
      <Skeleton className="h-28 rounded-xl" />

      {/* The cashflow card, then the flow chart, then the category table:
          the skeleton matches the real heights so nothing jumps. */}
      <Skeleton className="h-[26rem] rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
