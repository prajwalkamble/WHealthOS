import Link from "next/link";
import { Lock } from "lucide-react";

import { devGrantsAll } from "@/lib/billing/dev-override";
import { enforcementEnabled, planGrants, smallestPlanWith } from "@/lib/billing/entitlements";
import { effectivePlanId } from "@/lib/billing/service";
import { getCurrentUserId } from "@/lib/prisma";
import { planById } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

// Feature gating, in the interface.
//
// Server components, deliberately. The plan is read from the database inside
// the render rather than handed to the browser and read back, so there is no
// client state to tamper with and no protected markup to strip -- a locked
// feature's children are never rendered, so they never reach the page at all.
//
// This is presentation only. It is NOT the authorisation: every gated
// operation checks again on the server through lib/billing/guard.js, and must
// keep doing so. Somebody calling a server action directly never passes
// through any of this.
//
// Both components agree with the server about when a refusal would actually
// happen: while BILLING_ENFORCEMENT is off, requireEntitlement lets everything
// through, so showing a padlock would be a lie. `enforced` is therefore part
// of the condition rather than just the entitlement.

async function denied(feature) {
  if (!enforcementEnabled()) return false;
  const userId = await getCurrentUserId();
  // The development override, asked here for the same reason enforcementEnabled
  // is: this has to agree with the server about when a refusal would actually
  // happen. lib/billing/guard.js lets this account through every gate, so a
  // padlock drawn over a control that works would be exactly the lie the
  // comment above warns about -- and it saves the query below.
  if (devGrantsAll(userId)) return false;
  return !planGrants(await effectivePlanId(userId), feature);
}

const planName = (planId) => planById(planId)?.name ?? planId;

/**
 * Renders `children` when the account's plan includes `feature`.
 *
 * @param {{ feature: string, children: React.ReactNode, fallback?: React.ReactNode, className?: string }} props
 */
export default async function FeatureGate({ feature, children, fallback, className }) {
  if (!(await denied(feature))) return children;
  if (fallback !== undefined) return fallback;
  return <FeatureLocked feature={feature} className={className} />;
}

/**
 * The locked state: what the feature is, which plan has it, and the way out.
 */
export function FeatureLocked({ feature, className }) {
  const needed = smallestPlanWith(feature);
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-sm sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">
          {needed
            ? `This is part of the ${planName(needed)} plan.`
            : "Your plan does not include this."}
        </p>
      </div>
      <Link
        href="/pricing"
        className="font-medium text-foreground underline underline-offset-4"
      >
        See plans
      </Link>
    </div>
  );
}

/**
 * A line of explanation shown only when the feature is NOT included, without
 * hiding anything.
 *
 * For the places where removing the controls would take something free away
 * with them: the Appearance card holds nine paid settings and the light/dark
 * switch, which every plan includes, so a padlock over the card would lock a
 * free feature. This says what will not save instead of hiding what will.
 */
export async function FeatureNotice({ feature, children, className }) {
  if (!(await denied(feature))) return null;
  const needed = smallestPlanWith(feature);
  return (
    <p
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
      role="status"
    >
      <Lock className="size-3.5 shrink-0" aria-hidden />
      <span>
        {children}{" "}
        {needed ? (
          <>
            Included in{" "}
            <Link href="/pricing" className="underline underline-offset-4">
              {planName(needed)}
            </Link>
            .
          </>
        ) : null}
      </span>
    </p>
  );
}
