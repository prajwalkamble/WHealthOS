-- A second notification event: a subscription's plan changed.
--
-- Additive, and the smallest possible change -- one enum member. No table is
-- altered, no row is written, no index is touched, and a deployment that never
-- sees a plan change behaves exactly as it did before this ran.
--
-- Why it is needed rather than reusing SUBSCRIPTION_ACTIVATED: the outbox's
-- idempotency key is "<subscriptionId>:<event>" and a plan change happens on a
-- subscription row whose activation key was spent the day it was confirmed.
-- Reusing the event would make recordOwed() return created:false and the email
-- would simply never be sent -- silently, and looking exactly like success.
-- This is the extension point lib/notifications/outbox.js describes in its own
-- header: "a new enum member and a new template rather than a second
-- notification system".
--
-- Why a plan change needs an email at all: it is the one subscription event a
-- person cannot see coming. An upgrade scheduled today takes effect at the end
-- of the billing cycle, which may be weeks away, and the charge that lands
-- then is at a price they agreed to in a different month.
BEGIN;

-- IF NOT EXISTS so re-running this on a database that already has the value is
-- a no-op rather than an error. Postgres 12+ allows ADD VALUE inside a
-- transaction provided the new value is not itself used in the same
-- transaction, and nothing here uses it.
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PLAN_CHANGED';

COMMIT;
