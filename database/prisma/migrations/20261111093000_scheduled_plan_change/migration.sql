-- Where a scheduled plan change is recorded.
--
-- Additive: three nullable columns on an existing table. No index, no policy
-- change -- the row-level security on `subscriptions` is per-row and already
-- covers every column it will ever have -- and no row is written by this
-- migration. A deployment where nobody upgrades keeps three nulls.
--
-- Why this exists rather than being derived.
--
-- An upgrade is applied at Razorpay with `schedule_change_at: "cycle_end"`, so
-- between the click and the end of the billing period the subscription is
-- still ON the old plan and still being charged for it. That is correct and
-- deliberate -- nobody is charged twice for a period and nobody is owed a part
-- period back, which is what section 6 of the Terms commits to.
--
-- But it leaves a gap this application could not express. `planId` is what the
-- account is entitled to, and it must keep saying "pro" until the cycle turns.
-- Nothing else on the row could say "and it becomes intelligent on the 11th".
-- The first version of the plan-change code reused `providerPlanId` as that
-- marker, which does not work: syncFromProvider reads the subscription back
-- from Razorpay, and a scheduled change does not move Razorpay's own
-- `plan_id`, so the next sync wrote the old provider plan id back over it and
-- the pending upgrade vanished from the database with nothing to notice.
--
-- So it is written down. `planId` answers "what do I have", these answer "what
-- have I asked for, and when does it arrive", and the two are never confused
-- for each other. They are cleared by syncFromProvider when `planId` catches
-- up, which is the one place that may write either.
BEGIN;

ALTER TABLE public.subscriptions
  -- Our own plan id, from data/pricing.js -- never the provider's, exactly as
  -- `planId` beside it. Null means no change is scheduled.
  ADD COLUMN "scheduledPlanId"   TEXT,
  -- The interval the new plan will be billed at. An upgrade may change both
  -- at once (Pro monthly to Intelligent yearly), so the period cannot be
  -- assumed to be the one in `interval`.
  ADD COLUMN "scheduledInterval" "BillingInterval",
  -- When it takes effect: the end of the period that has been paid for, which
  -- is `currentEnd` at the moment the change was requested. Recorded rather
  -- than read from `currentEnd` later, because `currentEnd` moves on every
  -- renewal and this must not.
  ADD COLUMN "scheduledChangeAt" TIMESTAMP(3);

COMMIT;
