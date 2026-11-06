<!-- STATUS: PARTIAL. One script. -->

# scripts / development

> **Status: PARTIAL.** Local development helpers. One script so far;
> everything else here is still planned.

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
