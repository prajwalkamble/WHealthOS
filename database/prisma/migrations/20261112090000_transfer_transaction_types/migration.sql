-- Two new transaction types: the legs of an internal transfer.
--
-- Its own migration, ahead of the one that creates the transfers table, for a
-- Postgres reason rather than a tidiness one. Postgres 12+ allows
-- ALTER TYPE ... ADD VALUE inside a transaction block, but the new value may
-- not be USED in that same transaction -- and the next migration needs to use
-- both of these, by name, in a CHECK constraint that is the thing making a
-- transfer leg unforgeable. Splitting the two is what lets that constraint
-- exist at all.
--
-- Why new enum members rather than a boolean on an income/expense row:
--
-- Roughly eight places aggregate money by filtering the type explicitly --
-- `type: "INCOME"` in Prisma, `FILTER (WHERE type = 'INCOME')` in raw SQL --
-- and a type they do not name is excluded from income and from expenses
-- automatically. Had a transfer been an INCOME row carrying a flag, every one
-- of those would have silently counted it, and the landing page's published
-- "average saved" statistic among them. The remaining places split the type
-- as a binary (`type === "INCOME" ? income : expenses`); those are being
-- corrected one by one in the same change, and each has a test.
--
-- Nothing is written by this migration, and no existing row changes. A
-- deployment where nobody ever makes a transfer behaves exactly as before.
BEGIN;

-- IF NOT EXISTS so re-running against a database that already has them is a
-- no-op rather than an error.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';

COMMIT;
