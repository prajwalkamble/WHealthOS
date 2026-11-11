import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PLAN_FAQS, PLANS } from "@/data/pricing";
import { TERMS } from "@/lib/legal/terms";
import { quotaEnforcementEnabled } from "@/lib/billing/quota";

// Does the pricing page promise anything the application does not do?
//
// The subscription audit in docs/testing/ found two claims that it did, and
// both had the same shape: a sentence that was true of the product somebody
// intended, written in the present tense about the product that shipped.
//
//   S5  three answers described a per-day transaction cap. Nothing applies it.
//   S3  one answer promised an upgrade that "applies immediately", through a
//       plan switch that has no route, no action and no control.
//
// Neither is detectable by any test that reads only the copy, which is why
// these assertions are tied to the mechanism instead: the quota flag for the
// cap, and the reachability of requestPlanChange for the switch. They relax on
// their own if either is ever built, and they fail if the copy drifts back
// while it is not.
//
// What is deliberately NOT asserted: the comparison table. PLANS[].limit still
// reads "5 per day" and tests/usage-quota.test.js requires it to, because the
// displayed figure and the enforced figure have to stay in step for the day the
// cap is switched on. The table describes what the plans are intended to
// separate, the notice at the top of the page says the limits are not applied,
// and section 6 of the Terms tells readers to read it that way. An ANSWER to a
// direct question is different: it is a statement about what happens.

const WEB = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(WEB, rel), "utf8");

const answers = PLAN_FAQS.map((faq) => faq.answer).join("\n");
const questions = PLAN_FAQS.map((faq) => faq.question).join("\n");

// --- Is there a way to change plan at all? ---------------------------------
//
// requestPlanChange is exported from lib/billing/service.js and, at the time of
// the audit, called from nowhere. Scanned rather than assumed, so that wiring
// it up turns these assertions off instead of making them a nuisance.
const SEARCH = ["actions", "app", "components"];
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

const planChangeCallers = SEARCH.flatMap((dir) =>
  sources(path.join(WEB, dir))
).filter((file) => /\brequestPlanChange\s*\(/.test(readFileSync(file, "utf8")));

const canChangePlan = planChangeCallers.length > 0;

// --- When the switch IS built ----------------------------------------------
//
// Four of the blocks below relax when requestPlanChange() gains a caller, by
// design: they guard against copy describing a route that does not exist, and
// once it exists they have nothing to say. That happened on 2026-11-11.
//
// What replaces them is not nothing. The assertions in the final describe hold
// whether or not the switch exists, because they are about the two things that
// did NOT become true: the change is not immediate, and it only goes upwards.
// Those are the claims this copy is now at risk of making.
describe("the pricing copy does not promise a plan switch that is not there", () => {
  it("has no reachable plan-change path, or says so here", () => {
    // Not an assertion about the product -- having a plan switch is fine.
    // It records which branch the rest of this block is in, so a failure
    // below is read correctly.
    expect(
      Array.isArray(planChangeCallers),
      "the scan itself failed"
    ).toBe(true);
  });

  it("does not claim an upgrade applies immediately", () => {
    // Deliberately NOT guarded on canChangePlan, unlike every other block in
    // this describe. The comment here always said this assertion "stays
    // asserted either way" and the body contradicted it with an early return,
    // so the one guard that was meant to survive the feature being built was
    // the one that switched off the moment it was.
    //
    // It has to survive, because the sentence is still false. A plan change
    // goes through changeSubscriptionPlan() with schedule_change_at
    // "cycle_end": the upgrade built on 2026-11-11 lands at the end of the
    // period already paid for, which for a yearly subscriber is months away.
    // "Applies immediately" is exactly the thing somebody would write into
    // this copy on hearing that one-step upgrades now exist.
    //
    // The withdrawn sentence, exactly: "An upgrade applies immediately; a
    // downgrade takes effect at the end of the period you have already paid
    // for."
    expect(answers).not.toMatch(/applies immediately/i);
    // The same claim in the words somebody would actually reach for.
    expect(answers).not.toMatch(/\bupgrade[sd]?\s+(?:is|are|takes effect)\s+immediate/i);
    expect(answers).not.toMatch(/straight away|right away|instantly/i);
  });

  it("does not offer upgrading or downgrading 'at any time'", () => {
    if (canChangePlan) return;
    expect(answers).not.toMatch(/\bat any time\b/i);
    expect(questions).not.toMatch(/upgrade or downgrade/i);
  });

  it("describes the route that does exist: cancel, wait, resubscribe", () => {
    if (canChangePlan) return;
    expect(
      answers,
      "the plan-move answer must name cancellation, since that is the only route"
    ).toMatch(/cancel/i);
    expect(
      answers,
      "and must say it is not a single step, so nobody looks for a switch"
    ).toMatch(/not in a single step|two steps/i);
  });

  it("does not send anybody to a change control in Settings", () => {
    if (canChangePlan) return;
    // Three surfaces said this. app/(main)/settings/_components/plan-card.jsx
    // offers no plan change while a subscription is live, so every one of them
    // was pointing at a button that is not rendered.
    const billing = read("app/(checkout)/billing/page.jsx");
    expect(billing).not.toMatch(/it is made in Settings/i);

    const service = read("lib/billing/service.js");
    expect(
      service,
      "the SUBSCRIPTION_EXISTS message must not tell people to change a plan"
    ).not.toMatch(/Change or cancel it/i);
  });
});

describe("the pricing copy describes the plan move that exists, and only it", () => {
  // The route is upwards only. requestPlanChange() refuses a downgrade and an
  // interval-only change with NOT_AN_UPGRADE, so copy offering either is the
  // same class of mistake as finding S3: a sentence about the product somebody
  // intended.
  const downgradeRefused = /\bNOT_AN_UPGRADE\b/.test(read("lib/billing/service.js"));

  it("refuses a downgrade in the service, or stops asserting it here", () => {
    expect(
      downgradeRefused,
      "requestPlanChange no longer refuses a downgrade -- revisit this block"
    ).toBe(true);
  });

  it("does not offer a downgrade in one step", () => {
    if (!downgradeRefused) return;
    expect(answers).not.toMatch(/downgrade (?:at any time|in one step|whenever)/i);
    // "switch plans", "change plans freely", "move between plans in one step"
    // -- each reads as symmetrical, and only one direction is.
    expect(answers).not.toMatch(/move between (?:the )?(?:paid )?plans in (?:a )?(?:one|single) step/i);
  });

  it("says which direction is the one step", () => {
    if (!downgradeRefused) return;
    const move = PLAN_FAQS.find((faq) => /move between the paid plans/i.test(faq.question));
    expect(move, "the plan-move answer has gone missing").toBeTruthy();
    expect(
      move.answer,
      "the answer must say the one-step route is upwards"
    ).toMatch(/move up|higher plan|upgrade/i);
    expect(
      move.answer,
      "and must say a move down is not one step"
    ).toMatch(/two steps|cancel/i);
  });

  it("says the upgrade is not immediate", () => {
    if (!downgradeRefused) return;
    const move = PLAN_FAQS.find((faq) => /move between the paid plans/i.test(faq.question));
    expect(
      move.answer,
      "the answer must say when the change takes effect, not just that it is one step"
    ).toMatch(/end of the period|next renew|when the subscription next/i);
  });
});

describe("the pricing copy does not describe a cap nothing applies", () => {
  it("is running with the quota switched off", () => {
    // The precondition for everything below. If the cap is ever enforced,
    // these assertions should be revisited rather than silently skipped --
    // hence asserting the state instead of branching on it.
    expect(quotaEnforcementEnabled()).toBe(false);
    expect(TERMS.perDayTransactionLimitEnforced).toBe(false);
  });

  it("does not state what happens when a limit is reached", () => {
    // "you simply cannot add more until the next day, or until you move to a
    // plan with a higher cap" -- a description of a mechanism that does not
    // run, in the present tense.
    expect(answers).not.toMatch(/cannot add more/i);
    expect(answers).not.toMatch(/higher cap/i);
    expect(answers).not.toMatch(/daily limit/i);
  });

  it("does not sell the free plan on a transaction allowance", () => {
    // "The Free plan covers the dashboard, accounts, and up to five
    // transactions a day" -- the five is not applied, and it was the first
    // thing a visitor read about the free plan.
    expect(answers).not.toMatch(/up to five transactions/i);
    expect(answers).not.toMatch(/five transactions a day/i);
  });

  it("does not call the cap the one real per-transaction figure", () => {
    expect(answers).not.toMatch(/only per-transaction figure/i);
  });

  it("says plainly that the figures in the table are not applied", () => {
    // Presence, not absence. The failure being guarded against is a page that
    // prints "5 per day" in a table and then goes quiet about it, which is
    // what somebody comparing plans would reasonably read as a limit.
    expect(
      answers,
      "an answer must say the transactions-per-day figures are not applied"
    ).toMatch(/not applied to anyone|not applied to anybody/i);
  });

  it("still advertises the figures the server would enforce", () => {
    // The other half, and the reason this file does not simply delete the
    // numbers: the table and lib/billing/quota.js must keep saying the same
    // thing, so that switching the cap on does not change what people were
    // shown. tests/usage-quota.test.js owns that invariant; this asserts the
    // numbers are still there to be governed by it.
    const capped = PLANS.filter((plan) => plan.dailyTransactions !== null);
    expect(capped.length).toBeGreaterThan(0);
    for (const plan of capped) {
      expect(plan.limit, `${plan.id} lost its advertised figure`).toMatch(/per day/i);
    }
  });
});
