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
