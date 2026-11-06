import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { requireBillingAccount } from "@/lib/billing/account-gate";
import { billingSummary } from "@/lib/billing/service";
import { enforcementEnabled } from "@/lib/billing/entitlements";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ConfirmationPoller from "./_components/confirmation-poller";

export const metadata = {
  title: "Subscription · WHealthOS",
  robots: { index: false, follow: false },
};

// Read fresh on every visit. A subscription that was PENDING a second ago is
// ACTIVE as soon as the webhook lands, and a cached page would keep saying
// "waiting" long after it stopped being true.
export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "long" });

// What this page is NOT: a receipt, and not proof of anything.
//
// Arriving here proves only that a browser arrived here. Every word below is
// read from the subscription row, which is written from Razorpay's own answer
// -- so somebody who types the URL in sees exactly what their account really
// says, which for most people is "you are on the Free plan".
//
// It is one page rather than three because there is one question -- what does
// my account say now -- and three URLs for it would mean three ways to show
// somebody the wrong one. /billing/failed cannot know a payment failed: all it
// could ever know is that a subscription is not active, which is also what a
// webhook that has not arrived yet looks like.
export default async function BillingSuccessPage() {
  const userId = await requireBillingAccount("/billing/success");
  const { subscription, pending, planId, attempt, confirming } =
    await billingSummary(userId);
  const current = subscription ?? pending;

  const active = Boolean(subscription);

  const Icon = active ? CheckCircle2 : confirming ? Clock : XCircle;
  const tone = active
    ? "text-emerald-600 dark:text-emerald-400"
    : confirming
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <Icon className={`h-8 w-8 ${tone}`} aria-hidden />
          <CardTitle className="mt-2">
            {active
              ? "Your subscription is active"
              : confirming
                ? "We are confirming your subscription"
                : "No active subscription"}
          </CardTitle>
          <CardDescription>
            {active
              ? `You are on the ${planId[0].toUpperCase()}${planId.slice(1)} plan.`
              : confirming
                ? "Razorpay has not confirmed the payment yet. This usually takes a few seconds, and nothing is lost if it takes longer."
                : "Nothing has been charged, and this account is on the Free plan."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-sm">
          {current?.currentEnd && active && (
            <p className="text-muted-foreground">
              Renews on {day.format(new Date(current.currentEnd))}.
            </p>
          )}

          {confirming && (
            <>
              <p className="text-muted-foreground">
                You do not need to pay again, and you can leave this page — the
                subscription will appear on your account either way.
                {attempt?.planId &&
                  ` The payment was for ${attempt.planId[0].toUpperCase()}${attempt.planId.slice(1)}.`}
              </p>
              {/* Bounded, backing off, and it grants nothing: it asks the
                  server again and the server answers from the database. */}
              <ConfirmationPoller />
            </>
          )}

          {!active && !confirming && (
            <p className="text-muted-foreground">
              If you have just paid and this still says Free in a few minutes,
              nothing is lost and nothing needs paying again — send us the
              payment reference and we will reconcile it.
            </p>
          )}

          {active && !enforcementEnabled() && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
              Paid features are not yet locked for anyone, so this subscription
              does not change what you can do today.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/settings#plan">Manage plan</Link>
            </Button>
            {!active && !confirming && (
              <Button asChild variant="ghost">
                <Link href="/pricing">See the plans</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
