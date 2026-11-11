# The development feature override

**Status:** in use since 2026-11-10 · **Scope:** local development only · **Code:** `apps/web/lib/billing/dev-override.js`

One named account gets every feature in `apps/web/data/pricing.js`, on a local
machine, without buying anything.

---

## 1. What it is for

Entitlement enforcement went live on 2026-11-10. Before that every account had
every feature, so any account could exercise any screen. Afterwards the
application has three tiers that actually differ, and the only account with a
paid plan is a real one with a real Razorpay subscription and real
transactions in it.

That leaves no way to test the paid surfaces that does not involve either
paying again or editing the subscriptions table — and editing it to make a
test pass is precisely the thing the subscription audit forbids, because the
table is the record of what the payment provider believes.

So the override exists to answer one question: *does this paid screen work?*
It does not answer *is this account entitled?* — that answer stays exactly as
the database says.

**What it grants:** feature eligibility, for one account, on a machine that is
not a deployment.

**What it does not do:** it creates no subscription, modifies none, charges
nothing, writes nothing at all. No code path from it reaches Razorpay, the
`subscriptions` table, `checkout_attempts`, `billing_events` or the
subscription-notification queue. It does not change the account's plan, and
every screen that reports a plan goes on reporting the real one.

---

## 2. Configuring it

Three variables, in `apps/web/.env` — which is gitignored, and which Vercel
does not read.

```env
DEV_FEATURE_OVERRIDE="on"
DEV_FEATURE_OVERRIDE_USER_ID="<internal users.id, a uuid>"
DEV_FEATURE_OVERRIDE_EMAIL="<the address that id belongs to>"
```

`.env.example` carries placeholders and nothing else. Do not put real values
there, and do not add these to Vercel: see §8.

Find the id from the database rather than from a sign-in screen:

```sql
select id, clerk_user_id, email from users where email = 'you@example.com';
```

Restart the server afterwards. These are read at request time, but Next
caches the module graph; a restart is the reliable way to pick up a change,
and the boot log in §7 is how you confirm it.

### The account currently configured

| | |
|---|---|
| Address | `pr*********3@gmail.com` |
| Internal id | `f2…` |
| Clerk id | `user_3K…` |
| Plan | **Free** — no subscription has ever existed on it |
| Verified | 2026-11-10, by exact lookup in `users`, against both the normalised address and the stored one |

Masked deliberately, and masked down to a stub rather than a recognisable
prefix: this file IS committed, and `apps/web/.env` is not. An earlier revision
showed the first eight hex characters of the internal id beside a fully masked
address, under a sentence claiming the full values were "nowhere a commit can
reach" -- which stopped being true the moment this document was committed. Two
characters is enough to confirm at a glance that the right account is
configured, which is the only thing this table is for.

The full values live in `apps/web/.env`, which `.gitignore` excludes, and the
regression tests use synthetic ids for the same reason. Knowing the id grants
nothing by itself in any case: it is one of four conditions, and the other
three are all local configuration that cannot be set on a deployment.

---

## 3. How the account is identified

**By immutable internal user id, and by nothing else.**

`users.id` is a uuid the application assigns. It reaches the gate through
`getCurrentUserId()`, which derives it server-side from the verified Clerk
session via `withCurrentTenant()`. Nothing a browser sends participates: not a
request body, not a query parameter, not a header, not a cookie, not
`localStorage`. There is no endpoint that accepts an email address and returns
access, and no part of the override reads one from a request.

**The configured address is required but is not the authorisation.** Both
halves of that are deliberate:

- *Required*, because a half-written configuration should do nothing rather
  than something. An id with no address beside it is an opaque uuid that
  nobody reading `.env` can check. Absent or malformed, and the override is
  **off** — see `devOverrideEnabled()`.
- *Not the authorisation*, because deriving the id from an address would mean
  an email lookup at all 20 server-side gates, on every request, forever, to
  recover what the id already settles. The binding is verified **once**, at
  configuration time, against the `users` table — recorded in §2 — and what
  runs per request is the id comparison alone.

It is a completeness check on the configuration, not a second factor. Stated
plainly here so nobody reads more security into it than it has.

---

## 4. What is unlocked

Every key in `FEATURE_GROUPS` — all 21 as of 2026-11-10, derived from the
published table rather than listed again here, so this document cannot fall
behind it.

| Category | Keys | Under the override |
|---|---|---|
| Free | `dashboard.basic`, `transactions.manage`, `accounts`, `cards`, `overview.basic` | unlocked (already were) |
| Pro | `budgets`, `goals`, `analytics`, `currency.multi`, `data.export`, `theme.toggle`, `dashboard.customize`, `appearance.customize` | unlocked |
| Intelligent | `ai.receipts`, `ai.insights`, `ai.spending`, `ai.summaries`, `ai.queries`, `ai.budgeting`, `ai.recommendations`, `support.priority` | unlocked |

In the interface that means: Budgets, Goals and Analytics render instead of
showing the locked card; the Appearance card's nine paid settings save; the
export route answers; the receipt scanner is offered on
`/transaction/create` and accepts a scan; and the WHOS assistant is mounted
and answers.

**Features needing external credentials still need them.** The override
removes an entitlement check, not a missing API key. Without `GEMINI_API_KEY`
the AI features fail the way they fail for anybody — the override does not
make them work, it makes them reachable.

**And an unlocked screen with no data in it looks exactly like a broken one.**
The designated account was created to test with, so it has no history of its
own: Budgets, Goals and Analytics render unlocked and completely empty, and
the AI features have nothing to say about nothing.
`scripts/development/seed-dev-account.mjs` fills it with six months of
plausible figures — it takes no account argument, refuses to run unless this
override is enabled, and touches no billing table. See
`scripts/development/README.md`.

One thing the seed deliberately does **not** cover: `currency.multi` is
unlocked by the override but has no reachable surface. No account can be
given a currency through the UI, and `lib/currency/presentation.js` says so
in as many words — it treats a two-currency ledger as a case that cannot
arise and refuses to convert when it sees one. Writing a second currency
straight into the database only reaches that refusal.

---

## 5. What stays enforced

Everything that is not an entitlement.

| Control | Status | Where |
|---|---|---|
| Clerk authentication | enforced | `middleware.js` |
| Protected-route check | enforced | `isProtectedRoute`, `middleware.js` |
| Arcjet rate limits and bot detection | enforced | `middleware.js`, and the token bucket on `scanReceipt` |
| Tenant isolation (RLS) | enforced | `withCurrentTenant()`, `app_current_tenant()` |
| Resource ownership | enforced | each action's own `where` clause |
| Subscription and payment records | **untouched** | nothing here writes |
| Per-day transaction cap | not applied to anyone | `BILLING_QUOTA_ENFORCEMENT` is off globally |

The override is applied **after** authentication and **inside** the tenant
transaction, so the configured account still cannot read another account's
rows. That is worth testing rather than trusting, and it is: see §9.

On quotas, to be exact rather than reassuring — the override does not bypass
them, but neither does anything else, because `BILLING_QUOTA_ENFORCEMENT` is
off for every account. If it is ever switched on, the per-day cap becomes an
abuse control that this override should **not** touch, and `lib/billing/quota.js`
would need its own decision made deliberately. It has no `grantAll` today.

---

## 6. How the decision is made

Four conditions, all required, each failing closed:

```
not on Vercel  AND  flag is "on"  AND  address is well-formed  AND  id matches
```

Implemented as `devOverrideEnabled()` and `devGrantsAll(userId)`. Five call
sites consult it, and no sixth path exists:

| Call site | What it decides |
|---|---|
| `lib/billing/guard.js` | **the authorisation** — all 20 gated server operations |
| `components/billing/feature-gate.jsx` | every locked panel, padlock and notice in the UI |
| `app/(main)/layout.js` | whether the assistant widget is mounted |
| `app/(main)/transaction/create/page.jsx` | whether the receipt scanner is offered |
| `app/api/billing/subscription/route.js` | the advisory capability list sent to the browser |

Only the first is authorisation. The other four decide whether a control is
*offered*, which is a different question — but they have to agree with the
first, or the account sees a padlock over something the server will accept.
A structural test in `tests/dev-override.test.js` asserts that
`requireEntitlement` has exactly one caller and that it passes `grantAll`, so
a gate added later cannot quietly miss this.

**It is injected at the gate, never at plan resolution.** `requireEntitlement`
takes `grantAll` as an argument and `effectivePlanId()` is untouched. Had the
override produced a synthetic `"intelligent"` plan id instead, that id would
flow into `billingSummary()` and Settings would display a subscription that
does not exist. A test asserts `lib/billing/service.js` never mentions the
override.

---

## 7. Turning it off

Remove `DEV_FEATURE_OVERRIDE` from `apps/web/.env`, or set it to anything
other than `on`, and restart. The other two variables are inert without it.

You will want to do this to see what a real Free or Pro account sees, which
the override necessarily hides from you.

The boot log tells you where you stand. `reportDevOverrideState()` runs from
`instrumentation.js` on every start, in **every** environment — unlike
`reportMissingProductionConfig()`, which returns early outside production —
and reports:

| Code | Means |
|---|---|
| `DEV_OVERRIDE_ENABLED_ON_VERCEL` | the flag reached a deployment. Grants nothing; remove it from the project's environment variables |
| `DEV_OVERRIDE_ENABLED_WITHOUT_USER_ID` | flag on, no id — matches nobody, does nothing |
| `DEV_OVERRIDE_EMAIL_MISSING_OR_MALFORMED` | address absent or malformed, so the override is **disabled** |

Silence means either correctly configured or not configured. None of the three
is a vulnerability; all three are silent failures, which is why they are
logged. No detail line prints the configured id or address — the one exception
being a malformed address, quoted back because a typo you cannot see is a typo
you cannot fix, and a malformed address is by definition not an account.

---

## 8. Why it cannot operate in production

`devOverrideEnabled()` requires `process.env.VERCEL` to be **absent**.
Vercel sets it in Production, in Preview and during the build; nothing else
sets it. So one condition covers "never in production" and "never in Preview"
with no list of environment names to keep correct, and Preview cannot inherit
the override however the project is configured.

**`NODE_ENV` is deliberately not used.** A local `pnpm build && next start`
runs with `NODE_ENV=production`, so keying off it would switch the override
off in exactly the configuration a change is verified in before it ships —
and whoever hit that would "fix" it by loosening the environment check. The
thing being asked is "is this a deployment?", and `VERCEL` is the variable
that answers it.

There is a second, independent barrier. These variables live in
`apps/web/.env`, which is gitignored, and Vercel does not read that file —
established while auditing the enforcement switch, where it is also why
`next start` picks up variables that a deployment does not. Configuration
would have to be pasted into the Vercel dashboard by hand for the question to
arise at all, and if somebody does that, §7's first code says so at boot.

Client-side tampering changes nothing, by construction:

- The variables are not `NEXT_PUBLIC_`, so they are not in any browser bundle.
  A test asserts no `NEXT_PUBLIC_DEV_FEATURE*` name exists.
- The two components that display the indicator receive a **boolean prop**
  decided on the server. Setting it in devtools draws a badge and unlocks
  nothing.
- Browser storage is not consulted. Request payloads are not consulted.
- Editing a response from `/api/billing/subscription` changes a browser's
  idea of what to draw. Every gated operation re-checks on the server through
  `guard.js`, which reads the session and the database.

There is no production backdoor here, and no environment variable that creates
one: a deployment with all three set to the correct values still refuses,
because the first condition fails.

---

## 9. Testing it

```sh
cd apps/web && npx vitest run tests/dev-override.test.js tests/security-config.test.js
```

`tests/dev-override.test.js` covers the access rule (the configured account;
another account; all four Vercel environments; the flag off, misspelled, or
set to `true`; a blank, absent or non-string id; a blank or malformed
address), the startup codes, `requireEntitlement`'s `grantAll` — including
that an unknown key **still throws** under it, so the override cannot turn a
typo into silent success — the advisory payload's shape, and five structural
assertions that the override cannot be routed around.

It uses synthetic ids and a synthetic address. Nothing would behave
differently with the real ones: the only operation performed on them is string
equality.

Requirement checks worth re-running by hand after any change to the plan table,
with the real `.env` loaded:

| Check | Expected |
|---|---|
| dev account's entitlement set | 21 of 21 keys |
| paying Pro account's set | 14 keys, 7 Intelligent keys refused with 403 |
| dev account reads another account's rows | refused by RLS, override notwithstanding |
| `subscriptions` row count and contents | unchanged |

The third is the one to actually run, because it is the one the override
would break if it were ever moved upstream of the tenant transaction.
