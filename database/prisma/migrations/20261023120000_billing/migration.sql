-- Billing: subscriptions, payments and the provider's webhook deliveries.
--
-- Deliberately additive. No existing table is touched, no row is written for
-- anyone, and nothing in the application changes behaviour because this ran:
-- with no subscription rows every account resolves to the Free plan, which is
-- what every account already had.
--
-- Row-level security follows legal_consents rather than transactions. These
-- are billing records, not tenant data the tenant owns: a person may read
-- their own, and only the job runner may write any of them. The checkout
-- service and the webhook both run as the job runner. A request carrying a
-- signed-in user's tenant context therefore cannot insert a subscription,
-- mark one active, or change what it cost.
BEGIN;

-- --- Enums ------------------------------------------------------------------

CREATE TYPE "PaymentProvider"    AS ENUM ('RAZORPAY');
CREATE TYPE "BillingInterval"    AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'PENDING', 'ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED',
  'CANCELLED', 'COMPLETED', 'EXPIRED', 'PAUSED'
);
CREATE TYPE "PaymentStatus"      AS ENUM ('CAPTURED', 'AUTHORIZED', 'FAILED', 'REFUNDED');
CREATE TYPE "BillingEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- --- Subscriptions ----------------------------------------------------------

CREATE TABLE public.subscriptions (
    "id"                     TEXT                 NOT NULL,
    "userId"                 TEXT                 NOT NULL,
    "planId"                 TEXT                 NOT NULL,
    "interval"               "BillingInterval"    NOT NULL,
    "provider"               "PaymentProvider"    NOT NULL DEFAULT 'RAZORPAY',
    "providerSubscriptionId" TEXT                 NOT NULL,
    "providerCustomerId"     TEXT,
    "providerPlanId"         TEXT,
    "status"                 "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "amount"                 INTEGER              NOT NULL,
    "currency"               TEXT                 NOT NULL DEFAULT 'INR',
    "currentStart"           TIMESTAMP(3),
    "currentEnd"             TIMESTAMP(3),
    "cancelAtPeriodEnd"      BOOLEAN              NOT NULL DEFAULT false,
    "cancelledAt"            TIMESTAMP(3),
    "endedAt"                TIMESTAMP(3),
    "lastEventAt"            TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.subscriptions
  ADD CONSTRAINT "subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public.users("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The provider's id identifies the row a webhook is about. Two rows claiming
-- the same one would make "whose subscription is this" ambiguous at the exact
-- moment it matters most.
CREATE UNIQUE INDEX "subscriptions_providerSubscriptionId_key"
  ON public.subscriptions("providerSubscriptionId");

CREATE INDEX "subscriptions_userId_idx" ON public.subscriptions("userId");
CREATE INDEX "subscriptions_status_idx" ON public.subscriptions("status");

-- At most one live subscription per person, enforced by the database.
--
-- This is the duplicate-checkout protection that actually holds. The service
-- checks for a live subscription before opening one, but two requests racing
-- -- a double click, or a retry after a timeout that did in fact succeed --
-- both pass that check and both insert. A partial unique index makes the
-- second insert lose, which is the only version of this that is not a race.
--
-- Ended subscriptions are excluded so somebody who cancels can subscribe
-- again, and so the history stays.
CREATE UNIQUE INDEX "subscriptions_one_live_per_user"
  ON public.subscriptions("userId")
  WHERE "status" IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCEL_SCHEDULED', 'PAUSED');

-- --- Payments ---------------------------------------------------------------

CREATE TABLE public.payments (
    "id"                TEXT              NOT NULL,
    "subscriptionId"    TEXT              NOT NULL,
    "provider"          "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "providerPaymentId" TEXT              NOT NULL,
    "providerInvoiceId" TEXT,
    "amount"            INTEGER           NOT NULL,
    "currency"          TEXT              NOT NULL DEFAULT 'INR',
    "status"            "PaymentStatus"   NOT NULL,
    "periodStart"       TIMESTAMP(3),
    "periodEnd"         TIMESTAMP(3),
    "paidAt"            TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.payments
  ADD CONSTRAINT "payments_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES public.subscriptions("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Razorpay retries a delivery until it gets a 2xx, so the same charge arrives
-- more than once. Unique means the second insert loses rather than recording
-- a charge that never happened.
CREATE UNIQUE INDEX "payments_providerPaymentId_key"
  ON public.payments("providerPaymentId");
CREATE INDEX "payments_subscriptionId_idx" ON public.payments("subscriptionId");

-- --- Webhook deliveries -----------------------------------------------------

CREATE TABLE public.billing_events (
    "id"                     TEXT                 NOT NULL,
    "provider"               "PaymentProvider"    NOT NULL DEFAULT 'RAZORPAY',
    "providerEventId"        TEXT                 NOT NULL,
    "eventType"              TEXT                 NOT NULL,
    "status"                 "BillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "providerSubscriptionId" TEXT,
    "providerPaymentId"      TEXT,
    "note"                   TEXT,
    "receivedAt"             TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"            TIMESTAMP(3),

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- The whole of webhook idempotency, in one constraint.
CREATE UNIQUE INDEX "billing_events_providerEventId_key"
  ON public.billing_events("providerEventId");
CREATE INDEX "billing_events_providerSubscriptionId_idx"
  ON public.billing_events("providerSubscriptionId");
CREATE INDEX "billing_events_receivedAt_idx"
  ON public.billing_events("receivedAt" DESC);

-- --- Row-level security -----------------------------------------------------

ALTER TABLE public.subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events FORCE  ROW LEVEL SECURITY;

-- A tenant reads their own subscription. Nobody but the job runner writes one.
DROP POLICY IF EXISTS subscriptions_read ON public.subscriptions;
CREATE POLICY subscriptions_read ON public.subscriptions
  FOR SELECT
  USING (app_is_job_runner() OR "userId" = app_current_tenant());

DROP POLICY IF EXISTS subscriptions_write ON public.subscriptions;
CREATE POLICY subscriptions_write ON public.subscriptions
  FOR ALL
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

-- Payments are read through the subscription they belong to, so the predicate
-- follows the same ownership rather than duplicating a userId column that
-- could disagree with it.
DROP POLICY IF EXISTS payments_read ON public.payments;
CREATE POLICY payments_read ON public.payments
  FOR SELECT
  USING (
    app_is_job_runner()
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s."id" = public.payments."subscriptionId"
        AND s."userId" = app_current_tenant()
    )
  );

DROP POLICY IF EXISTS payments_write ON public.payments;
CREATE POLICY payments_write ON public.payments
  FOR ALL
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

-- Webhook deliveries are operational records about the provider, not about a
-- person, and a delivery for an unknown subscription has no owner at all. No
-- tenant reads them.
DROP POLICY IF EXISTS billing_events_jobs_only ON public.billing_events;
CREATE POLICY billing_events_jobs_only ON public.billing_events
  FOR ALL
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

COMMIT;
