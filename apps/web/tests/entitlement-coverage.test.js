import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { FEATURE_GROUPS } from "@/data/pricing";
import { ENTITLEMENT_KEYS } from "@/lib/billing/entitlements";
import { SETTING_ENTITLEMENTS } from "@/lib/preferences";

// Does anything actually enforce the matrix?
//
// tests/entitlements.test.js proves the engine answers correctly. This file
// asks the other question, the one a correct engine cannot answer on its own:
// is it called? A feature sold on the pricing page with no gate behind it is
// not a bug the engine can detect -- every check it is asked to make passes.
//
// Nine paid features shipped without one. This is the test that stops the
// tenth.

const WEB = path.resolve(import.meta.dirname, "..");

const SEARCH = ["actions", "app", "components", "lib"];
const SKIP = new Set(["node_modules", ".next", ".next-build", "tests"]);

function sources(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.(js|jsx|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}

const FILES = SEARCH.flatMap((dir) => sources(path.join(WEB, dir)));

// Every key named in a gate call, anywhere. requireFeature,
// requireFeatureInAction and requireEntitlement are the three ways in;
// FeatureGate and FeatureNotice take one as a prop and are presentation only,
// so they are deliberately not counted as enforcement.
// Bounded rather than [^)]*, because the first argument is usually itself a
// call -- requireFeature(await getCurrentUserId(), "data.export") -- and a
// character class that stops at the first ")" never reaches the key.
const GATE_CALL =
  /\b(?:requireFeature|requireFeatureInAction|requireEntitlement)\s*\([\s\S]{0,160}?["']([a-z][a-z0-9.-]*)["']/g;

const gated = new Set();
const gatedIn = new Map();
for (const file of FILES) {
  if (file.includes(`${path.sep}lib${path.sep}billing${path.sep}`)) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(GATE_CALL)) {
    gated.add(match[1]);
    if (!gatedIn.has(match[1])) gatedIn.set(match[1], path.relative(WEB, file));
  }
}

// savePreferences gates per setting rather than per call: it looks each
// changed setting up in SETTING_ENTITLEMENTS and requires whatever that says,
// so the keys are data and no literal appears at the call site. They are
// enforcement all the same -- the linkage is asserted below.
for (const key of Object.values(SETTING_ENTITLEMENTS)) {
  if (!key) continue;
  gated.add(key);
  if (!gatedIn.has(key)) gatedIn.set(key, "lib/preferences.js (SETTING_ENTITLEMENTS)");
}

const FEATURES = FEATURE_GROUPS.flatMap((group) => group.features);
const paidOnly = FEATURES.filter((feature) => !feature.plans.includes("free"));

// Paid features with no gate, each with the reason there is nothing to gate.
//
// An entry here is a claim about the codebase, not a licence to skip the
// check. If one of these ever grows a backend surface, it needs a gate and it
// has to come off this list -- which is why the set is asserted exactly
// rather than merely consulted.
const NO_BACKEND_SURFACE = {
  // Advertised on the pricing page and not built: every currency column in
  // the schema is `String @default("INR")`, no action or route sets one, and
  // the PDF export states outright that no conversion is applied. There is
  // no code path to gate. Reported rather than quietly gated.
  "currency.multi": "not implemented anywhere; nothing to gate",
  // A support commitment, answered by people. Not a code path.
  "support.priority": "a support SLA, not a feature in the application",
  // Facets of the assistant and the monthly report rather than separate
  // features: the only ways to reach a model are /api/ai/chat, which is
  // gated on ai.queries, and the monthly report, gated on ai.insights.
  "ai.spending": "reached only through the assistant, gated on ai.queries",
  "ai.summaries": "reached only through the monthly report, gated on ai.insights",
  "ai.budgeting": "reached only through the assistant, gated on ai.queries",
  "ai.recommendations": "reached only through the assistant, gated on ai.queries",
};

describe("every paid feature is either gated or known not to exist", () => {
  it("names a real key in every gate call", () => {
    // A typo'd key is the worst outcome available: requireEntitlement throws
    // on an unknown key, so the feature breaks for everybody rather than
    // failing open -- but only when that line runs.
    for (const [key, file] of gatedIn) {
      expect(ENTITLEMENT_KEYS, `${file} gates on an unknown key "${key}"`).toContain(key);
    }
  });

  it("gates every paid feature that has something to gate", () => {
    const ungated = paidOnly
      .map((feature) => feature.key)
      .filter((key) => !gated.has(key) && !(key in NO_BACKEND_SURFACE));

    expect(
      ungated,
      `sold but not enforced: ${ungated.join(", ")}. Add a requireFeature ` +
        "call at the entry point, or record why there is nothing to gate in " +
        "NO_BACKEND_SURFACE."
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // Exactly, not loosely. Gating one of these, or deleting the feature from
    // the pricing table, must fail here so the reason gets revisited.
    const exempt = Object.keys(NO_BACKEND_SURFACE).sort();
    const stillPaid = paidOnly.map((f) => f.key);
    for (const key of exempt) {
      expect(stillPaid, `${key} is exempt but no longer sold as paid`).toContain(key);
      expect(gated, `${key} is now gated -- take it off the exemption list`).not.toContain(key);
    }
  });

  it("never gates a feature the free plan includes", () => {
    // Gating something free takes it away from everybody who has it, which
    // section 6 of the Terms promises not to do without notice.
    const free = FEATURES.filter((f) => f.plans.includes("free")).map((f) => f.key);
    for (const key of free) {
      expect(gated, `${key} is on the free plan but is gated in ${gatedIn.get(key)}`)
        .not.toContain(key);
    }
  });
});

describe("the surfaces that cost money are gated at the entrance", () => {
  const read = (rel) => readFileSync(path.join(WEB, rel), "utf8");

  it("checks the plan before the assistant calls a model", () => {
    const route = read("app/api/ai/chat/route.js");
    expect(route).toContain('requireFeature(await getCurrentUserId(), "ai.queries")');
    // Before, not after: the point is not to pay for a refused answer.
    expect(route.indexOf("ai.queries")).toBeLessThan(route.indexOf("runAgentTurn({"));
  });

  it("checks the plan before the receipt image is read or sent", () => {
    // Two orderings, for two different costs. The gate must come before
    // generateContent, so a refused scan is not also a paid one -- and before
    // the file is turned into base64, so a 4MB upload is not held in memory
    // for a request that was never going to run.
    const action = read("actions/transaction.js");
    expect(action).toContain('requireFeatureInAction(userId, "ai.receipts", { tx })');

    const gate = action.indexOf('"ai.receipts"');
    const read64 = action.indexOf("Buffer.from(arrayBuffer).toString(\"base64\")");
    const model = action.indexOf("await generateContent([");
    expect(gate).toBeGreaterThan(-1);
    expect(read64).toBeGreaterThan(gate);
    expect(model).toBeGreaterThan(gate);
  });

  it("checks the plan before the monthly report calls a model", () => {
    // A background job has no session, so this is the case a route-level
    // guard cannot cover: a Free account that left the Settings switch on
    // was emailed an Intelligent feature every month, at our cost.
    const job = read("lib/inngest/functions.js");
    expect(job).toContain('requireEntitlement(await effectivePlanId(userId), "ai.insights")');
    expect(job.indexOf('"ai.insights"')).toBeLessThan(
      job.indexOf("await generateFinancialInsights(stats, monthName)")
    );
  });

  it("gates the paid reads, not only the writes", () => {
    // Finding S4. actions/budget.js and actions/goals.js have refused writes
    // since the gates were written, while lib/queries.js handed the rows back
    // to anybody who asked -- so an unentitled account could read every budget
    // and goal it had created, and only discover the limit by trying to change
    // one. Invisible while nothing was enforced.
    const queries = read("lib/queries.js");
    for (const key of ["budgets", "goals", "analytics"]) {
      expect(
        queries,
        `the ${key} read is not gated in lib/queries.js`
      ).toContain(`requireFeatureInAction(userId, "${key}", { tx })`);
    }
  });

  it("gates each paid read before it reads anything", () => {
    // Inside the tenant transaction and ahead of the fetch, so a refusal
    // costs no query and cannot be reported after the rows are already in
    // memory.
    const queries = read("lib/queries.js");
    // Sliced to the exported function's own body: the private helpers are
    // declared earlier in the file, so a whole-file indexOf finds the
    // declaration of goalsFor long before the gate that protects its caller.
    const body = (name) => {
      const from = queries.indexOf(`export async function ${name}(`);
      expect(from, `${name} is not exported from lib/queries.js`).toBeGreaterThan(-1);
      const to = queries.indexOf("\nexport ", from + 1);
      return queries.slice(from, to === -1 ? undefined : to);
    };

    for (const [name, key, fetch] of [
      ["getBudgets", "budgets", "budgetsFor(tx, userId, period)"],
      ["getGoals", "goals", "goalsFor(tx, userId)"],
    ]) {
      const fn = body(name);
      const g = fn.indexOf(`requireFeatureInAction(userId, "${key}", { tx })`);
      const f = fn.indexOf(fetch);
      expect(g, `${name} has no gate`).toBeGreaterThan(-1);
      expect(f, `${name} does not call ${fetch}`).toBeGreaterThan(-1);
      expect(f, `${name} reads rows before its gate`).toBeGreaterThan(g);
    }
  });

  it("shows the locked state instead of an error page", () => {
    // A server component that lets the refusal throw hands the person an
    // error page for something that is not an error. The fetch has to live in
    // a child so that a denied account never runs the query.
    for (const [page, feature] of [
      ["app/(main)/budgets/page.jsx", "budgets"],
      ["app/(main)/goals/page.jsx", "goals"],
      ["app/(main)/analytics/page.jsx", "analytics"],
    ]) {
      expect(read(page), `${page} does not render the locked state`).toContain(
        `<FeatureGate feature="${feature}"`
      );
    }
  });

  it("offers the receipt scanner only to a plan that may use it", () => {
    // The control, not the authorisation: actions/transaction.js refuses the
    // scan regardless. A button that always fails is the thing being avoided.
    const page = read("app/(main)/transaction/create/page.jsx");
    expect(page).toContain('planGrants(planIdFromRows(user?.subscriptions), "ai.receipts")');
    // And it agrees with the server about when a refusal happens, or it is a
    // padlock over something that works.
    expect(page).toContain("enforcementEnabled()");

    const form = read("app/(main)/transaction/_components/transaction-form.jsx");
    expect(form).toContain('<LockedReceiptScanner reason="plan" />');
  });

  it("mounts the assistant only for a plan that includes it", () => {
    const layout = read("app/(main)/layout.js");
    expect(layout).toContain('planGrants(planIdFromRows(user?.subscriptions), "ai.queries")');
    expect(layout).toContain("enforcementEnabled()");
  });

  it("requires whatever SETTING_ENTITLEMENTS names, for the settings changing", () => {
    // The scan above counts those keys as enforced. This is what makes that
    // true: the action reads the map, takes only the settings that actually
    // changed, and requires each one.
    const action = read("actions/preferences.js");
    expect(action).toContain("SETTING_ENTITLEMENTS[key]");
    expect(action).toContain("changedSettings(before, preferences)");
    expect(action).toContain("requireFeatureInAction(userId, entitlement, { tx })");
    // Inside the tenant transaction, so the read of the current preferences
    // and the write that replaces them cannot disagree.
    expect(action.indexOf("withCurrentTenant")).toBeLessThan(
      action.indexOf("requireFeatureInAction")
    );
  });

  it("consumes the daily allowance inside the write it guards", () => {
    const action = read("actions/transaction.js");
    expect(action).toContain("consumeDailyTransaction(tx, userId, planId)");
    // Inside withCurrentTenant, and before the insert: outside the
    // transaction a refusal would not roll the row back, and after the
    // insert it would not stop it.
    const open = action.indexOf("await withCurrentTenant(async (tx, userId) => {");
    const quota = action.indexOf("consumeDailyTransaction(tx, userId, planId)");
    const insert = action.indexOf("tx.transaction.create({");
    expect(open).toBeGreaterThan(-1);
    expect(quota).toBeGreaterThan(open);
    expect(insert).toBeGreaterThan(quota);
    // The plan is resolved from the database, never from the payload.
    expect(action).toContain("effectivePlanId(userId, { tx })");
    expect(action).not.toMatch(/data\.plan|rawData\.plan|body\.plan/);
  });
});

// --- Every model call site is accounted for --------------------------------
//
// The question above is "is the matrix enforced". This one is narrower and was
// answered by nobody: does every place that calls a model have an entitlement
// decision recorded against it?
//
// Receipt scanning is why this exists. actions/transaction.js has sent photos
// to Gemini since long before there were plans, behind a session and a rate
// limit and no entitlement key at all -- not denied, not granted, simply not
// considered. It was invisible because it is not a defect in any one file: the
// engine cannot report a feature it has never been told about, and the scan
// above cannot miss a key that was never written down. The only way to see it
// is to start from the model calls and work back to the matrix.
//
// So each call site names the feature it belongs to, and the registry is
// asserted exactly. A new model call fails this file until somebody decides
// which plan pays for it.
const MODEL_SURFACES = {
  "actions/transaction.js": {
    feature: "ai.receipts",
    gatedIn: "actions/transaction.js",
    why: "receipt scanning, Intelligent from 2026-11-10",
  },
  "lib/inngest/functions.js": {
    feature: "ai.insights",
    gatedIn: "lib/inngest/functions.js",
    why: "the monthly report's written commentary",
  },
  "lib/ai/agent.js": {
    feature: "ai.queries",
    // The gate is at the route rather than here: the point is not to pay for
    // an answer that will be refused, so it happens before the stream opens.
    gatedIn: "app/api/ai/chat/route.js",
    why: "the WHOS assistant",
  },
};

// Files that reach the model, found by their import of the wrapper rather than
// by name, so a new helper around it is still caught.
const IMPORTS_GEMINI = /from\s+["'](?:@\/lib\/ai\/gemini|[./]+(?:lib\/ai\/)?gemini)["']/;

const modelCallSites = FILES.filter((file) => {
  const rel = path.relative(WEB, file);
  if (rel === path.join("lib", "ai", "gemini.js")) return false; // the wrapper itself
  return IMPORTS_GEMINI.test(readFileSync(file, "utf8"));
}).map((file) => path.relative(WEB, file));

describe("every model call site has an entitlement decision recorded", () => {
  it("knows about exactly the call sites that exist", () => {
    expect(
      modelCallSites.sort(),
      "a file calls a model without an entry in MODEL_SURFACES. Decide which " +
        "plan includes it, give it a key in data/pricing.js, and record it here."
    ).toEqual(Object.keys(MODEL_SURFACES).sort());
  });

  it("names a real feature for each one", () => {
    for (const [site, { feature }] of Object.entries(MODEL_SURFACES)) {
      expect(ENTITLEMENT_KEYS, `${site} names an unknown feature "${feature}"`)
        .toContain(feature);
    }
  });

  it("only leaves a call site ungated when the free plan includes it", () => {
    // The loophole this closes: recording `gatedIn: null` for a paid surface
    // would turn this registry into a licence to ship an unenforced feature.
    const free = new Set(
      FEATURES.filter((f) => f.plans.includes("free")).map((f) => f.key)
    );
    for (const [site, { feature, gatedIn }] of Object.entries(MODEL_SURFACES)) {
      if (gatedIn !== null) continue;
      expect(
        free.has(feature),
        `${site} is ungated but ${feature} is not on the free plan`
      ).toBe(true);
      expect(gated, `${feature} is free and must not be gated`).not.toContain(feature);
    }
  });

  it("finds the gate where it says the gate is", () => {
    for (const [site, { feature, gatedIn }] of Object.entries(MODEL_SURFACES)) {
      if (gatedIn === null) continue;
      const source = readFileSync(path.join(WEB, gatedIn), "utf8");
      const keys = [...source.matchAll(GATE_CALL)].map((m) => m[1]);
      expect(keys, `${site} says it is gated in ${gatedIn} on ${feature}`)
        .toContain(feature);
      // And a gated surface must be a paid one, or the gate is decoration.
      const row = FEATURES.find((f) => f.key === feature);
      expect(row.plans, `${feature} is gated but the free plan includes it`)
        .not.toContain("free");
    }
  });
});
