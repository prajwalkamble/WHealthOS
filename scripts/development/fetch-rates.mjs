// Fills the exchange_rates table from the European Central Bank's daily
// reference rates.
//
// Why this exists: nothing in the application fetches a rate in a render path
// -- a dashboard must not wait on a third party -- so rates arrive only from
// the `refresh-exchange-rates` Inngest job. On a fresh deployment, or any
// machine where the job runner is not running, that leaves the table empty,
// and an empty table means every mixed-currency total is reported per
// currency rather than converted. Correct, and indistinguishable from a
// broken feature if you are trying to see it work.
//
// Usage, from the repository root:
//
//   node --env-file=apps/web/.env scripts/development/fetch-rates.mjs
//
// or against the local test database:
//
//   node --env-file=apps/web/.env.test scripts/development/fetch-rates.mjs
//
// --on=YYYY-MM-DD backfills one historical fixing instead of the latest.
// --dry-run prints what it would write and touches nothing.
//
// Safe to run twice: one row per currency per day per source, upserted.

import { PrismaClient } from "../../database/generated/client/index.js";
import { fetchRates, PROVIDER } from "../../apps/web/lib/currency/rates/provider.js";

// Two things this cannot import, both for the same reason -- a script run by
// bare node does not get the Next build's module resolution:
//
//   the store (lib/currency/rates/store.js) resolves "@/lib/prisma";
//   "@prisma/client" is a workspace dependency of the database package, not
//   of the repository root.
//
// So the generated client is imported by path and the upsert below is written
// out. It is the same upsert as putRates, against a client this script owns.

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const on = args.find((a) => a.startsWith("--on="))?.slice(5) ?? null;

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL (or DATABASE_URL) is not set. Pass --env-file.");
  process.exit(1);
}

const dayOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

async function main() {
  console.log(`Fetching ${on ? `the fixing for ${on}` : "the latest fixing"}…`);
  const payload = await fetchRates({ on });

  const quotes = Object.entries(payload.rates).sort(([a], [b]) => a.localeCompare(b));
  console.log(`  ${payload.source} quoted against ${payload.base}, dated ${payload.asOf}`);
  for (const [quote, rate] of quotes) {
    console.log(`    1 ${payload.base} = ${String(rate).padStart(12)} ${quote}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const asOf = dayOf(payload.asOf);
    for (const [quote, rate] of quotes) {
      await db.exchangeRate.upsert({
        where: {
          base_quote_asOf_source: { base: payload.base, quote, asOf, source: PROVIDER },
        },
        update: { rate: String(rate), fetchedAt: new Date() },
        create: {
          base: payload.base,
          quote,
          rate: String(rate),
          source: PROVIDER,
          asOf,
          fetchedAt: new Date(),
        },
      });
    }
    const total = await db.exchangeRate.count();
    console.log(`\nWrote ${quotes.length} rates. The table now holds ${total}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  // Prisma's connection errors can carry an empty `message`, which printed
  // a bare "Failed:" and said nothing at all -- the usual cause is simply
  // that Postgres is accepting TCP but has not finished starting, which is
  // exactly what happens when you run this right after `docker start`.
  const detail =
    error?.message?.trim() ||
    error?.code ||
    error?.name ||
    String(error) ||
    "no detail";
  console.error(`\nFailed: ${detail}`);
  if (/P1001|ECONNREFUSED|Can't reach/i.test(detail)) {
    console.error(
      "The database is not reachable yet. If you have just started it, wait a\n" +
        "few seconds and run this again."
    );
  }
  process.exit(1);
});
