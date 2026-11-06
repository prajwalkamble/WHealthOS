-- Checkout attempts: the record that a purchase was started, written before
-- Razorpay is called.
--
-- Additive. No existing table is altered, no row is written for anyone, and
-- an account with no attempts behaves exactly as it did.
--
-- Why this table exists, in one sentence: creating the provider's
-- subscription first and recording it afterwards means a timeout leaves a
-- subscription at Razorpay that nothing here knows about, and the retry
-- creates a second one. This row is what the retry finds.
--
-- Row-level security follows subscriptions: a person may read their own
-- attempts, and only the job runner writes any of them. The checkout service
-- runs as the job runner, so a request carrying a signed-in user's tenant
-- context cannot invent an attempt, change its price, or point it at somebody
-- else's provider subscription.
BEGIN;

CREATE TYPE "CheckoutAttemptStatus" AS ENUM (
  'OPEN', 'CREATED', 'COMPLETED', 'ABANDONED', 'FAILED'
);

CREATE TABLE public.checkout_attempts (
    "id"                     TEXT                    NOT NULL,
    "userId"                 TEXT                    NOT NULL,
    "planId"                 TEXT                    NOT NULL,
    "interval"               "BillingInterval"       NOT NULL,
    "provider"               "PaymentProvider"       NOT NULL DEFAULT 'RAZORPAY',
    "providerPlanId"         TEXT                    NOT NULL,
    "amount"                 INTEGER                 NOT NULL,
    "currency"               TEXT                    NOT NULL DEFAULT 'INR',
    "idempotencyKey"         TEXT                    NOT NULL,
    "providerSubscriptionId" TEXT,
    "status"                 "CheckoutAttemptStatus" NOT NULL DEFAULT 'OPEN',
    "failureCode"            TEXT,
    "expiresAt"              TIMESTAMP(3)            NOT NULL,
    "createdAt"              TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "checkout_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.checkout_attempts
  ADD CONSTRAINT "checkout_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public.users("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ours, and sent to Razorpay in the subscription's notes. Unique so the
-- reconciliation that reads those notes back cannot match two attempts.
CREATE UNIQUE INDEX "checkout_attempts_idempotencyKey_key"
  ON public.checkout_attempts("idempotencyKey");

-- Two attempts claiming the same provider subscription would make "which
-- purchase is this" ambiguous at the moment a payment arrives.
CREATE UNIQUE INDEX "checkout_attempts_providerSubscriptionId_key"
  ON public.checkout_attempts("providerSubscriptionId");

CREATE INDEX "checkout_attempts_userId_idx"    ON public.checkout_attempts("userId");
CREATE INDEX "checkout_attempts_expiresAt_idx" ON public.checkout_attempts("expiresAt");

-- At most one attempt in flight per person, enforced by the database.
--
-- This is the duplicate protection that holds where a disabled button does
-- not: a double click, two tabs, or a client retry after a timeout all race
-- here, and exactly one of them creates the attempt. The loser is told an
-- attempt already exists and is handed the same provider subscription rather
-- than opening a second one.
--
-- Only the two in-flight states are covered, so a finished, abandoned or
-- failed attempt frees the slot immediately.
CREATE UNIQUE INDEX "checkout_attempts_one_open_per_user"
  ON public.checkout_attempts("userId")
  WHERE "status" IN ('OPEN', 'CREATED');

-- --- Row-level security -----------------------------------------------------

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_attempts FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkout_attempts_read ON public.checkout_attempts;
CREATE POLICY checkout_attempts_read ON public.checkout_attempts
  FOR SELECT
  USING (app_is_job_runner() OR "userId" = app_current_tenant());

DROP POLICY IF EXISTS checkout_attempts_write ON public.checkout_attempts;
CREATE POLICY checkout_attempts_write ON public.checkout_attempts
  FOR ALL
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

COMMIT;
