"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Stops a subscription at the end of the period already paid for.
//
// Two clicks rather than a dialog: this is reversible in the sense that
// nothing is lost until the period ends, and a confirm() would block the
// Razorpay script's own event handling if one were ever open.
const CancelSubscription = () => {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.cancelled) {
        toast.error(body?.error ?? "Could not cancel just now. Please try again.");
        return;
      }

      toast.success("Cancellation scheduled.", {
        description: body.accessUntil
          ? `You keep everything until ${new Date(body.accessUntil).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`
          : "You keep everything until the end of the period you have paid for.",
      });
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
      <Button type="button" variant="outline" size="sm" onClick={() => setArmed(true)}>
        Cancel subscription
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Stop renewing at the end of this period?</span>
      <Button type="button" size="sm" variant="destructive" onClick={cancel} disabled={busy}>
        {busy ? "Cancelling…" : "Yes, stop renewing"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setArmed(false)}>
        Keep it
      </Button>
    </span>
  );
};

export default CancelSubscription;
