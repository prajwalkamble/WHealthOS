"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Schedules a move up to a higher plan.
//
// Deliberately NOT the pay button, and not a variant of it. That one opens
// Razorpay's payment window; this one takes no payment at all, because the
// period in progress has already been paid for at the old rate and the new
// rate starts when the next one does. There is no amount to authorise here, no
// card to enter, no signature to verify, and presenting it as a checkout would
// be telling somebody they are about to be charged when they are not.
//
// Two clicks, like cancellation. For the same reason: this changes a real
// recurring mandate, and the second click is where the date and the new price
// are stated, so nobody schedules an upgrade without having read what it costs
// and when it starts.
const UpgradeButton = ({
  planId,
  interval,
  // The plan being moved to, and what it will cost from the next period.
  // Both already formatted by the server, which is the only thing that priced
  // them -- this component does no arithmetic.
  planName,
  amountLabel,
  // When it takes effect, as a sentence. Null when the provider has not told
  // us the period end, in which case the wording stays general rather than
  // inventing a date.
  effectiveLabel = null,
}) => {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const upgrade = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/billing/plan-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A plan id and an interval. No amount, no currency, no provider plan
        // id: the server resolves every one of those from configuration, and
        // would ignore them if they were sent.
        body: JSON.stringify({ planId, interval }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.scheduled) {
        // The server's own sentence, which says what to do about it -- "cancel
        // in Settings", "only while it is active". Flattening those into one
        // generic failure is what this passes through to avoid.
        toast.error(body?.error ?? "Could not schedule the change just now. Please try again.");
        return;
      }

      toast.success(`${planName} is scheduled.`, {
        description: body.effectiveFrom
          ? `It starts on ${new Date(body.effectiveFrom).toLocaleDateString("en-IN", { dateStyle: "medium" })}. Nothing has been charged today.`
          : "It starts at the end of the period you have paid for. Nothing has been charged today.",
      });
      // The page re-renders into the "already scheduled" state, which is the
      // confirmation: a toast that disappears is not a record of what happened.
      router.refresh();
    } catch {
      toast.error("Could not reach WHealthOS. Please try again.");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  if (!armed) {
    return (
      <Button
        type="button"
        size="lg"
        onClick={() => setArmed(true)}
        className="w-full font-semibold"
      >
        Upgrade to {planName}
        <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden />
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {/* Everything the second click commits to, in one place. The figure and
          the date are both here rather than one here and one in the summary
          above, because this is the moment somebody decides. */}
      <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm leading-6">
        <span className="font-semibold">Confirm the upgrade.</span> Nothing is
        charged today. {effectiveLabel ?? "At the end of the period you have already paid for"}{" "}
        your subscription moves to {planName} and {amountLabel} is charged then,
        and each period after that until you cancel.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={upgrade} disabled={busy} aria-busy={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {busy ? "Scheduling…" : `Yes, upgrade to ${planName}`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setArmed(false)} disabled={busy}>
          Keep my current plan
        </Button>
      </div>
    </div>
  );
};

export default UpgradeButton;
