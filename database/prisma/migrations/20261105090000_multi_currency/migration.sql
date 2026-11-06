-- Multi-currency: giving every financial record a currency of its own.
--
-- Additive. No amount is changed, no row is deleted, and nothing is
-- reinterpreted.
--
-- On the INR default, because this is the part worth being careful about.
-- Until now no financial table in WHealthOS had a currency column at all:
-- every balance and every transaction amount was an untagged numeric. They
-- were not ambiguous, they were implicitly rupees -- the only formatter in
-- the application was hard-wired to en-IN/INR, every price is in rupees, and
-- Razorpay settles in INR. So DEFAULT 'INR' writes down what was already
-- true. It is the opposite of reinterpreting existing values: leaving the
-- column nullable would be what made their currency genuinely unknown.
--
-- `users.displayCurrency` is a different kind of thing and is deliberately
-- nullable. It is a reading preference, not a property of any money, and
-- null means "never chosen" -- which is what lets the country a request comes
-- from supply a suggestion instead.
BEGIN;

-- --- Currency on the financial records --------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE public.transactions
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE public.budgets
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE public.cards
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE public.goals
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

-- goal_contributions deliberately gets none: a contribution belongs to
-- exactly one goal and counts towards that goal's target, so a second
-- currency on it could only ever disagree with the goal's.

-- --- The reading preference -------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN "displayCurrency" TEXT;

-- --- Exchange rates ---------------------------------------------------------

CREATE TABLE public.exchange_rates (
    "id"        TEXT           NOT NULL,
    "base"      TEXT           NOT NULL,
    "quote"     TEXT           NOT NULL,
    -- A rate is not money and the money scale is wrong for it. Twelve decimal
    -- places holds JPY and KRW pairs without rounding away the digits that
    -- carry the value.
    "rate"      DECIMAL(24,12) NOT NULL,
    "source"    TEXT           NOT NULL,
    -- The date the rate is FOR. A date, not a timestamp: the ECB publishes
    -- once per working day, and this is what makes a conversion shown months
    -- ago reproducible today.
    "asOf"      DATE           NOT NULL,
    "fetchedAt" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- One rate per pair per day per provider. A refetch updates the row rather
-- than appending a second opinion about the same day.
CREATE UNIQUE INDEX "exchange_rates_base_quote_asOf_source_key"
  ON public.exchange_rates("base", "quote", "asOf", "source");

-- How a conversion finds the newest rate at or before a date.
CREATE INDEX "exchange_rates_lookup_idx"
  ON public.exchange_rates("base", "quote", "asOf" DESC);

-- --- Row-level security -----------------------------------------------------

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates FORCE  ROW LEVEL SECURITY;

-- Reference data, not anybody's data. One row serves every user and no row
-- belongs to a tenant, so every role reads and only the job runner writes --
-- a tenant that could insert a rate could decide what their own net worth
-- converts to.
DROP POLICY IF EXISTS exchange_rates_read ON public.exchange_rates;
CREATE POLICY exchange_rates_read ON public.exchange_rates
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS exchange_rates_write ON public.exchange_rates;
CREATE POLICY exchange_rates_write ON public.exchange_rates
  FOR ALL
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

COMMIT;
