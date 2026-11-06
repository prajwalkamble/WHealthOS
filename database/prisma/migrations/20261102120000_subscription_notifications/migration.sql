-- Subscription notifications: the outbox for subscription email.
--
-- Additive. No existing table is altered and nothing in the application
-- changes behaviour because this ran -- a deployment with no activations
-- after it writes no rows here at all.
--
-- Why a table rather than sending the email where the subscription is
-- activated: the email is the only part of activating a subscription that
-- depends on a third party, and it is the part most likely to fail. Writing
-- the intention down first means a crash, a deploy or an hour of Resend
-- downtime between "payment verified" and "email sent" loses nothing, and
-- that a retry cannot send a second copy.
--
-- Row-level security follows subscriptions: a person may read their own
-- notifications, and only the job runner writes any of them. The webhook, the
-- checkout service and the email job all run as the job runner, so a request
-- carrying a signed-in user's tenant context cannot create a notification,
-- mark one sent, or point one at another address.
BEGIN;

-- --- Enums ------------------------------------------------------------------

-- One member today. Adding renewal or cancellation mail later adds a member
-- here and a template; the outbox, the idempotency key, the retry and the
-- delivery tracking are already event-agnostic.
CREATE TYPE "NotificationEvent" AS ENUM ('SUBSCRIPTION_ACTIVATED');

-- ACCEPTED is deliberately not called SENT. An id back from Resend means
-- Resend took the message; it is not evidence anybody received it. The
-- provider reports those through different webhook events, so they are
-- different states here.
CREATE TYPE "NotificationStatus" AS ENUM (
  'QUEUED', 'ACCEPTED', 'DELIVERED', 'DELAYED',
  'BOUNCED', 'COMPLAINED', 'FAILED', 'SKIPPED'
);

-- --- Table ------------------------------------------------------------------

CREATE TABLE public.subscription_notifications (
    "id"                TEXT                 NOT NULL,
    "userId"            TEXT                 NOT NULL,
    "subscriptionId"    TEXT                 NOT NULL,
    "event"             "NotificationEvent"  NOT NULL,
    "idempotencyKey"    TEXT                 NOT NULL,
    -- Null on a row that was never going to be sent: an account with no email
    -- address, or a subscription that predates this table.
    "recipientEmail"    TEXT,
    "status"            "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "attempts"          INTEGER              NOT NULL DEFAULT 0,
    -- Our own short reason, never a provider payload and never a credential.
    "lastError"         TEXT,
    "queuedAt"          TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt"        TIMESTAMP(3),
    "deliveredAt"       TIMESTAMP(3),
    "failedAt"          TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "subscription_notifications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.subscription_notifications
  ADD CONSTRAINT "subscription_notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public.users("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.subscription_notifications
  ADD CONSTRAINT "subscription_notifications_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES public.subscriptions("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The whole of "exactly one confirmation per activation", in one constraint.
--
-- Every path that could queue a notification -- the Razorpay webhook, the
-- browser callback after a verified payment, the status poll, the reconciling
-- sweep -- computes the same key for the same activation. The second writer
-- loses the insert, and losing it is the success case.
CREATE UNIQUE INDEX "subscription_notifications_idempotencyKey_key"
  ON public.subscription_notifications("idempotencyKey");

-- How a Resend delivery webhook finds the row it is about.
CREATE UNIQUE INDEX "subscription_notifications_providerMessageId_key"
  ON public.subscription_notifications("providerMessageId");

CREATE INDEX "subscription_notifications_userId_idx"
  ON public.subscription_notifications("userId");
CREATE INDEX "subscription_notifications_status_idx"
  ON public.subscription_notifications("status");
CREATE INDEX "subscription_notifications_subscriptionId_idx"
  ON public.subscription_notifications("subscriptionId");

-- --- Backfill ---------------------------------------------------------------
--
-- Every subscription that is already live gets a SKIPPED row.
--
-- This is not bookkeeping, it is the safety interlock. The reconciling sweep
-- looks for subscriptions that grant access and have no notification row, and
-- without this line its first run would email a confirmation to everybody who
-- had already bought a subscription -- "your subscription is now active" to
-- someone who activated it weeks ago, which reads like a second charge.
--
-- SKIPPED rather than SENT: no email was sent, and claiming one was would be
-- a false record in the audit trail.
INSERT INTO public.subscription_notifications
  ("id", "userId", "subscriptionId", "event", "idempotencyKey",
   "status", "lastError", "queuedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  s."userId",
  s."id",
  'SUBSCRIPTION_ACTIVATED',
  s."id" || ':SUBSCRIPTION_ACTIVATED',
  'SKIPPED',
  'live before subscription_notifications existed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM public.subscriptions s
WHERE s."status" IN ('ACTIVE', 'CANCEL_SCHEDULED');

-- --- Row-level security -----------------------------------------------------

ALTER TABLE public.subscription_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_notifications FORCE  ROW LEVEL SECURITY;

-- A tenant reads their own. Nobody but the job runner writes one.
DROP POLICY IF EXISTS subscription_notifications_read ON public.subscription_notifications;
CREATE POLICY subscription_notifications_read ON public.subscription_notifications
  FOR SELECT
  USING (app_is_job_runner() OR "userId" = app_current_tenant());

DROP POLICY IF EXISTS subscription_notifications_write ON public.subscription_notifications;
CREATE POLICY subscription_notifications_write ON public.subscription_notifications
  FOR ALL
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

COMMIT;
