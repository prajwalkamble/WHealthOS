# Currency

WHealthOS shows money in the currency the person reading it wants, while
every stored amount keeps the currency it was actually in.

Those are two different things and the whole design turns on keeping them
apart. Changing a display currency reformats and converts what is **shown**
and rewrites nothing.

## The five currencies in play

| | What it is | Where it lives |
|---|---|---|
| **Display** | What the viewer reads in | `users.displayCurrency`, a cookie, or geolocation |
| **Account** | What an account actually holds | `accounts.currency` |
| **Transaction** | What one transaction was in | `transactions.currency`, copied from the account at write time |
| **Workspace reporting** | — | Does not exist. There are no workspaces |
| **Billing** | What Razorpay charges | `lib/billing/plans.js`, INR |

The last row is not a detail. Setting the dashboard to dollars does not mean
Razorpay can charge dollars, and `tests/currency.test.js` fails if anything
under `lib/billing/` or `lib/payments/` so much as imports the display
resolver.

## Detecting a country

From the edge, not from a GeoIP service:

```
x-vercel-ip-country  →  cf-ipcountry  →  x-country-code
```

No lookup, no API key, no latency, nothing to be down — and the visitor's IP
address is never sent anywhere. Cloudflare's `XX` ("could not place this
request") is treated as unplaced rather than as a country.

It is approximate, and a VPN gives a confident wrong answer. That is fine,
because it is only ever a **suggestion**: it sits at the bottom of the
precedence below, and one click overrides it permanently.

**On localhost there is no such header**, so every visitor resolves to the
application default and the behaviour looks absent. To see it in development,
set the country yourself:

```js
document.cookie = "whealth-dev-country=JP; path=/"   // then reload
```

That cookie is read only when `NODE_ENV !== "production"`. If geolocation
seems not to work in a real deployment, the usual cause is the opposite
problem: a **manual** choice is already stored, and a choice outranks a
suggestion forever. Clear it with:

```js
document.cookie = "whealth-currency=; path=/; max-age=0"   // then reload
```

Headers a browser could set itself are deliberately not read.

## Which currency wins

```
manual     → the person chose it. Nothing outranks a choice.
account    → their saved preference, on any device.
workspace  → never reached; no workspaces exist.
geo        → suggested from the country the edge placed them in.
default    → INR.
```

A guest who picks yen and then signs up keeps yen — the account adopts the
choice rather than overwriting it. Someone who chose dollars in Mumbai still
sees dollars from Frankfurt.

The cookie records **whether** a currency was chosen or merely suggested,
which is what makes the first two rules distinguishable.

## Where it is resolved

On the server, in `(main)/layout.js` and `demo/layout.jsx`, and handed to
`CurrencyProvider` as a prop. The first paint is already correct; there is no
effect that reads a cookie afterwards and no frame where a page of balances
shows the wrong currency.

The root layout deliberately does **not** do this. A `cookies()` call there
would opt all 58 statically generated marketing pages into per-request
rendering for a currency none of them shows.

Server components call `currentCurrency()`, which is memoised per request with
React's `cache()` — five components on a dashboard share one resolution.

## Exchange rates

European Central Bank daily reference rates, via Frankfurter. No API key, no
account, nothing to leak.

Rates are **read from our own table**, never fetched in a render path. One
Inngest job writes them (`refresh-exchange-rates`, four times a day, plus a
`currency.rates.refresh` event to warm a fresh deployment). A provider outage
therefore degrades a converted total to a slightly older one, not a page load.

Everything is quoted against EUR, so one row per currency per day covers every
pair; anything else is a cross-rate computed from two rows. Rows are keyed by
the date the rate is **for**, so any figure ever displayed can be recomputed
exactly — which is what makes a converted total defensible without storing a
snapshot of every render.

Arithmetic is `Decimal` throughout. Never a float.

### What it refuses to do

- **No rate, no conversion.** `rateFor` returns null rather than 1. Falling
  back to parity would present an unconverted figure as a converted one.
- **No partial totals.** If any component of a mixed-currency sum cannot be
  converted, `sumInCurrency` returns `total: null` and the per-currency
  breakdown. A total that silently omits the yen account looks right and is
  wrong.
- **No invented rates for AED or SAR.** The ECB does not publish them. They
  format, they can be an account's currency, they can be chosen for display —
  they just do not convert, and the registry says so.

A total built from a rate older than four days is returned with `stale: true`.
Four, not one: the ECB publishes on working days, so Monday legitimately reads
Friday's fixing.

## How the signed-in app converts

One scalar, applied in the provider.

Every money figure on these pages is a **linear aggregate** of the records
behind it — a sum, a difference, a subtotal. So while every account shares a
currency, one multiplication converts all of them exactly, and percentages and
savings rates are ratios and come out unchanged without any special handling.

`(main)/layout.js` resolves it once per request with `displayConversion()` and
hands it to `CurrencyProvider`. `format()` multiplies, then formats. No page
or component decides anything, and none of them can forget to.

When conversion is **refused** — no rate, a currency the ECB does not publish,
or a ledger holding more than one currency — the provider formats in the
**ledger's** currency and `ConversionNotice` says why. There is deliberately no
path where a number keeps its value and changes its symbol;
`tests/currency.test.js` fails if a surface formats money outside this path.

Server components cannot read the provider, so `serverCurrency()` carries the
same conversion for them. The two agree by construction.

## The guest dashboard

Sample data is declared as INR (`DEMO_CURRENCY`) and **converted at a real
rate**, with a line saying so. Relabelling ₹84,250 as ¥84,250 would misstate
it by roughly a factor of two.

With no rate stored, the demo shows the figures in INR and says that instead.
Unconverted and labelled beats converted at a number nobody can defend.

A row a guest adds is divided back into INR on the way in, so switching
currency rescales their row alongside the sample rather than stranding one
number in a currency nobody is looking at.

## Operating it

Warm the rate table on a new deployment (otherwise totals stay per-currency
until the first cron, within six hours):

```sh
node --env-file=apps/web/.env scripts/development/fetch-rates.mjs
```

Safe to run twice; one row per currency per day, upserted. `--on=YYYY-MM-DD`
backfills a historical fixing, `--dry-run` writes nothing.

The refresh is otherwise the `refresh-exchange-rates` Inngest job, which only
runs if the app is **registered** with Inngest -- a deploy does not register
it. See `scripts/development/inngest-sync.mjs`.

Check what is stored:

```sh
psql "$DIRECT_URL" -c "
  SELECT base, quote, rate, \"asOf\", source
  FROM exchange_rates ORDER BY \"asOf\" DESC, quote LIMIT 20;"
```

## Adding a currency

1. Add it to `DEFINITIONS` in `lib/currency/registry.js`, with `convertible`
   set to whether the ECB publishes it.
2. Add its countries to `COUNTRIES_BY_CURRENCY` in `lib/currency/countries.js`.

Symbols and fraction digits are not written down — ICU supplies both, which is
why JPY and KRW come out with no decimal places without anybody saying so.

## Limitations

- **AED and SAR do not convert.** See above. Switching provider is a change to
  one adapter file.
- **ECB rates are indicative.** A reference fixing, not a dealing price and not
  what a bank settles at. Anything showing a converted figure says so.
- **The marketing calculators stay in the default currency.** They are
  statically generated and the figures are illustrative sums, not anybody's
  money. Making them per-visitor would make every marketing page dynamic.
- **Pricing and checkout stay in INR**, because Razorpay settles in INR. That
  is deliberate, not an oversight.
- **Existing rows were backfilled as INR.** They were implicitly INR already —
  the only formatter in the app was hard-wired to it. The migration writes down
  what was true rather than reinterpreting anything.
- **Accounts cannot yet be given a non-INR currency through the UI.** The
  column, the write path and the conversion all exist and are tested; the
  account form does not offer the choice. That is the next piece of work, and
  it is what turns `currency.multi` from sold into delivered.
- **A mixed-currency ledger is reported, not converted.** Conversion under
  `(main)` applies one scalar, which is exact only while every account shares
  a currency. The moment two differ, `displayConversion` refuses with
  `mixed-ledger` and the figures stay in the currency they are held in. Making
  that case convert means calling `sumInCurrency` per figure in the loaders --
  the service is built and tested for it, the loaders do not call it yet. It
  is unreachable until accounts can be given a currency, which is why the two
  pieces of work belong together.
