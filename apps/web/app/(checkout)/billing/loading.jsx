// The skeleton for /billing.
//
// The page is server-rendered and reads the account's live subscription and
// open attempt before it can say anything, so there is a real wait here on a
// cold navigation. This is the shape that is coming -- a plan panel beside a
// summary -- rather than a spinner, so the layout does not jump when it
// arrives.
const Skeleton = ({ className }) => (
  <div className={`animate-pulse rounded-md bg-muted ${className}`} />
);

const BillingLoading = () => (
  <div className="mx-auto max-w-5xl" aria-busy="true">
    {/* The one announcement. Everything below is decoration and is hidden
        from assistive technology rather than read out as a list of nothing. */}
    <p role="status" className="sr-only">
      Loading your subscription details
    </p>

    <div aria-hidden>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-5 h-9 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="order-2 lg:order-1">
          <div className="space-y-5 rounded-xl border bg-card p-6">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-10 w-48 rounded-full" />
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
            <Skeleton className="h-28 w-full" />
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <div className="space-y-4 rounded-xl border bg-card p-6">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
            <Skeleton className="h-11 w-full" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default BillingLoading;
