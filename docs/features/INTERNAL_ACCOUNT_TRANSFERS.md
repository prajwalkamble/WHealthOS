# Internal account transfers

**Status: CURRENT**, same-currency only. Cross-currency transfers are refused,
deliberately, and what they would need is specified under
[Currency policy](#currency-policy).

Moving money between two accounts the same person owns. Added 2026-11-12.

## What the feature is

A person with ₹50,000 in savings and ₹20,000 in a current account moves
₹10,000 between them. Savings falls to ₹40,000, the current account rises to
₹30,000, and the ₹70,000 they have between them does not change.

The important half is what it is **not**. Before this existed, the only way to
record that movement was two unrelated transactions — an expense on one account
and income on the other. That got both balances right and almost everything
else wrong: it inflated the month's income *and* its expenses by ₹10,000 each,
pushed the savings rate towards zero, invented a spending category, and fed the
landing page's published "average saved" figure money nobody earned.

A transfer is therefore a third thing. It is not income, not an expense, and
appears in no income, expense, savings-rate, category or cash-flow total
anywhere in the application.

## Business rules

| | |
|---|---|
**Who** | The signed-in user, on two accounts they own. Resolved server-side; never from a request. |
**Plan** | Every plan. Transfers are part of "Add and manage transactions" in `data/pricing.js`, which is free on `free`, `pro` and `intelligent`. There is no new entitlement key and no new pricing row, because there is no new restriction. |
**Quota** | One unit of the daily transaction allowance per transfer, not two. See `lib/billing/quota.js`. |
**Currency** | Both accounts must already be in the same currency. Different currencies are refused — see [Currency policy](#currency-policy). |
**Overdraft** | Refused. A transfer that would take the source account below zero does not happen. |
**Amount** | Greater than zero, at most 1,000,000,000 (the same ceiling every other money value has), and no more decimal places than the currency has. |
**Date** | Today or earlier, the same range an ordinary transaction allows. The date labels the transfer; both balances move on commit either way. |
**Editing** | Not possible. See [Immutability](#immutability-editing-and-deletion). |
**Deletion** | The whole transfer, which reverses both balances. One leg cannot be deleted on its own. |
**Notification** | None. WHealthOS does not email people about their own bookkeeping, and adding a first such email would be a change to the product's notification policy rather than part of this feature. `lib/notifications/` is untouched. |

### Why overdraft is refused, when expenses are not

Worth stating plainly, because it is an inconsistency on purpose.

An ordinary expense in WHealthOS may take an account negative. `createTransaction`
performs no balance check, and `accountInputSchema` explicitly permits a
negative opening balance — "an overdrawn current account is a real thing".
Spending is a record of something that already happened, and refusing to record
it would not undo it.

A transfer is different: it is an instruction, not a record. Nothing has
happened yet when the person presses Confirm, so there is something to refuse.
Allowing it would also make the concurrency guarantee below unstatable — "two
simultaneous transfers cannot overdraw" has no meaning if one transfer can.

## Data model

```
transfers                        transactions
  id                               ...
  userId            ──┐              transferId  ──► transfers.id   (nullable)
  fromAccountId       │              type        ──  TRANSFER_OUT | TRANSFER_IN
  toAccountId         │
  amount              └── one row  ──► exactly two legs
  currency
  date
  description
  idempotencyKey (unique)
  createdAt / updatedAt
```

`TransactionType` gained two members: `TRANSFER_OUT` and `TRANSFER_IN`.

### Why a parent row *and* two transaction legs

Both halves earn their place.

**The legs have to be real transactions** because of an invariant stated in
`lib/money.js`: `balanceEffect()` is the only thing that writes to
`Account.balance`. `openingBalance()` reconstructs a historical balance by
unwinding transactions back through it, and statements are drawn from that. A
transfer that adjusted two balances directly, with no rows to explain them,
would break that in the quietest possible way — balances correct today, every
reconstructed past balance wrong, and nothing in the ledger accounting for the
difference. Keeping the legs also means account history, the account page, the
transactions table and global search all work with no changes: the rows are
simply there.

**The parent row has to exist** because three things only it can be:

- **one identity.** A transfer is one act and the person is shown one
  reference. Two transactions that happen to agree are not that, and nothing
  could reliably pair them up afterwards.
- **one idempotency key.** A retried confirmation has to lose somewhere, and a
  unique column on the single logical operation is that somewhere.
- **one thing to delete.** Removing it cascades to both legs, so half a
  transfer is not a state the database can hold.

### Why new enum members, not a flag on an income/expense row

Around eight places aggregate money by filtering the type **by name** —
`type: "INCOME"` in Prisma, `FILTER (WHERE type = 'INCOME')` in raw SQL. A type
they do not name is excluded automatically. Had a transfer been an `INCOME` row
carrying a `transferId` flag, every one of those would have counted it unless it
remembered not to, including the public landing-page statistic.

The cost of the choice is the other pattern: eleven places split the type as a
binary (`type === "INCOME" ? income : expenses`), and every one of those would
have filed a transfer **as an expense**. All eleven were corrected in the same
change, each with a test. They are listed in
`docs/testing/INTERNAL_TRANSFER_TEST_REPORT.md`.

### What is enforced by the database, not the service

The service validates all of this before writing. These are the guarantees that
survive a bug in it.

| Constraint | Guarantees |
|---|---|
`transfers_amount_positive` | `amount > 0` |
`transfers_distinct_accounts` | `fromAccountId <> toAccountId` |
`transfers_idempotencyKey_key` | one transfer per key — a replay loses in the database |
`transactions_transfer_leg_key` | `UNIQUE (transferId, type) WHERE transferId IS NOT NULL` — at most one debit and one credit per transfer |
`transactions_transfer_leg_check` | a `TRANSFER_OUT`/`TRANSFER_IN` row must have a `transferId`; an `INCOME`/`EXPENSE` row must not |
`transactions_transferId_fkey` | `ON DELETE CASCADE` — both legs go with the transfer, in one statement |

That last CHECK is what makes a leg unforgeable in both directions: a
`TRANSFER_OUT` with no counterpart (money destroyed, in a row that looks
legitimate to every reader) and an `EXPENSE` attached to a transfer (counted
twice) are both impossible.

### Row-level security

`transfers` is `ENABLE` + `FORCE ROW LEVEL SECURITY` with four policies.

| | |
|---|---|
`SELECT` | job runner, or `"userId" = app_current_tenant()` |
`INSERT` | job runner, or `WITH CHECK ("userId" = app_current_tenant())` |
`UPDATE` | **job runner only** |
`DELETE` | job runner, or own row |

The `INSERT` `WITH CHECK` makes "create a transfer out of somebody else's
account" fail in the database rather than depend on the service resolving the
right id. It does resolve it; this holds if it ever stops.

`UPDATE` admitting nobody is how [immutability](#immutability-editing-and-deletion)
is a guarantee rather than a convention.

## Currency policy

**Same-currency only.** A transfer between accounts in different currencies is
refused, with: *"Both accounts have to be in the same currency. Transfers
between currencies aren't supported yet."*

There is a conversion architecture — ECB daily reference rates, cached, with
`convertAmount()` and `fractionDigitsOf()` — and it was deliberately not used
here. Three reasons:

1. **It is a display mechanism.** Everywhere it is used today it converts a
   figure for reading and writes nothing. Using it to produce an amount that is
   then stored permanently is a different promise: a display conversion that
   turns out to be wrong is corrected on the next page load, and a stored one
   is wrong for good.
2. **Two supported currencies have no rate at all.** The ECB does not publish
   AED or SAR. `registry.js` marks them `convertible: false`, and its own
   comment is the relevant standard: claiming a converted figure there "would
   mean inventing the rate".
3. **Rate freshness is not currently guaranteed.** The refresh job's history
   shows it can stop without anything noticing — as of the 2026-11-11 audit it
   had not run for 27 days. A transfer priced off a month-old rate is not a
   rounding problem, it is the wrong amount of money.

There are deliberately no `sourceAmount`, `destinationAmount`, `exchangeRate`
or `rateAsOf` columns. Their absence is what stops a later change quietly
starting to convert.

### What a cross-currency transfer would need

Not implemented. Recorded so that it is a decision rather than an omission.
Every item needs sign-off before any of it is built:

- the exchange-rate source, and whether it is the same ECB set
- maximum acceptable rate age, and the behaviour when it is exceeded
- behaviour for a pair with no published rate (AED, SAR)
- which amount is authoritative — the one the person typed, or the converted one
- rounding mode and the currency's precision on each side
- the rate and its timestamp stored on the transfer, so the figure can be
  explained years later
- whether a fee exists, and if so, which side pays it
- what the review screen shows, and whether a quoted rate is held

## Transfer lifecycle

1. The person opens the drawer from `/accounts` or an account page.
2. They pick two accounts, an amount, a date and an optional note. The
   browser runs the real rules — `lib/transfers/rules.js`, imported, not
   reimplemented — and shows what the source will hold afterwards.
3. **Review.** Both accounts, the amount, and both balances before and after.
   An idempotency key is minted on entering this step.
4. **Confirm.** One request.
5. The server commits, or nothing happens. The success screen is drawn from the
   server's answer — never from the form.

### What commits together

Inside one `withCurrentTenant` transaction:

- the `transfers` row
- the `TRANSFER_OUT` leg
- the `TRANSFER_IN` leg
- the source balance decrement
- the destination balance increment
- the day's quota consumption

Six writes, one transaction. There is no ordering of them that can leave money
debited and not credited, because a failure anywhere rolls back all six. This
is not something the module implements so much as something it declines to work
around: the temptations would be a second request, a queue or a callback, and
each is a window in which half a transfer exists.

### Concurrency

Two mechanisms, both verified by deliberately removing them and watching the
tests fail.

**`SELECT … FOR UPDATE` on both account rows.** Without it, two simultaneous
transfers of ₹30,000 from an account holding ₹50,000 both read ₹50,000, both
pass the funds check, and both commit — leaving −₹10,000. With it, the second
waits and then reads ₹20,000 and is refused. The lock also blocks a concurrent
ordinary transaction's `increment` on the same row for the duration, since that
`UPDATE` needs the same lock.

Both accounts are locked **in sorted id order**, which is the whole deadlock
story: a transfer A→B and a transfer B→A arriving together would otherwise each
hold the row the other wants, and Postgres would resolve it by killing one — a
transfer failing with a deadlock error rather than a reason.

**`pg_advisory_xact_lock` on the idempotency key**, taken before the key is
read. The unique index alone is not enough: two simultaneous confirmations both
miss the read, both insert, and one gets a constraint violation — which aborts
its transaction, so it *cannot* recover and answer with the transfer that did
commit. It can only fail. The person double-clicked, is told something went
wrong, and their money moved. With the lock, the second waits and then finds the
committed row and replays it.

What the lock does **not** cover: an ordinary expense landing immediately after
a transfer commits can still overdraw the account that way. Expenses are
deliberately allowed to overdraw, so that is existing behaviour and not
something a transfer rule should silently change.

### Idempotency

The browser mints a UUID on entering the review step. The server stores it as
`"<userId>:<that uuid>"` in a unique column.

- Same key, same details → the existing transfer, with `replayed: true`.
- Same key, different details → refused. A client bug that reuses one key for
  two genuinely different transfers must not lose the second silently.
- Same key, different user → unrelated. Scoping prevents both a collision and
  an information leak.
- A new key per visit to the review step, so going Back, changing something and
  reviewing again is never mistaken for a retry.

The key never reaches the browser in a response: it is scoped with the internal
user id.

The Confirm button is disabled while the request is in flight, which stops the
second of two fast clicks. That is not the protection — a button is only as
reliable as the browser it is in.

## Immutability, editing and deletion

**A transfer cannot be edited.** Not by policy alone: the RLS `UPDATE` policy
admits only the job runner, and there is no `updateTransfer` anywhere. Editing
one in place would mean reversing two balances and applying two more against
accounts that may have moved underneath — for a correction that is two clicks
either way.

**A transfer can be deleted**, as a whole. Both legs go with it by cascade, and
both balances are reversed by unwinding each leg through `balanceEffect` — the
same arithmetic `bulkDeleteTransactions` uses, so there is one rule for
"deleting a row gives the money back" rather than two that can disagree. Both
accounts are locked first, so a concurrent transfer's funds check sees a settled
balance.

Transfers are deletable rather than permanently immutable because every other
financial record in WHealthOS is: an undeletable row would be a surprise, and
would leave a typo permanent. A full reversal model — original retained, linked
opposite entry, `REVERSED` status — is proper ledger practice and was considered
and not built, because it introduces a concept nothing else in this product has.

**One leg cannot be deleted on its own.** `bulkDeleteTransactions` refuses any
selection containing one, and refuses it *whole* rather than filtering: a
filtered delete would remove the ordinary transactions, silently keep the legs,
and report the count the person asked for. In the interface, a leg's checkbox
is disabled, its row menu offers no Edit, and its Delete says "Delete both
sides".

## API

Two server actions. No route handlers, so nothing was added to
`isProtectedRoute`.

### `createInternalTransfer(payload)`

```js
{ fromAccountId, toAccountId, amount, date, description?, idempotencyKey }
```

Nothing else is accepted, and zod drops unknown keys — so a crafted body
offering `userId`, `currency`, `status`, `id`, `exchangeRate` or a computed
destination amount loses them before they can reach a Prisma create.

Returns `{ success: true, data: { id, amount, currency, date, description,
from: {id, name}, to: {id, name}, legs, createdAt }, replayed }`, or
`{ success: false, error }` with a message written for a person.

### `deleteInternalTransfer(transferId)`

Returns `{ success: true, data: { id } }` or `{ success: false, error }`.

### What is never trusted

Account ids, an amount, a date and a note. That is the entire input. Not a user
id, not a balance, not a currency, not a status, not a transfer id, not a
converted amount. Both account rows are read from the database under the
tenant's own RLS scope, and every decision is made from those rows — so an id
belonging to somebody else is not "rejected", it is never found.

### Error handling

Refusals are codes (`lib/transfers/rules.js`), rendered to messages at the
edge. No message names an internal id, a table, a constraint or another user.
`SOURCE_NOT_FOUND` and `DESTINATION_NOT_FOUND` share one message
deliberately — an account that does not exist and one belonging to somebody
else are indistinguishable, so account ids cannot be probed.

`TransferError` resolves its own message through `messageFor()`, so forwarding
`error.message` to a person can never show them a bare code. (`super(message ?? code)`
would have put `INSUFFICIENT_FUNDS` in a toast.)

## Interface

Entry points: a **Transfer** button beside *New Account* on `/accounts`, and
one on each account page which opens with that account pre-selected. Both are
hidden below two accounts — an action that cannot be completed is worse than
one that is absent. No new navigation.

**Every figure in the drawer is in the account's own currency**, via
`formatMoney()`, which converts nothing. Everywhere else in WHealthOS a balance
is drawn through `useCurrency()` and converted into whatever the person reads
in. That is right for reading and wrong here, because the number typed is the
number **stored**: type 10,000 against a rupee account and ₹10,000 moves,
whatever the dashboard is set to. Converting the balances beside the input while
leaving the input unconverted would put two currencies on one screen and label
neither.

The swap control exchanges the two accounts and nothing else — the amount, date
and note stay, and validation reruns because the funds question now concerns a
different account. It is `type="button"`: inside a form it would otherwise
submit the transfer.

The review screen shows no fee line and no conversion line, because there are
none. A row reading "Fee: ₹0.00" would imply a fee that could one day be
something else.

### Transaction history

Each leg names the other account on the row itself — "To Tina Current", "From
Tina Savings", with the note appended — rather than resolving it through a join.
So the account page, the transactions table and global search all explain the
row with no extra query and no knowledge of what a transfer is. (The same trick
the recurring processor uses for "(Recurring)".)

Both legs render **neutral**, not green or red: a transfer is neither a gain nor
a loss, and colouring it either way would be the interface making a claim the
ledger does not. The sign still shows which way the money went. The type badge
reads simply "Transfer" on both sides. The type filter gained a single
"Transfer" option covering both legs.

## Testing

```sh
pnpm test                                    # everything
pnpm --filter @whealthos/web exec vitest run tests/transfers.test.js
pnpm --filter @whealthos/web exec vitest run tests/transfer-integration.test.js
```

`tests/transfers.test.js` (29) needs no database: it is the rules, the
classification, the sign and tone helpers, `openingBalance` across legs, and the
payload schema. `tests/transfer-integration.test.js` (50) needs the local test
database and covers what only a database can answer — atomicity, both locks,
idempotency including the simultaneous case, cross-tenant isolation, every
constraint, and that the dashboard and analytics figures do not move.

Results and the financial invariants are in
`docs/testing/INTERNAL_TRANSFER_TEST_REPORT.md`.

## Known limitations

- **Cross-currency transfers are refused.** Policy above.
- **Transfers cannot be edited.** Delete and make another.
- **Deleting an account would delete its transfers** (`ON DELETE CASCADE`,
  matching `transactions.accountId`), leaving the far side of each one holding a
  balance the ledger no longer explains. There is no account-deletion path in
  the application today — accounts go only when the user does, and then
  everything goes — but if one is ever added it must reverse that account's
  transfers first.
- **The account page chart does not show transfers.** It plots income against
  expenses per day from a query that filters both by name, so a day whose only
  activity was a transfer is drawn flat while the balance above it moved. The
  chart is labelled income and expenses and is not wrong; it is incomplete as
  an explanation of the balance.
- **No notification.** By design — see the table at the top.
- **Future-dated transfers are not offered**, matching ordinary transactions.
  Both would move the balance immediately regardless, since the date is a label
  rather than a schedule.
- **A transfer followed immediately by a large expense can still overdraw an
  account.** Expenses are allowed to overdraw; the transfer lock only holds for
  the transfer's own transaction.
