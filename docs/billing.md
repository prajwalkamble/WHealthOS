# Billing

**Status: CURRENT**, with one deliberate exception stated in
[What is not switched on](#what-is-not-switched-on).

Razorpay **Subscriptions**, not one-off orders. A subscription bills against a
Plan object that lives in Razorpay's dashboard and holds the amount and the
interval, which is why there are four plan ids in the environment and why a
missing one makes that tier unbuyable rather than billable at a guess.

## The flow

```
/pricing                 compare plans. Opens no payment window.
   │  link, carrying ?plan= and ?duration=
   ▼
/billing?plan=pro&duration=monthly
   │  server resolves the price, the benefits and the account's state
   │  POST /api/billing/checkout   → writes a CheckoutAttempt, then asks
   │                                 Razorpay for a subscription
   ▼
Razorpay Checkout (their modal, their script, their form)
   │  callback: payment id, subscription id, signature
   │  POST /api/billing/verify     → checks the signature, checks ownership,
   │                                 then asks Razorpay what is true
   ▼
/billing/success         reads the database. Polls while it is confirming.

POST /api/webhooks/razorpay        the authoritative path. Arrives whether or
                                   not the browser is still open, and is what
                                   actually establishes the subscription.
```

A signed-out visitor is sent through Clerk by the middleware and returned to
the same `/billing` URL afterwards, so the plan survives signing in. Somebody
with no WHealthOS account yet goes to `/welcome?next=/billing?...` and comes
back to the same place.

## Routes

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/pricing` | GET | public | Compares plans. Links to `/billing`. |
| `/billing` | GET | session | Reviews one plan and opens checkout. |
| `/billing/success` | GET | session | What the account actually says, now. |
| `/api/billing/checkout` | POST | session | Opens or resumes a subscription. |
| `/api/billing/verify` | POST | session | Verifies the browser's callback. |
| `/api/billing/subscription` | GET | session | This account's plan. Polled. |
| `/api/billing/cancel` | POST | session | Stops at the end of the period. |
| `/api/webhooks/razorpay` | POST | signature | Lifecycle events. |

Every `/api/billing/*` route is rate limited (the `payment` bucket in
`lib/arcjet.js`; reads use `write`), caps its body at 1 KiB, and resolves the
account from the verified Clerk session. None of them reads an amount, a
currency, a Razorpay plan id, an owner or a status from the request.

The webhook is deliberately under `/api/webhooks/`, which the Arcjet
middleware excludes. `detectBot` runs LIVE in production and does not allow
Razorpay, so a billing webhook anywhere else would have every delivery
blocked — silently, and in production only.

## Where the money is decided

`lib/billing/plans.js` is the only place a price exists. It derives every
amount from `data/pricing.js`, which is also what the pricing table renders,
so the figure somebody is shown and the figure they are charged cannot drift:
`tests/billing-plans.test.js` fails if they do.

The browser sends a plan id and an interval. That is all it can send.

```
pro          monthly  ₹399     yearly  ₹3,830
intelligent  monthly  ₹699     yearly  ₹6,710
```

Yearly is twelve months less the 20% in `YEARLY_DISCOUNT`. The Razorpay Plan
must be created at the same figure — the amount charged lives on *their*
object, so if the two disagree, their number wins and ours is a lie on a
screen. `scripts/development/razorpay-plans.mjs --dry-run` prints what it
expects to find.

No tax is calculated anywhere. `TAX_POLICY` in `lib/billing/plans.js` says so
in one place, and the review page renders it rather than asserting it in
prose.

## Idempotency, and the orphan problem

Razorpay's subscriptions API has **no idempotency key**. A create call that
times out is indistinguishable, from here, from one that failed — and the
retry that follows would open a second subscription against the same person.

So a `CheckoutAttempt` row is written **before** Razorpay is called, carrying
a unique id that is sent along in the subscription's `notes`. Four layers
follow from that:

1. **One attempt per account**, enforced by a partial unique index on
   `checkout_attempts(userId) WHERE status IN ('OPEN','CREATED')`. Two clicks,
   two tabs or a client retry race there, and exactly one wins. A disabled
   button is not a concurrency control.
2. **Resume, don't re-open.** A second request for the same plan is handed the
   *same* subscription id, so reopening a dismissed payment window cannot
   charge anybody twice.
3. **Reconciliation.** An attempt with no subscription id means the create
   call never answered. Before trying again, the service lists the
   subscriptions created around that attempt and looks for one whose notes
   carry its id. If it finds one, it adopts it (`BILLING_ORPHAN_ADOPTED` in
   the logs). Only if it finds none does it create another.
4. **One live subscription per account**, by the same kind of index on
   `subscriptions`.

An attempt expires after 30 minutes, and is closed the moment the
subscription behind it reaches any state beyond `created`/`authenticated`.
That last part matters more than it looks: the webhook is the path that always
runs, so closing the attempt from the browser callback alone would leave
anybody who closed their tab unable to start another checkout, ever.

## What establishes access

Nothing in the browser. Access follows from a `subscriptions` row, and that
row is only ever written from a fresh `subscriptions.fetch()` against
Razorpay — never from a webhook payload, never from the checkout callback.
Two consequences worth stating:

- **Out-of-order and replayed webhooks are harmless.** An event is a prompt to
  ask, not an answer. Whatever order the prompts arrive in, the answer written
  is the current one.
- **A valid signature is not an active subscription.** `confirmCheckout`
  returns `active: false` when Razorpay still says `created`, and the
  confirmation page says "we are confirming this" rather than celebrating.

### Status mapping

| Razorpay | WHealthOS | Access |
|---|---|---|
| `created`, `authenticated` | `PENDING` | none — never charged |
| `active` | `ACTIVE` | yes |
| `active` + `cancel_at_cycle_end` | `CANCEL_SCHEDULED` | until `currentEnd` |
| `pending`, `halted` | `PAST_DUE` | only within the period already paid |
| `cancelled` | `CANCELLED` | only within the period already paid |
| `completed`, `expired` | `COMPLETED`, `EXPIRED` | as above (none, for `expired`) |
| `paused` | `PAUSED` | none |
| anything else | — | none, and logged |

One rule throughout: **you get what you paid for, and nothing beyond it.**
There is no grace period, because nobody has written a grace policy down.

### Entitlements

`lib/billing/entitlements.js` maps a plan to capability keys, and the keys
live on the features in `data/pricing.js` — the same table the pricing page
renders. Inheritance is by construction: a plan's entitlements are the union
of every plan at or below its rank, so Free ⊂ Pro ⊂ Intelligent cannot be got
wrong by editing one list and not another.

Checks run on the server, in server actions and route handlers, not in the UI.

## Cancellation and plan changes

Cancellation is always **at the end of the period already paid for**. Nothing
cancels immediately and nothing is refunded automatically: taking access away
from somebody who has paid for the rest of the month would need a refund
policy, and there is not one.

Plan changes are `schedule_change_at: "cycle_end"` for both directions, up and
down. **No proration is calculated.** Our row keeps the old plan until a
webhook confirms the new one is running, so nobody gets Intelligent features
for a month that was billed at the Pro rate. Changes are made from Settings;
`/billing` refuses to sell a second subscription and points there.

## Configuration

| Variable | Where it comes from |
|---|---|
| `RAZORPAY_KEY_ID` | Dashboard → Account & Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | shown once, when the key pair is generated |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | the same value as `RAZORPAY_KEY_ID` |
| `RAZORPAY_PLAN_PRO_MONTHLY` | Dashboard → Subscriptions → Plans |
| `RAZORPAY_PLAN_PRO_YEARLY` | ditto |
| `RAZORPAY_PLAN_INTELLIGENT_MONTHLY` | ditto |
| `RAZORPAY_PLAN_INTELLIGENT_YEARLY` | ditto |
| `RAZORPAY_WEBHOOK_SECRET` | typed in when the webhook is created |
| `BILLING_ENFORCEMENT` | `"on"` to enforce plans. Default: off |

`apps/web/.env.example` carries the same list with the reasoning beside each
one. Three things that are easy to get wrong:

- `NEXT_PUBLIC_RAZORPAY_KEY_ID` is **inlined at build time**. Changing it
  means restarting the dev server, or redeploying.
- The webhook secret is **not** the API key secret. Signing a webhook check
  with the API secret rejects every genuine delivery.
- Test and live credentials must not be mixed. The mode is read from the key
  id's own prefix, so there is no mode variable to set wrongly — but a test
  key id with live plan ids is a deployment that cannot work.

A deployment missing any of this does not crash: `lib/billing/availability.js`
answers one question — can this deployment sell, and what is missing — and
every surface that offers to sell something reads it. Buttons render disabled,
`/billing` says the plan is not available yet, the endpoints answer 503, and
the missing variable names appear on screen outside production only.

### Payment methods

Razorpay Subscriptions accepts three mandate methods: cards, UPI Autopay and
emandate (netbanking). Which of them the modal offers is Razorpay's decision,
not this application's -- `components/billing/use-checkout.js` passes no
`method` filter and no `config.display` blocks, so the modal shows whatever
the merchant account has enabled. Razorpay answers that question on its
`standard_checkout/preferences` call, which means a 401 there is not a missing
method but a rejected key, with no method list fetched at all.

To offer UPI, enable **UPI Autopay** for subscriptions on the account
(Dashboard -> Settings -> Payment Methods; on many accounts it has to be
requested through support first). Two constraints come with it:

- **A ₹15,000 cap per mandate** by default, raised to ₹1,00,000 only for
  certain merchant categories. Every plan here is far below that, so it only
  starts to matter if a price rises above it.
- **The UPI Intent flow is enabled separately.** Without it the payer types a
  VPA (Collect) instead of being handed off to their UPI app. Intent is not
  supported for `@okaxis` handles either way.

No code changes when a method is enabled or disabled. The lifecycle is driven
by `subscription.*` events, and those say nothing about how the mandate was
authorised.

### Setting up a webhook

Dashboard → Settings → Webhooks → Add New Webhook.

- URL: `https://<your-domain>/api/webhooks/razorpay`
- Secret: anything long and random; put the same value in
  `RAZORPAY_WEBHOOK_SECRET`
- Events: the eleven `subscription.*` events in `HANDLED_EVENTS`
  (`lib/billing/webhook.js`)

An unknown event type is recorded and ignored rather than failing, so
subscribing to more than that list is harmless.

For local development Razorpay cannot reach `localhost`. Either expose the
port with a tunnel and point a second test-mode webhook at it, or exercise the
lifecycle through `tests/billing-integration.test.js`, which drives the same
`processEvent` the route calls.

## Running the tests

```sh
pnpm test                       # everything
pnpm --filter @whealthos/web vitest run tests/billing-integration.test.js
```

The integration suite needs a database and is skipped without one. A
disposable local Postgres, exactly as `apps/web/vitest.config.mjs` documents:

```sh
docker run -d --name whealth-test-db -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_DB=whealth_test -p 55432:5432 postgres:17-alpine
# then apply migrations and database/prisma/rls-bootstrap.sql, and write
# apps/web/.env.test pointing at it
```

No test reaches Razorpay. `__setClient()` installs a fake, so the suite
consumes no API calls and makes no charges — including the reconciliation
path, which is driven by a fake orphan rather than a real one.

| Suite | What it holds |
|---|---|
| `billing-plans.test.js` | the server charges what the page shows |
| `billing-catalog.test.js` | the review page's catalogue entry, and what is kept from the browser |
| `billing-signatures.test.js` | subscription vs order formulas, webhook signatures, timing |
| `billing-status.test.js` | the status table above, including the absence of a grace period |
| `billing-availability.test.js` | what an unconfigured deployment says |
| `checkout-url.test.js` | URL validation, open redirects, one place can charge |
| `billing-checkout.test.js` | the review page's states, copy and accessibility |
| `billing-integration.test.js` | all of it, against a real database |
| `entitlements.test.js` | the tier ladder, and that no feature lacks a key |

## Troubleshooting

**"Payments are not available just now."** A configuration failure, not a
payment one. The server log carries `RAZORPAY_NOT_CONFIGURED` with the exact
variable; outside production the response does too. The most common cause is
`NEXT_PUBLIC_RAZORPAY_KEY_ID` being unset, which the browser catches before
the server is ever asked.

**A payment went through and the plan did not change.** The webhook has not
arrived or is failing. Look at `billing_events`: a row with `status = 'FAILED'`
was received and could not be applied (Razorpay will retry for days); no row
at all means no delivery arrived, so check the webhook's URL and that its
secret matches. The confirmation page keeps saying "confirming" for about two
minutes and then explains this, rather than spinning forever.

**Duplicate events.** Expected, and handled: the unique `providerEventId` makes
the second insert lose and the delivery is answered 200 without being applied
twice. `processEvent` returns `{ applied: false, reason: "duplicate" }`.

**An orphaned subscription at Razorpay.** Search the logs for
`BILLING_ORPHAN_ADOPTED`. An orphan that was never adopted is a `created`
subscription that was never authorised; it costs nothing and expires on its own.

**`BILLING_SUBSCRIPTION_NOT_RECORDED`.** Razorpay confirmed a subscription the
one-live-per-user index refused to record, which happens if an abandoned
attempt is paid after a newer one succeeded. The subscription that landed
first is the one the account keeps; the other needs cancelling by hand.

## Usage quotas

One metered figure is sold: **transactions added per day** — Free 5, Pro 15,
Intelligent uncapped. `data/pricing.js` has advertised it since the pricing
page shipped and nothing applied it. `lib/billing/quota.js` does.

It is enforced inside the same database transaction as the insert it guards,
in `createTransaction`:

```
pg_advisory_xact_lock(user)   serialises concurrent creates for one account
count today's rows            in APP_TIME_ZONE, via dayWindowBounds(1)
refuse or continue            a refusal rolls the whole transaction back
```

The lock is the part that matters. Counting alone is not atomic: under READ
COMMITTED two requests arriving together cannot see each other's uncommitted
insert, so both read "4 used", both insert, and the day ends with 6. Because
the count and the insert share one transaction, a refusal needs nothing undone
and a failed insert gives the slot back by itself.

Counting rows rather than keeping a tally means the figure is "how many exist
today": deleting a transaction frees its slot, and the window resets at
midnight with nothing scheduled.

The number lives twice in `data/pricing.js` — `limit` is the string the table
prints, `dailyTransactions` the number the server enforces — because parsing a
number back out of marketing copy would let a reworded cell silently change
what people may do. `tests/usage-quota.test.js` asserts the two still agree.

**`BILLING_QUOTA_ENFORCEMENT` is off, and it is not a deployment toggle.**
Applying the cap would make two things false at once: the Terms say nothing
about a daily limit (`tests/legal-consistency.test.js` asserts the rendered
document contains no such wording), and section 6 promises notice before a
free feature is moved behind a plan. Switching it on means rewriting section
6, bumping `TERMS` in `lib/legal/versions.js` and giving that notice first,
then setting `perDayTransactionLimitEnforced: true`. A tripwire test fails the
build if the flag is set while those are outstanding.

While it is off the count still runs and every refusal logs
`QUOTA_WOULD_DENY`, so the real shape of the cap is visible before anybody is
held to it.

## Is the matrix actually enforced?

`tests/entitlements.test.js` proves the engine answers correctly.
`tests/entitlement-coverage.test.js` asks the question a correct engine cannot
answer about itself: **is it called?** It scans `actions/`, `app/`,
`components/` and `lib/` for gate calls and fails if a paid feature has none.

Nine paid features had none. Closed since:

| Feature | Where it is now gated |
|---|---|
| `appearance.customize` | `actions/preferences.js`, per setting |
| `dashboard.customize` | `actions/preferences.js`, per setting |
| `ai.insights` | `lib/inngest/functions.js`, before the model call |

Customisation is gated **per setting and only on the ones changing**, not on
the action. One action saves all ten settings and one of them — the light/dark
switch, `theme.toggle` — is on the Free plan, so refusing the action outright
would take a free feature away. `SETTING_ENTITLEMENTS` in `lib/preferences.js`
says which side of the paywall each control is on, and the diff is against
what is stored, so an account that set a paid option while enforcement was off
keeps it.

The monthly report was the one a route guard could never have covered: a
background job has no session, so a Free account that left the Settings switch
on was emailed an Intelligent feature every month and we paid the model for
it. Not entitled is now a skip, not a failure — the report still goes out with
the figures, the same path a model outage already takes.

The remaining paid features have nothing to gate, and the test holds that list
exactly so a new surface cannot quietly join it:

- **`currency.multi` is advertised and not built.** Every currency column in
  the schema is `String @default("INR")`, no action or route sets one, and the
  PDF exporter states that no conversion is applied. Reported rather than
  gated — gating something that does not exist would hide it.
- **`support.priority`** is a support commitment answered by people.
- **`ai.spending`, `ai.summaries`, `ai.budgeting`, `ai.recommendations`** are
  facets of the assistant and the monthly report. There are exactly three ways
  to reach a model: `/api/ai/chat` (gated on `ai.queries`), the monthly report
  (gated on `ai.insights`), and receipt scanning, which the pricing table does
  not sell.

## What is not switched on

**`BILLING_ENFORCEMENT`** governs which features a plan includes. The Terms
were rewritten on 2026-11-01 to describe enforced plans and
`lib/legal/terms.js` records that (`paidPlansAvailable: true`,
`checkoutIntegratedButSellsNothing: false`), so the deployment is expected to
set it. `tests/legal-consistency.test.js` fails the build if the two disagree
in either direction.

While it is off, every check still runs and logs `ENTITLEMENT_WOULD_DENY`
instead of refusing — including every gate added since — so the gaps are
visible before they bite.

## The confirmation email

Every subscription that activates produces exactly one confirmation email.

```
syncFromProvider (the only writer of subscription status)
      |  status became ACTIVE or CANCEL_SCHEDULED
      v
queueActivationNotification          lib/notifications/subscription-activated.js
      |  INSERT subscription_notifications  (unique idempotencyKey)
      v
inngest.send("subscription.confirmation.send")
      v
sendSubscriptionConfirmation         lib/inngest/functions.js
      v
deliverActivation                    lib/notifications/deliver.js
      |  builds the model from the database, not from the event
      v
sendEmail                            lib/email/send.js  (the only Resend client)
      v
Resend  --email.delivered / bounced / complained-->  /api/webhooks/resend
```

**Why it is queued rather than sent inline.** The email is the only part of
activating a subscription that depends on a third party. Writing the
intention down first means a crash, a deploy, or an hour of Resend being
down between "payment verified" and "email sent" loses nothing — and it
means the subscriber gets access the moment the subscription is active,
without waiting on an SMTP conversation.

**What makes it exactly one.** `subscription_notifications.idempotencyKey` is
`<subscriptionId>:SUBSCRIPTION_ACTIVATED`, and it is unique. Every path that
could queue one — a redelivered webhook, the browser callback racing the
webhook, a status poll, the sweep — computes the same string, and Postgres
refuses the second. Nothing counts rows in application code, because that
check cannot be made safe under concurrency.

**What makes it reliable.** An hourly sweep
(`sweepSubscriptionNotifications`) covers both gaps the happy path leaves:

- a subscription that grants access with **no notification row at all** — the
  process died between saving the provider's state and recording the
  intention;
- a row that has sat **QUEUED** for more than ten minutes — the
  `inngest.send` never landed.

The migration backfills a `SKIPPED` row for every subscription that was
already live when it ran. Without that, the first sweep after deployment
would email everyone who had already subscribed to say their subscription is
now active.

**Queued, accepted, delivered are different facts.** `lib/email/send.js`
returns success when Resend *accepts* a message; that is not evidence anyone
received it. So the status is `ACCEPTED`, not `SENT`, and only
`/api/webhooks/resend` — reading Resend's `email.delivered`, `email.bounced`
and `email.complained` events — moves it to `DELIVERED`, `BOUNCED` or
`COMPLAINED`. Statuses only move forward: provider webhooks arrive out of
order and are retried for days.

`email.opened` and `email.clicked` are acknowledged and deliberately not
recorded. Both need a tracking pixel or a rewritten link, both are personal
data about when somebody read their mail, and neither says anything about
delivery.

**Retries.** Five attempts with Inngest's exponential backoff. A failure that
retrying cannot fix — a missing API key, an unconfigured sender, an address
Resend rejects as invalid — is terminal on the first attempt. Anything else,
including `application_error`, `internal_server_error`, `rate_limit_exceeded`
and anything unrecognised, is treated as transient: the cost of being wrong
that way is five attempts and then the same `FAILED` row a few hours later,
and the cost of being wrong the other way is a lost confirmation for a
subscription somebody paid for.

**What it does not do.** A renewal does not send one. A renewal is another
`subscription.charged` on a subscription that is already `ACTIVE`, so there
is no transition, and the idempotency key would refuse one anyway. Renewal,
cancellation, payment-failure and refund emails are deliberately not
implemented — `NotificationEvent` exists so that adding one is a new enum
member and a new template rather than a second notification system.

### Testing it

Locally, with the test database up:

```sh
pnpm --filter @whealthos/web exec vitest run tests/subscription-email.test.js
pnpm --filter @whealthos/web exec vitest run tests/notification-integration.test.js
```

Neither sends mail: `resend` is mocked in both, and the integration suite
also mocks the Inngest client so nothing reaches the job runner.

To see the email itself, `pnpm email` runs the react-email preview server
over `apps/web/emails/`.

Against a real deployment, the honest check is end to end: take a Razorpay
test-mode subscription through checkout, then look at the row.

```sh
psql "$DIRECT_URL" -c "
  SELECT status, \"recipientEmail\", \"providerMessageId\", attempts, \"lastError\"
  FROM subscription_notifications ORDER BY \"createdAt\" DESC LIMIT 5;"
```

`QUEUED` means the job runner has not picked it up — see the Inngest
dashboard. `ACCEPTED` means Resend took it. `DELIVERED` means Resend's
webhook said it arrived, which requires `RESEND_WEBHOOK_SECRET` to be set and
the `email.delivered` event to be subscribed in the Resend dashboard;
without those the status stays `ACCEPTED` and that is not a bug, it is the
absence of evidence.

## Known limitations

- **The confirmation email lists a feature that does not work.** The email
  builds its "what your plan adds" section from `FEATURE_GROUPS`, which is
  the right source — it is what the pricing page showed the customer before
  they paid. But that table includes `currency.multi`, and multi-currency is
  advertised and not implemented: every currency column is
  `String @default("INR")` and nothing sets one. So a Pro confirmation
  promises it a second time, after the money has moved. Suppressing it in the
  email alone would hide the problem rather than fix it; the fix is to build
  the feature or stop selling it.
- **Delivery status needs the Resend webhook configured.** Without
  `RESEND_WEBHOOK_SECRET` set and the `email.delivered` / `email.bounced`
  events subscribed in the Resend dashboard, notifications stop at
  `ACCEPTED`. That is accurate — nothing has told us the message arrived —
  but it means a bounced confirmation is invisible until somebody complains.
- **No background reconciliation** of subscription *state*. The notification
  outbox sweeps itself hourly, but nothing sweeps for subscriptions whose
  state has drifted. Reconciliation happens on demand: when a checkout is
  retried, when a webhook arrives, and when the confirmation page polls. A
  payment whose webhook never arrives at all needs a human.
- **Refunds and disputes are not modelled.** `PaymentStatus` has a `REFUNDED`
  value and nothing sets it; `payment.dispute.*` events are recorded and
  ignored. A refund is issued from Razorpay's dashboard and reconciled by
  hand, deliberately — automatic irreversible billing actions are not
  something this implements.
- **Proration is not calculated**, in either direction.
- **One subscription per account.** There are no workspaces, teams, seats,
  memberships or roles in this product: the Prisma schema has no such model,
  and tenant isolation is per user, enforced by RLS on `app.tenant_id`. So
  billing is per account, and there is no membership or billing-permission
  model to enforce. Any requirement written against workspace-scoped
  subscriptions or an OWNER/ADMIN/EDITOR/VIEWER hierarchy does not map onto
  this product as it stands.
- **Razorpay cannot reach a local machine**, so the webhook cannot be
  exercised end to end from `localhost` without a tunnel.
- **A slow UPI approval can outlast the confirmation page.** The poller stops
  after roughly four minutes (`BACKOFF` in
  `app/(checkout)/billing/success/_components/confirmation-poller.jsx`). A
  mandate approved after that still lands -- the webhook establishes it and
  the page says so on the next load -- but the payer will have seen the "still
  not confirmed" panel first.
- **An abandoned attempt's provider subscription is not cancelled.** It is
  left to expire. If somebody pays it from a stale tab afterwards, the webhook
  records it and they get what they paid for.
