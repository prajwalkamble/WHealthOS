"use client";

import { AlertCircle, Info, Loader2, Lock, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { PHASES, useRazorpayCheckout } from "@/components/billing/use-checkout";
import { Button } from "@/components/ui/button";

// The one control in this application that can open a payment window.
//
// Everything it says about what is happening is driven by the hook's phase,
// and all of it is inline rather than in a toast: somebody halfway through
// paying needs the current state to still be on screen when they look back at
// it, and needs the retry to be where the failure was.
const LABELS = {
  [PHASES.CREATING]: "Preparing secure checkout…",
  [PHASES.OPENING]: "Opening Razorpay…",
  [PHASES.AWAITING]: "Waiting for payment…",
  [PHASES.VERIFYING]: "Confirming your payment…",
};

const PayButton = ({
  planId,
  interval,
  label,
  amountLabel,
  email = null,
  // True when a checkout for this exact plan was already opened and can be
  // resumed. Worth saying out loud, because the alternative reading of a
  // second visit to this page is "I am about to be charged twice".
  resumable = false,
}) => {
  const router = useRouter();
  const { start, reset, phase, error, busy } = useRazorpayCheckout({ email });

  const pay = () => start({ planId, interval, label });

  return (
    <div className="space-y-3">
      <Button
        type="button"
        size="lg"
        onClick={pay}
        disabled={busy}
        aria-busy={busy}
        className="w-full font-semibold"
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        {busy
          ? LABELS[phase] ?? "Working…"
          : phase === PHASES.DISMISSED || phase === PHASES.FAILED
            ? "Try again"
            : "Continue to secure payment"}
      </Button>

      {/* One live region for every outcome, so a screen reader hears the
          result of pressing the button without having to go looking for it.
          polite rather than assertive: nothing here interrupts a payment in
          progress, and Razorpay's own modal takes focus while it is open. */}
      <div role="status" aria-live="polite" className="space-y-3">
        {phase === PHASES.AWAITING && (
          <p className="text-xs text-muted-foreground">
            Finish the payment in the Razorpay window. If you closed it, press
            the button again — it reopens the same payment rather than starting
            another.
          </p>
        )}

        {phase === PHASES.VERIFYING && (
          <p className="text-xs text-muted-foreground">
            Payment received. Confirming it with your account — this takes a
            moment and it is safe to wait here.
          </p>
        )}

        {phase === PHASES.DISMISSED && (
          <div className="flex gap-2 rounded-md border bg-muted/50 p-3 text-xs leading-5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              <span className="font-semibold">Checkout cancelled.</span> Nothing
              has been charged and no subscription has started. Your selection
              is still here whenever you want it.
            </p>
          </div>
        )}

        {phase === PHASES.FAILED && error && (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs leading-5">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-negative"
              aria-hidden
            />
            <div className="space-y-2">
              <p className="font-semibold text-negative">{error.message}</p>
              {error.detail && <p className="text-foreground/80">{error.detail}</p>}
              {error.refresh && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  // router.refresh() rather than a reload: this page is
                  // server-rendered, and refreshing re-resolves the account's
                  // real state, which is exactly what a 409 is telling us to
                  // go and look at.
                  onClick={() => {
                    reset();
                    router.refresh();
                  }}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Refresh my plan
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {/* Deliberately a description of the integration and not a
            certification claim: WHealthOS has not been audited against any
            payment standard, and saying otherwise because a payment provider
            has would be a claim about us that nobody has earned. */}
        <span>
          {amountLabel} will be charged by Razorpay. Card, UPI and bank details
          are entered on Razorpay&rsquo;s own checkout and never reach
          WHealthOS.
        </span>
      </p>

      {resumable && phase === PHASES.IDLE && (
        <p className="text-xs text-muted-foreground">
          You started this checkout a few minutes ago and did not finish. This
          continues the same one — it will not charge you twice.
        </p>
      )}
    </div>
  );
};

export default PayButton;
