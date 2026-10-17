import { Skeleton } from "@/components/ui/skeleton";

// Matches settings/page.jsx: a heading, then the stack of cards -- account,
// the monthly-insights toggle, data import and export, and appearance, which
// is the tall one. Nothing here renders an email address or a name, not even
// as a grey bar labelled with one.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your settings</span>

      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-80" />
      </div>

      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
