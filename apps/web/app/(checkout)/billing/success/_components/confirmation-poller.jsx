"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Waiting for the webhook, without spinning forever.
//
// A subscription becomes active when Razorpay says so, which arrives as a
// webhook a second or two after the payment -- or, when a delivery is delayed
// or retried, minutes later. Neither this component nor anything else in the
// browser decides that. All it does is ask the server again, and the server
// answers from the subscription row.
//
// The three rules that make this safe rather than a spinner with no end:
//
//   bounded   a fixed number of attempts over roughly four minutes, then it
//             stops and says what to do next. A page that polls forever is a
//             page nobody can tell has failed.
//   backing   off, so a delayed webhook is not met with a request per second
//             for four minutes.
//   honest    it grants nothing. When it stops, the page re-renders from the
//             database and says whatever is actually true.
//
// Seconds between attempts. Roughly Fibonacci, then levelling off: quick at
// first because the usual case is settled in one or two tries, slower after
// that because anything still unconfirmed at thirty seconds is waiting on a
// retry cycle rather than on latency.
//
// The tail is long because of UPI Autopay. A card is authorised inside
// Razorpay's modal and settles in seconds, but a UPI mandate is approved in
// the payer's own app -- they leave the page, find their phone, enter a PIN --
// and a minute or two of that is ordinary. A schedule that stopped at two
// minutes showed somebody the "still not confirmed" panel while their mandate
// was being approved perfectly normally, which reads as a failure and is not
// one.
const BACKOFF = [2, 3, 5, 8, 13, 21, 30, 30, 45, 45, 60];

const ConfirmationPoller = () => {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [checking, setChecking] = useState(false);

  // The component is unmounted by the refresh it triggers, so every timer and
  // every in-flight answer has to be ignored once that has happened.
  const live = useRef(true);
  useEffect(() => () => {
    live.current = false;
  }, []);

  const check = useCallback(
    async ({ manual = false } = {}) => {
      if (manual) setChecking(true);
      try {
        const response = await fetch("/api/billing/subscription", {
          // The answer changes from underneath us; a cached one is the bug
          // this whole component exists to avoid.
          cache: "no-store",
        });
        if (!response.ok) return false;
        const body = await response.json();

        // Settled, either way: there is a subscription, or there is nothing
        // left on its way. The page itself decides which of those to say.
        if (body?.confirming === false) {
          if (live.current) router.refresh();
          return true;
        }
        return false;
      } catch {
        // A failed check is not a failed payment. Try again on the schedule.
        return false;
      } finally {
        if (live.current && manual) setChecking(false);
      }
    },
    [router]
  );

  useEffect(() => {
    if (exhausted) return;
    if (attempt >= BACKOFF.length) {
      setExhausted(true);
      return;
    }

    const timer = setTimeout(async () => {
      const settled = await check();
      if (!live.current || settled) return;
      setAttempt((value) => value + 1);
    }, BACKOFF[attempt] * 1000);

    return () => clearTimeout(timer);
  }, [attempt, check, exhausted]);

  if (exhausted) {
    return (
      <div className="space-y-3 rounded-md border bg-muted/50 p-4 text-sm leading-6">
        <p role="status">
          <span className="font-semibold">Still not confirmed.</span> This is
          unusual but not lost: if you were charged, the subscription will
          appear on its own once Razorpay&rsquo;s confirmation reaches us —
          their retries run for several days. Nothing needs paying again.
        </p>
        <p className="text-muted-foreground">
          If it has not appeared in an hour, send us the payment reference from
          your bank or UPI app and we will reconcile it by hand.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={checking}
            onClick={() => {
              setExhausted(false);
              setAttempt(0);
              check({ manual: true });
            }}
          >
            {checking ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
            )}
            Check again
          </Button>
          <Button type="button" size="sm" variant="ghost" asChild>
            <a href="/contact">Contact billing support</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {/* One live region, updated in place. Announcing every attempt would
          read out "checking" eight times to a screen reader. */}
      <p role="status" aria-live="polite">
        Checking with Razorpay… this page updates on its own.
      </p>
    </div>
  );
};

export default ConfirmationPoller;
