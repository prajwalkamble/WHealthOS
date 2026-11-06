import { CONTACT_EMAIL } from "@/lib/company/contact";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { formatMinorUnits } from "@/lib/billing/money";
import { intervalLabel, planFeatures, renewalLabel } from "@/lib/billing/plans";
import { PLANS } from "@/data/pricing";
import { grantsAccess, SUBSCRIPTION_STATUS } from "@/lib/billing/status";
import { adminDb } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site";
import { APP_TIME_ZONE } from "@/lib/time";
import { NOTIFICATION_EVENT } from "./outbox";

// Everything the subscription-confirmation email says, assembled from records
// that have already been verified.
//
// The one rule this file exists to enforce: nothing in the email is computed
// from a request, a redirect, a webhook payload or a parameter. Every figure
// is read back out of the database AFTER the payment was verified and the
// subscription activated -- the amount from the payment row the webhook wrote,
// the plan from the subscription row, the recipient from the account, the
// features from the same registry the pricing page and the entitlement engine
// read. A caller supplies an id and nothing else.
//
// A field that cannot be established is left out. There is no fallback
// renewal date, no assumed currency and no default plan name, because a
// confirmation email is a document somebody checks against their bank
// statement: a missing line is recoverable, an invented one is not.

// Statuses that a confirmation email may describe.
//
// CANCEL_SCHEDULED is included because it is a paid, running subscription --
// Razorpay still calls it active -- and somebody who bought and immediately
// turned off renewal has still bought something. Everything else is either
// never-charged (PENDING, EXPIRED) or over.
export const CONFIRMABLE_STATUSES = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.CANCEL_SCHEDULED,
];

export const isConfirmable = (subscription) =>
  Boolean(subscription) &&
  CONFIRMABLE_STATUSES.includes(subscription.status) &&
  grantsAccess(subscription);

const planName = (planId) => PLANS.find((plan) => plan.id === planId)?.name ?? null;

// A date as a person reads it, in the application's timezone.
//
// The timezone is explicit because these are rendered by a background job on
// a server whose clock is UTC: formatting without one puts an Indian
// subscriber's 1 a.m. renewal on the previous day.
const dateLabel = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(date);
};

const STATUS_LABEL = {
  [SUBSCRIPTION_STATUS.ACTIVE]: "Active",
  [SUBSCRIPTION_STATUS.CANCEL_SCHEDULED]: "Active — will not renew",
};

/**
 * The model for one subscription's confirmation email.
 *
 * Returns `{ skip }` rather than throwing when there is nothing to send: a
 * deleted account, a subscription that is no longer confirmable, an account
 * with no email address. Those are all ordinary outcomes and none of them is
 * a reason to retry.
 */
export async function activationModel(subscriptionId) {
  const subscription = await adminDb.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      userId: true,
      planId: true,
      interval: true,
      status: true,
      amount: true,
      currency: true,
      currentStart: true,
      currentEnd: true,
      cancelAtPeriodEnd: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      // The charge behind this subscription, if one has been recorded. Only a
      // captured payment: an authorised-but-not-captured one is not money
      // that has moved, and a receipt must not say it is.
      payments: {
        where: { status: "CAPTURED" },
        orderBy: { paidAt: "desc" },
        take: 1,
        select: {
          providerPaymentId: true,
          amount: true,
          currency: true,
          paidAt: true,
          periodStart: true,
          periodEnd: true,
        },
      },
    },
  });

  if (!subscription) return { skip: "subscription no longer exists" };
  if (!isConfirmable(subscription)) {
    return { skip: `subscription is ${subscription.status}` };
  }

  const name = planName(subscription.planId);
  if (!name) {
    // The plan id on the row is not one this deployment sells. Refusing is
    // the only safe answer: the alternative is an email naming a plan that
    // does not exist, or listing the features of the wrong one.
    return { skip: `unknown plan "${subscription.planId}"` };
  }

  // §1.5 of the brief: the entitlement must be established, not assumed. This
  // is the same resolution the authorisation layer performs, so a plan that
  // grants nothing cannot produce a "here is what you unlocked" email.
  const entitlements = entitlementsFor(subscription.planId);
  if (entitlements.size === 0) {
    return { skip: `plan "${subscription.planId}" grants no entitlements` };
  }

  // Users who signed in without an email address get no mail. Clerk allows
  // it, so this is a real state and not a defect.
  const recipient = subscription.user?.email ?? null;
  if (!recipient) return { skip: "account has no email address" };

  const payment = subscription.payments[0] ?? null;
  const interval = String(subscription.interval ?? "").toLowerCase();
  const { added, inherited } = planFeatures(subscription.planId);

  // The amount from the charge where there is one, and from the subscription
  // otherwise -- the two agree, but the payment is the record of what was
  // actually taken, and that is what belongs on a receipt.
  const amountMinor = payment?.amount ?? subscription.amount ?? null;
  const currency = payment?.currency ?? subscription.currency ?? null;

  // The paid-through date. What to call it depends on whether it renews:
  // "renews on" for a running subscription, "access until" for one that has
  // been told to stop. Neither is computed -- both are the provider's own
  // current_end, and when it is absent nothing is shown.
  const periodEnd = subscription.currentEnd ?? payment?.periodEnd ?? null;

  return {
    skip: null,
    userId: subscription.userId,
    subscriptionId: subscription.id,
    recipient,
    model: {
      userName: subscription.user?.name ?? null,
      recipientEmail: recipient,
      planName: name,
      statusLabel: STATUS_LABEL[subscription.status] ?? null,
      startDate: dateLabel(
        subscription.currentStart ?? payment?.periodStart ?? subscription.createdAt
      ),
      renewalDate: dateLabel(periodEnd),
      // Which of the two the renewal date is. The template must not decide
      // this from the presence of a field.
      renews: !subscription.cancelAtPeriodEnd,
      billingCycle: intervalLabel(interval),
      renewalCadence: renewalLabel(interval),
      amount: formatMinorUnits(amountMinor, currency),
      currency: currency ?? null,
      paidOn: dateLabel(payment?.paidAt),
      // The provider's reference for the charge. A payment id, which is what
      // Razorpay prints on its own receipt -- not a card number, not a token,
      // not a signature.
      paymentReference: payment?.providerPaymentId ?? null,
      features: { added, inherited },
      links: {
        dashboard: absoluteUrl("/dashboard"),
        manage: absoluteUrl("/settings"),
        terms: absoluteUrl("/terms"),
        privacy: absoluteUrl("/privacy"),
      },
      supportEmail: CONTACT_EMAIL,
    },
  };
}

export const SUBJECT = "Your WHealthOS Subscription is Confirmed!";

export const ACTIVATION_EVENT = NOTIFICATION_EVENT.SUBSCRIPTION_ACTIVATED;

/**
 * The plain-text alternative, built from the same model as the HTML.
 *
 * Written out rather than derived from the rendered markup: a text part
 * produced by stripping tags reads like stripped tags, and this is the version
 * that a text-only client, a screen reader in plain-text mode and most spam
 * filters actually look at. Built from the same object as the HTML so the two
 * cannot disagree about what somebody paid.
 */
export function activationText(model) {
  const lines = [];
  const add = (label, value) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  lines.push("Your WHealthOS subscription is now active.");
  lines.push("");
  if (model.userName) lines.push(`Hello ${model.userName},`);
  lines.push(
    "Thank you for choosing WHealthOS. Your subscription has been activated " +
      "and everything on your plan is available now."
  );
  lines.push("");
  lines.push("Subscription details");
  lines.push("--------------------");
  add("Plan", model.planName);
  add("Status", model.statusLabel);
  add("Billing cycle", model.billingCycle);
  add("Started", model.startDate);
  if (model.renewalDate) {
    add(model.renews ? "Renews on" : "Access until", model.renewalDate);
  }
  add("Amount paid", model.amount);
  add("Paid on", model.paidOn);
  add("Payment reference", model.paymentReference);
  add("Account", model.recipientEmail);

  const unlocked = model.features?.added ?? [];
  if (unlocked.length) {
    lines.push("");
    lines.push(`What your ${model.planName} plan includes`);
    lines.push("--------------------");
    for (const feature of unlocked) lines.push(`* ${feature.label}`);
  }

  lines.push("");
  lines.push(`Go to your dashboard: ${model.links.dashboard}`);
  lines.push(`Manage your subscription: ${model.links.manage}`);
  lines.push("");
  lines.push(`Questions about billing? Write to ${model.supportEmail}.`);
  lines.push(`Terms of Service: ${model.links.terms}`);
  lines.push(`Privacy Policy: ${model.links.privacy}`);

  return lines.join("\n");
}
