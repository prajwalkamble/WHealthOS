import { Skeleton } from "@/components/ui/skeleton";

// Matches transfer/page.jsx, which blocks on getUserAccounts() before it can
// decide which of its two screens to render -- the panel, or the setup state
// for somebody with fewer than two accounts. Both open with the same centred
// column and the same header, so the skeleton can hold that much without
// committing to either.
//
// The step list and the form below it are one block rather than two: which
// rows appear depends on the answer, and a skeleton that drew three fields
// before a setup notice arrived would reflow into something a third the
// height.
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-4xl space-y-8 pb-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading fund transfer</span>

      <header className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full max-w-prose" />
          <Skeleton className="h-4 w-4/5 max-w-prose" />
        </div>
      </header>

      <Skeleton className="h-[26rem] rounded-xl" />
    </div>
  );
}
