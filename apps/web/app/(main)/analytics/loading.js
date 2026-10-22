import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-12 rounded-xl" />
      {/* The cashflow card, then the flow chart: the skeleton matches the
          real heights so nothing jumps when the data lands. */}
      <Skeleton className="h-[26rem] rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
