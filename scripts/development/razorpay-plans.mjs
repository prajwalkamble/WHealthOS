// Creates the four Razorpay Plans a subscription is billed against, and
// prints the environment lines for them.
//
// Why this exists: a Razorpay Plan holds the amount and the interval on
// Razorpay's side, so its id cannot be derived, guessed or defaulted -- the
// wrong id charges the wrong price. The four ids are therefore configuration,
// and creating them by hand in the Dashboard means typing four prices
// correctly into a form. This reads them from data/pricing.js instead, which
// is the same catalogue the pricing page renders and the server charges from.
//
// Usage, from the repository root:
//
//   node --env-file=apps/web/.env scripts/development/razorpay-plans.mjs
//
// or, before those keys are in .env:
//
//   RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=yyy \
//     node scripts/development/razorpay-plans.mjs
//
// Safe to run twice. It lists the plans already on the account first and
// reuses any it created before -- matched on the notes it writes, not on the
// name, so renaming a plan in the Dashboard does not produce a duplicate.
// Razorpay plans cannot be deleted, only left unused, which is the other
// reason this does not create blindly.
//
// --dry-run prints what it would create and calls nothing.

import { PLANS, YEARLY_DISCOUNT } from "../../apps/web/data/pricing.js";

const API = "https://api.razorpay.com/v1";
const MONTHS = 12;

// The same arithmetic as rupeesFor() in apps/web/lib/billing/plans.js. It
// cannot import that module -- it resolves through the "@/" alias, which only
// Next and vitest know about -- so tests/billing-plans.test.js asserts the two
// agree for every plan and interval rather than leaving them to drift.
const rupeesFor = (plan, interval) =>
  interval === "yearly"
    ? Math.round(plan.monthly * MONTHS * (1 - YEARLY_DISCOUNT))
    : plan.monthly;

// Razorpay's own word for the billing cycle, which happens to match ours.
const PERIOD = { monthly: "monthly", yearly: "yearly" };

// What needs to exist, derived rather than written down.
export function planSpecs() {
  const specs = [];
  for (const plan of PLANS) {
    if (plan.monthly <= 0) continue; // Free is not sold.
    for (const interval of ["monthly", "yearly"]) {
      specs.push({
        envName: `RAZORPAY_PLAN_${plan.id.toUpperCase()}_${interval.toUpperCase()}`,
        planId: plan.id,
        interval,
        period: PERIOD[interval],
        amountPaise: rupeesFor(plan, interval) * 100,
        name: `WHealthOS ${plan.name} (${interval})`,
      });
    }
  }
  return specs;
}

const rupees = (paise) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })
    .format(paise / 100);

async function call(auth, path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error?.description ?? response.statusText;
    throw new Error(`${method} ${path} -> ${response.status}: ${detail}`);
  }
  return payload;
}

async function main() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const dryRun = process.argv.includes("--dry-run");

  if (!keyId || !keySecret) {
    console.error(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set.\n" +
        "Dashboard > Account & Settings > API Keys > Generate Key."
    );
    process.exit(1);
  }

  console.log(
    `Mode: ${keyId.startsWith("rzp_test_") ? "TEST (no real money)" : "LIVE (real money)"}\n`
  );

  const specs = planSpecs();

  if (dryRun) {
    for (const spec of specs) {
      console.log(`would create  ${spec.name.padEnd(36)} ${rupees(spec.amountPaise)} / ${spec.interval}`);
    }
    return;
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  // What is already there. Matched on our own notes rather than on the name,
  // so a plan renamed in the Dashboard is still recognised.
  const existing = await call(auth, "/plans?count=100");
  const byKey = new Map(
    (existing?.items ?? [])
      .filter((plan) => plan?.notes?.whealthos_plan)
      .map((plan) => [`${plan.notes.whealthos_plan}:${plan.notes.whealthos_interval}`, plan])
  );

  // A plan id already in the environment wins over the notes lookup.
  //
  // This is not belt-and-braces, it is the common case: a plan created by hand
  // in the Dashboard carries no notes, so the map above cannot see it, and
  // without this the script would cheerfully create a second plan at the same
  // price and print a variable pointing at the new one. Four duplicates on a
  // live merchant account is not a mistake worth leaving available.
  const byId = new Map(
    (existing?.items ?? []).filter((plan) => plan?.id).map((plan) => [plan.id, plan])
  );

  const lines = [];

  for (const spec of specs) {
    const key = `${spec.planId}:${spec.interval}`;
    const configured = process.env[spec.envName];
    const found = (configured ? byId.get(configured) : null) ?? byKey.get(key);

    if (configured && !byId.has(configured)) {
      // Named in the environment and not on this account. Almost always a
      // test plan id against live keys, or the other way round -- and
      // creating a replacement would hide it rather than report it.
      console.warn(
        `! ${spec.envName}\n` +
          `  is set to ${configured}, which this account's plans do not include.\n` +
          `  Check you are using the keys that belong to it. Nothing was created.`
      );
      lines.push(`${spec.envName}="${configured}"`);
      continue;
    }

    if (found) {
      // Reused, but checked: a plan whose amount no longer matches the
      // catalogue would charge yesterday's price for ever, silently.
      const amount = found.item?.amount;
      if (amount !== spec.amountPaise) {
        console.warn(
          `! ${spec.envName}\n` +
            `  existing plan ${found.id} charges ${rupees(amount)}, the catalogue says ${rupees(spec.amountPaise)}.\n` +
            `  Razorpay plans are immutable: create a new one and point the variable at it.`
        );
      } else {
        const how = configured ? "configured" : "reused  ";
        console.log(`${how} ${found.id}  ${spec.name}  ${rupees(amount)}`);
      }
      lines.push(`${spec.envName}="${found.id}"`);
      continue;
    }

    const created = await call(auth, "/plans", {
      method: "POST",
      body: {
        period: spec.period,
        interval: 1,
        item: {
          name: spec.name,
          amount: spec.amountPaise,
          currency: "INR",
        },
        notes: { whealthos_plan: spec.planId, whealthos_interval: spec.interval },
      },
    });

    console.log(`created  ${created.id}  ${spec.name}  ${rupees(spec.amountPaise)}`);
    lines.push(`${spec.envName}="${created.id}"`);
  }

  console.log("\nAdd these to apps/web/.env, then restart the dev server:\n");
  console.log(lines.join("\n"));
}

// Only when run directly, so planSpecs() can be imported by a test without
// talking to Razorpay.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
