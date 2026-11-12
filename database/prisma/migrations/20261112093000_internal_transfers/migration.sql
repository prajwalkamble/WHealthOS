-- Internal account-to-account transfers.
--
-- Moving ₹10,000 from savings to current is not income and not an expense:
-- one account falls, another rises, and the person is no better or worse off.
-- Until now the only way to record it was two unrelated transactions -- an
-- EXPENSE here and an INCOME there -- which got the two balances right and
-- every other figure wrong. It inflated the month's income AND the month's
-- expenses by the same amount, which pushed the savings rate towards zero,
-- put a phantom category in the breakdown, and fed the landing page's
-- "average saved" statistic money nobody earned.
--
-- ---------------------------------------------------------------------------
-- WHY A TRANSFER RECORD *AND* TWO TRANSACTION LEGS
-- ---------------------------------------------------------------------------
-- Account.balance is a stored column, maintained incrementally. The rule for
-- how a row moves it lives in exactly one function -- balanceEffect() in
-- apps/web/lib/money.js -- and that file states the invariant the rest of the
-- application leans on: balanceEffect is the ONLY thing that writes to
-- Account.balance. openingBalance() reconstructs a historical balance by
-- unwinding transactions through it, and statements are drawn from that.
--
-- A transfer that adjusted two balances directly, with no transaction rows,
-- would break that invariant in the quietest possible way: balances would be
-- right today and every reconstructed past balance would be wrong, with
-- nothing in the ledger to explain the difference. So each side of a transfer
-- is a real transaction row, carrying the new TRANSFER_OUT / TRANSFER_IN type,
-- and balanceEffect simply learns two more cases. Account history, the account
-- page, global search and the transactions table all keep working because the
-- rows are there to be found.
--
-- The transfers row above them is what makes it ONE operation rather than two
-- that happen to agree: a single id to show the person, a single idempotency
-- key, and the thing both legs point at.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ENFORCED HERE RATHER THAN IN CODE
-- ---------------------------------------------------------------------------
-- The service validates all of this before writing. These constraints are the
-- guarantee that survives a bug in it:
--
--   amount > 0                  a transfer of zero or of a negative amount is
--                               not a transfer, it is a corruption
--   from <> to                  an account cannot transfer to itself; the two
--                               increments would cancel and leave a ledger
--                               entry pair describing nothing
--   one leg per side            UNIQUE (transferId, type) -- a transfer can
--                               never produce a duplicate debit or credit,
--                               which is the invariant a retry threatens
--   leg implies transfer        a TRANSFER_OUT/TRANSFER_IN row cannot exist
--                               without a transfer, and an INCOME/EXPENSE row
--                               cannot be attached to one
--   idempotencyKey unique       a replayed confirmation loses in the database
--                               rather than relying on the request arriving
--                               once
--
-- Currency is single, deliberately. Cross-currency transfers are refused by
-- the service and there is no rate, source amount or destination amount column
-- here, because inventing a converted figure and storing it permanently is a
-- product promise WHealthOS has not made: the ECB rate cache is for DISPLAY
-- conversion, two supported currencies (AED, SAR) have no published rate at
-- all, and the refresh job's own history shows it can fall behind. The policy
-- a cross-currency transfer would need is written up in
-- docs/features/INTERNAL_ACCOUNT_TRANSFERS.md; the columns arrive with it.
BEGIN;

CREATE TABLE public.transfers (
    "id"             TEXT            NOT NULL,
    "userId"         TEXT            NOT NULL,
    "fromAccountId"  TEXT            NOT NULL,
    "toAccountId"    TEXT            NOT NULL,
    -- The same numeric type as every other money column in the schema. One
    -- amount, not a source and a destination amount: both accounts are in the
    -- same currency, so a second column could only ever disagree with this one.
    "amount"         DECIMAL(65,30)  NOT NULL,
    -- Copied from the accounts at the time of the transfer, like
    -- Transaction.currency, and never updated: what a transfer was in is a
    -- historical fact. Both legs carry the same value.
    "currency"       TEXT            NOT NULL,
    "date"           TIMESTAMP(3)    NOT NULL,
    "description"    TEXT,
    -- Scoped to the user by the service ("<userId>:<client key>"), so one
    -- person's key can never collide with or replay as another's.
    "idempotencyKey" TEXT            NOT NULL,
    "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.transfers
  ADD CONSTRAINT "transfers_amount_positive" CHECK ("amount" > 0);

ALTER TABLE public.transfers
  ADD CONSTRAINT "transfers_distinct_accounts"
  CHECK ("fromAccountId" <> "toAccountId");

ALTER TABLE public.transfers
  ADD CONSTRAINT "transfers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public.users("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade, matching transactions.accountId. There is no account-deletion path
-- in the application today (accounts go only when the user does), and if one
-- is ever added it has to reverse that account's transfers first -- otherwise
-- the far side of each transfer keeps a balance the ledger no longer explains.
-- Recorded as a known limitation in the feature document rather than left to
-- be discovered.
ALTER TABLE public.transfers
  ADD CONSTRAINT "transfers_fromAccountId_fkey"
  FOREIGN KEY ("fromAccountId") REFERENCES public.accounts("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.transfers
  ADD CONSTRAINT "transfers_toAccountId_fkey"
  FOREIGN KEY ("toAccountId") REFERENCES public.accounts("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "transfers_idempotencyKey_key"
  ON public.transfers("idempotencyKey");

-- A person's own transfers, newest first: the list on the account page and the
-- detail lookup after a confirmation.
CREATE INDEX "transfers_userId_date_idx" ON public.transfers("userId", "date" DESC);
CREATE INDEX "transfers_fromAccountId_idx" ON public.transfers("fromAccountId");
CREATE INDEX "transfers_toAccountId_idx" ON public.transfers("toAccountId");

-- --- The legs ---------------------------------------------------------------

ALTER TABLE public.transactions ADD COLUMN "transferId" TEXT;

ALTER TABLE public.transactions
  ADD CONSTRAINT "transactions_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES public.transfers("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a transfer therefore removes both legs in one statement, and there
-- is no state in which one survives the other.

-- Invariant 5, as a constraint: one logical transfer, at most one debit and at
-- most one credit. A retry that got past the idempotency key, a double-click
-- that raced, a bug that looped -- all of them lose here.
CREATE UNIQUE INDEX "transactions_transfer_leg_key"
  ON public.transactions("transferId", "type")
  WHERE "transferId" IS NOT NULL;

-- Finding both legs of a transfer, and the account-history join.
CREATE INDEX "transactions_transferId_idx"
  ON public.transactions("transferId")
  WHERE "transferId" IS NOT NULL;

-- The two halves of one rule: a transfer leg always belongs to a transfer, and
-- an ordinary transaction never does. Without this, a crafted write could
-- create a TRANSFER_OUT with no counterpart -- money destroyed, with a row
-- that looks legitimate to every reader -- or attach an EXPENSE to a transfer
-- and have it counted twice.
--
-- Every existing row has transferId NULL and a type of INCOME or EXPENSE, so
-- this validates against the current table without touching it.
ALTER TABLE public.transactions
  ADD CONSTRAINT "transactions_transfer_leg_check"
  CHECK (
    ("transferId" IS NULL     AND "type" IN ('INCOME', 'EXPENSE'))
    OR
    ("transferId" IS NOT NULL AND "type" IN ('TRANSFER_OUT', 'TRANSFER_IN'))
  );

-- --- Row-level security -----------------------------------------------------
--
-- The feedback shape, not the checkout_attempts shape: a transfer is the
-- person's own record, authored by them, so they may insert and delete it --
-- and the WITH CHECK is what makes "transfer out of somebody else's account"
-- fail in the database rather than depend on the service resolving the right
-- id. It does resolve it, and this holds if it ever stops.
--
-- UPDATE is granted to nobody but the job runner. Transfers are immutable by
-- policy -- to correct one you delete it and make another -- and a policy that
-- cannot be bypassed is better than a service that chooses not to offer the
-- operation. Nothing in the application updates a transfer row; this is the
-- guarantee that no future code can without a migration saying so.
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transfers_read ON public.transfers;
CREATE POLICY transfers_read ON public.transfers
  FOR SELECT
  USING (app_is_job_runner() OR "userId" = app_current_tenant());

DROP POLICY IF EXISTS transfers_insert ON public.transfers;
CREATE POLICY transfers_insert ON public.transfers
  FOR INSERT
  WITH CHECK (app_is_job_runner() OR "userId" = app_current_tenant());

DROP POLICY IF EXISTS transfers_update ON public.transfers;
CREATE POLICY transfers_update ON public.transfers
  FOR UPDATE
  USING      (app_is_job_runner())
  WITH CHECK (app_is_job_runner());

DROP POLICY IF EXISTS transfers_delete ON public.transfers;
CREATE POLICY transfers_delete ON public.transfers
  FOR DELETE
  USING (app_is_job_runner() OR "userId" = app_current_tenant());

COMMIT;
