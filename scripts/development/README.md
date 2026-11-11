<!-- STATUS: PARTIAL. Four scripts. -->

# scripts / development

> **Status: PARTIAL.** Local development helpers. Four scripts so far;
> everything else here is still planned. `fetch-rates.mjs` and
> `inngest-sync.mjs` carry their usage in their own header comments.

## razorpay-plans.mjs

Creates the four Razorpay Plans that subscriptions are billed against, and
prints the environment lines for them.

A Razorpay Plan holds the amount and the interval on Razorpay's side, so its
id cannot be derived or defaulted — the wrong id charges the wrong price. The
four ids are configuration. This reads the prices from `apps/web/data/pricing.js`,
the same catalogue the pricing page renders and the server charges from, so
nobody has to retype four figures into a form correctly.

```sh
# See what it would create. Calls nothing.
node --env-file=apps/web/.env scripts/development/razorpay-plans.mjs --dry-run

# Create them, and print the lines to paste into apps/web/.env
node --env-file=apps/web/.env scripts/development/razorpay-plans.mjs
```

Before the keys are in `.env`:

```sh
RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=yyy \
  node scripts/development/razorpay-plans.mjs
```

Safe to run twice. It reuses what is already there, in two ways: a plan id
already set in the environment is checked and kept, and otherwise it matches
on the notes it writes rather than on the name, so a plan renamed in the
Dashboard is still recognised.

The first of those matters more than it sounds. A plan created **by hand** in
the Dashboard carries none of this script's notes, so without checking the
environment first it would not be recognised — and the script would create a
second plan at the same price and print a variable pointing at the new one.
Four duplicates on a live merchant account is not a mistake worth leaving
available.

It warns rather than acting in two cases: an existing plan's amount no longer
matches the catalogue (Razorpay plans are immutable, so that needs a new plan
and a new id, not an edit), and a plan id set in the environment that this
account does not have — almost always test ids against live keys, or the
reverse.

The mode comes from the key prefix: `rzp_test_` creates test plans and
charges nothing, `rzp_live_` creates live ones.

## seed-dev-account.mjs

Fills the development account -- the one the feature override designates --
with six months of plausible financial history.

The override grants every entitlement to one account, and that account was
created to test with, so it starts with nothing in it. Budgets, Goals,
Analytics and the AI surfaces then render unlocked and completely empty,
which is indistinguishable from a feature that does not work. This gives them
something to render: two accounts, ~195 transactions across six months and
fourteen categories, an overall budget plus six per-category ones, five goals
in three states with their contributions, and four cards.

```sh
# See the plan. Writes nothing, and rolls its transaction back.
node --env-file=apps/web/.env scripts/development/seed-dev-account.mjs --dry-run

# Write it.
node --env-file=apps/web/.env scripts/development/seed-dev-account.mjs

# Replace what a previous run wrote.
node --env-file=apps/web/.env scripts/development/seed-dev-account.mjs --replace
```

Deterministic: a fixed generator seed, so the figures are the same on every
run and a number you noted yesterday still means something today.

**It cannot be pointed at another account.** There is no account argument. The
target is `DEV_FEATURE_OVERRIDE_USER_ID`, it refuses to start unless
`devOverrideEnabled()` agrees -- the same four conditions that gate the
override itself, including *not on Vercel* -- and it then checks that the id
and `DEV_FEATURE_OVERRIDE_EMAIL` name the same row before writing anything.
It connects through `DATABASE_URL`, the role that row-level security applies
to, with `app.tenant_id` set to that one id; every isolation policy carries an
explicit `WITH CHECK`, so the database itself rejects a row belonging to
anyone else.

It writes to `accounts`, `transactions`, `budgets`, `goals`,
`goal_contributions` and `cards`, and sets `displayCurrency` (a display
preference that rewrites no amount). It does not go near subscriptions,
payments, checkout attempts, billing events or legal consents. Without
`--replace` it refuses an account that already has data rather than doubling
it.

Two deliberate choices worth knowing about, both explained at more length in
the script:

- **One currency.** `lib/currency/presentation.js` is explicit that a single
  conversion scalar is valid only while the ledger holds one currency, and
  that the two-currency case cannot arise because no account can be given a
  currency through the UI -- so `presentationFor()` detects it and refuses,
  formatting every figure in whichever currency the query returns first. A
  hand-written USD account reaches that branch and an unconverted mixed total
  gets a `$` in front of it. So the seed stays in INR.
- **Only the latest instance of each fixed monthly cost is flagged
  recurring**, always with `nextRecurringDate` in the future. The
  `process-recurring-transactions` job picks up recurring rows whose next date
  has passed -- or whose next date and `lastProcessed` are both null -- so
  flagging every historical copy would have it quietly manufacture duplicates
  the first time it ran.
