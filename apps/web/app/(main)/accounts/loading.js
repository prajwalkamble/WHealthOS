import { Skeleton } from "@/components/ui/skeleton";

// Matches accounts/page.jsx: the heading and its summary line, then the card
// grid at the same breakpoints the page uses. Six tiles rather than a number
// read from anywhere -- how many accounts someone has is their information,
// and a skeleton that counted them would be leaking it before the page has
// decided whether to show it.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your accounts</span>

      {/* The header holds its action too, so it does not jump sideways when
          the New Account button arrives. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
