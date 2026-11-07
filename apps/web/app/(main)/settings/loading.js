import { Skeleton } from "@/components/ui/skeleton";

// Matches settings/page.jsx: a heading, then the five cards in the order the
// page renders them -- currency, appearance (the tall one), plan, data and
// privacy, account. Nothing here renders an email address or a name, not even
// as a grey bar labelled with one.
export default function Loading() {
  return (
    // Same cap as the page, or the cards are drawn full width and then snap
    // to 768px the moment the real ones arrive.
    <div
      className="mx-auto max-w-3xl space-y-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading your settings</span>

      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Measured against the real cards at this width rather than guessed:
          currency 212, appearance ~256, plan 256 (it grows with the
          subscription state, so this is the middle of its range), data and
          privacy 512, account 180. */}
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-[30rem] rounded-xl" />
      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}
