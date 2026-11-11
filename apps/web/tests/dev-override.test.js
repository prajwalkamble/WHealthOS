import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configuredEmail,
  configuredUserId,
  devGrantsAll,
  devOverrideEnabled,
  devOverrideProblems,
  emailLooksValid,
  onVercel,
  overrideFlagOn,
} from "@/lib/billing/dev-override";
import {
  ENTITLEMENT_KEYS,
  EntitlementError,
  entitlementSummary,
  entitlementsFor,
  requireEntitlement,
} from "@/lib/billing/entitlements";
import { FEATURE_GROUPS } from "@/data/pricing";

// The development-only entitlement override.
//
// Deliberately synthetic ids and addresses throughout. The real development
// account's uuid, Clerk id and address live in apps/web/.env, which is
// gitignored, and in docs/development/DEV_FEATURE_OVERRIDE.md -- not in a
// committed test file. Nothing here would behave differently with the real
// values, because the only operation performed on them is string equality.
const DEV_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-8888-7777-6666-555555555555";
const DEV_EMAIL = "dev-account@gmail.com";

const KEYS = [
  "VERCEL",
  "VERCEL_ENV",
  "DEV_FEATURE_OVERRIDE",
  "DEV_FEATURE_OVERRIDE_USER_ID",
  "DEV_FEATURE_OVERRIDE_EMAIL",
  "BILLING_ENFORCEMENT",
];

const saved = {};

// Every key is cleared, not just set, and apps/web/.env is the reason. The
// Prisma client loads it from the working directory, so a variable set there
// is present in this process whatever vitest.config.mjs says -- which is how
// the enforcement switch-on produced five unexplained failures in the DB
// suites. A test about configuration has to own every variable it reads.
beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// The configuration that actually grants, as a helper, so each test below
// changes exactly the one thing it is about.
const configure = (overrides = {}) => {
  Object.assign(
    process.env,
    {
      DEV_FEATURE_OVERRIDE: "on",
      DEV_FEATURE_OVERRIDE_USER_ID: DEV_ID,
      DEV_FEATURE_OVERRIDE_EMAIL: DEV_EMAIL,
    },
    overrides
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
};

describe("the development override's access rule", () => {
  it("grants the configured account when every condition holds", () => {
    configure();
    expect(devOverrideEnabled()).toBe(true);
    expect(devGrantsAll(DEV_ID)).toBe(true);
  });

  it("grants nobody else, however the override is configured", () => {
    configure();
    expect(devGrantsAll(OTHER_ID)).toBe(false);
  });

  // Phase 8. The whole point of the feature, and the case that must never
  // regress: the same configuration that grants locally grants nothing on a
  // deployment.
  it("refuses every Vercel environment with the configuration otherwise valid", () => {
    for (const env of ["production", "preview", "development", undefined]) {
      configure({ VERCEL: "1", VERCEL_ENV: env });
      expect(devOverrideEnabled(), `VERCEL_ENV=${env}`).toBe(false);
      expect(devGrantsAll(DEV_ID), `VERCEL_ENV=${env}`).toBe(false);
    }
  });

  it("keys off VERCEL rather than NODE_ENV, so a local production build still works", () => {
    // A local `pnpm build && next start` runs with NODE_ENV=production. If
    // that disabled the override, the override would be off in exactly the
    // configuration a change is verified in before it ships -- and somebody
    // would then "fix" it by loosening the environment check.
    configure();
    const savedNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(devGrantsAll(DEV_ID)).toBe(true);
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it("is off unless the flag says exactly \"on\"", () => {
    for (const value of ["true", "1", "yes", "ON ", "off", "", undefined]) {
      configure({ DEV_FEATURE_OVERRIDE: value });
      expect(devGrantsAll(DEV_ID), JSON.stringify(value)).toBe(false);
    }
    // Case is not significant, trailing spaces are not trimmed by design:
    // "on" is a literal, and an operator who typed "ON" meant "on".
    configure({ DEV_FEATURE_OVERRIDE: "ON" });
    expect(devGrantsAll(DEV_ID)).toBe(true);
  });

  it("is off with no configured user id, so it can never match by default", () => {
    for (const value of [undefined, "", "   "]) {
      configure({ DEV_FEATURE_OVERRIDE_USER_ID: value });
      expect(devOverrideEnabled(), JSON.stringify(value)).toBe(false);
      // The dangerous shape: a blank configured id must not match a blank
      // caller id and let an unauthenticated request through.
      expect(devGrantsAll(""), JSON.stringify(value)).toBe(false);
      expect(devGrantsAll("   "), JSON.stringify(value)).toBe(false);
    }
  });

  it("is off when the configured address is absent or malformed", () => {
    for (const value of [undefined, "", "[INSERT YOUR DEVELOPMENT GMAIL ADDRESS]", "not-an-email", "a@b"]) {
      configure({ DEV_FEATURE_OVERRIDE_EMAIL: value });
      expect(devOverrideEnabled(), JSON.stringify(value)).toBe(false);
      expect(devGrantsAll(DEV_ID), JSON.stringify(value)).toBe(false);
    }
  });

  it("refuses an absent, blank or non-string caller id in every environment", () => {
    configure();
    for (const value of [undefined, null, "", "   ", 0, false, {}, []]) {
      expect(devGrantsAll(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("normalises the configured id and address but not the caller's id", () => {
    configure({ DEV_FEATURE_OVERRIDE_USER_ID: `  ${DEV_ID}  ` });
    expect(devGrantsAll(DEV_ID)).toBe(true);
    // The caller's id comes from the database via a verified session, so it is
    // compared as given. Trimming it would mean accepting something that is
    // not the id.
    expect(devGrantsAll(` ${DEV_ID} `)).toBe(false);

    configure({ DEV_FEATURE_OVERRIDE_EMAIL: `  ${DEV_EMAIL.toUpperCase()} ` });
    expect(configuredEmail()).toBe(DEV_EMAIL);
    expect(devGrantsAll(DEV_ID)).toBe(true);
  });

  it("exposes the raw readers the startup check needs", () => {
    configure({ VERCEL: "1" });
    expect(onVercel()).toBe(true);
    expect(overrideFlagOn()).toBe(true);
    expect(configuredUserId()).toBe(DEV_ID);
    expect(emailLooksValid(DEV_EMAIL)).toBe(true);
    expect(emailLooksValid("nope")).toBe(false);
  });
});

describe("what the startup check reports", () => {
  it("says nothing when the override is unconfigured", () => {
    expect(devOverrideProblems()).toEqual([]);
  });

  it("says nothing when the override is correctly configured", () => {
    configure();
    expect(devOverrideProblems()).toEqual([]);
  });

  it("reports a flag that reached a deployment, naming the environment", () => {
    configure({ VERCEL: "1", VERCEL_ENV: "production" });
    const [problem, ...rest] = devOverrideProblems();
    expect(rest).toEqual([]);
    expect(problem.code).toBe("DEV_OVERRIDE_ENABLED_ON_VERCEL");
    expect(problem.detail).toContain("production");
    // It has to say the thing is harmless as well as wrong, or whoever reads
    // it at 3am treats a tidy-up as an incident.
    expect(problem.detail).toMatch(/grants nothing/i);
  });

  it("reports a flag set with no user id, which silently does nothing", () => {
    configure({ DEV_FEATURE_OVERRIDE_USER_ID: undefined });
    expect(devOverrideProblems().map((p) => p.code)).toEqual([
      "DEV_OVERRIDE_ENABLED_WITHOUT_USER_ID",
    ]);
  });

  it("reports a missing address and says the override is disabled by it", () => {
    configure({ DEV_FEATURE_OVERRIDE_EMAIL: undefined });
    const [problem] = devOverrideProblems();
    expect(problem.code).toBe("DEV_OVERRIDE_EMAIL_MISSING_OR_MALFORMED");
    expect(problem.detail).toMatch(/DISABLED/);
  });

  it("stays quiet about configuration nobody asked to use", () => {
    // Variables left behind with the flag off are not a problem to report.
    configure({ DEV_FEATURE_OVERRIDE: undefined });
    expect(devOverrideProblems()).toEqual([]);
  });
});

describe("the entitlement gate under the override", () => {
  it("lets every published key through when grantAll is set", () => {
    process.env.BILLING_ENFORCEMENT = "on";
    for (const key of ENTITLEMENT_KEYS) {
      expect(() => requireEntitlement("free", key, { grantAll: true })).not.toThrow();
    }
  });

  it("still refuses an unknown key under the override", () => {
    // The override must not turn a typo into silent success: the account using
    // it is the one most likely to reach a new key first, so a misspelling has
    // to fail there too.
    process.env.BILLING_ENFORCEMENT = "on";
    expect(() => requireEntitlement("free", "ai.recieipts", { grantAll: true })).toThrow(
      /Unknown entitlement key/
    );
  });

  it("refuses the same keys as before when grantAll is absent", () => {
    process.env.BILLING_ENFORCEMENT = "on";
    const intelligentOnly = FEATURE_GROUPS.flatMap((group) =>
      group.features.filter((f) => !f.plans.includes("pro")).map((f) => f.key)
    );
    expect(intelligentOnly.length).toBeGreaterThan(0);
    for (const key of intelligentOnly) {
      expect(() => requireEntitlement("pro", key)).toThrow(EntitlementError);
    }
  });
});

describe("what the browser is told", () => {
  it("reports every capability, the real plan, and why they disagree", () => {
    process.env.BILLING_ENFORCEMENT = "on";
    const summary = entitlementSummary("free", { grantAll: true });
    // The plan is NOT rewritten. This is the line that stops Settings from
    // displaying a subscription that does not exist.
    expect(summary.planId).toBe("free");
    expect(summary.devAccess).toBe(true);
    expect(new Set(summary.entitlements)).toEqual(new Set(ENTITLEMENT_KEYS));
  });

  it("is unchanged for everybody else, with no devAccess field at all", () => {
    process.env.BILLING_ENFORCEMENT = "on";
    const summary = entitlementSummary("pro");
    expect(summary.planId).toBe("pro");
    expect("devAccess" in summary).toBe(false);
    expect(new Set(summary.entitlements)).toEqual(entitlementsFor("pro"));
  });
});

// Requirement 12, as an executable fact rather than a claim in a document.
describe("the paying account is untouched by any of this", () => {
  it("keeps Pro at its own feature set with the Intelligent keys refused", () => {
    process.env.BILLING_ENFORCEMENT = "on";
    configure();

    const pro = entitlementsFor("pro");
    const intelligent = entitlementsFor("intelligent");
    const exclusive = [...intelligent].filter((key) => !pro.has(key));

    expect(exclusive.length).toBeGreaterThan(0);
    for (const key of exclusive) {
      // The override is configured and active in this process, and it makes no
      // difference to an account that is not the one named.
      expect(devGrantsAll(OTHER_ID)).toBe(false);
      expect(() => requireEntitlement("pro", key)).toThrow(EntitlementError);
    }

    // Every AI feature is Intelligent-only as of 2026-11-10, so no Pro
    // account may reach a model.
    for (const key of [...pro]) expect(key.startsWith("ai.")).toBe(false);
  });
});

// Structural. These are the tests that catch the next gate rather than this
// one: a reviewer can read the five call sites today, but the override is only
// correct for as long as nothing acquires a sixth path of its own.
describe("the override cannot be routed around", () => {
  const read = (relative) =>
    readFileSync(join(process.cwd(), relative), "utf8");

  it("is applied wherever requireEntitlement is called", () => {
    // requireEntitlement decides authorisation and takes grantAll as an
    // argument, so a caller that forgets it silently loses the override. There
    // must therefore be exactly one caller, and it must pass it.
    const callers = [
      "lib/billing/guard.js",
      "lib/queries.js",
      "lib/billing/service.js",
      "lib/billing/entitlements.js",
      "components/billing/feature-gate.jsx",
      "app/api/ai/chat/route.js",
      "app/api/export/transactions/route.js",
      "actions/transaction.js",
      "actions/budget.js",
      "actions/goals.js",
      "actions/preferences.js",
    ].filter((file) => /\brequireEntitlement\s*\(/.test(read(file)));

    // entitlements.js declares it; guard.js calls it. Nothing else.
    expect(callers).toEqual(["lib/billing/guard.js", "lib/billing/entitlements.js"]);
    expect(read("lib/billing/guard.js")).toContain(
      "requireEntitlement(planId, key, { grantAll: devGrantsAll(userId) })"
    );
  });

  it("is consulted by every surface that decides whether to offer a control", () => {
    // Each of these draws or withholds a control based on the plan. One that
    // did not ask would show a padlock over something the server will in fact
    // allow -- the exact disagreement feature-gate.jsx's own comment forbids.
    for (const file of [
      "components/billing/feature-gate.jsx",
      "app/(main)/layout.js",
      "app/(main)/transaction/create/page.jsx",
      "app/api/billing/subscription/route.js",
    ]) {
      expect(read(file), file).toContain("devGrantsAll");
    }
  });

  it("never rewrites the plan, so no screen can report a subscription that does not exist", () => {
    // The override lives in the gate, not in plan resolution. If it ever moved
    // into service.js, billingSummary() would start returning a plan the
    // account has not got and Settings would display it as real.
    const service = read("lib/billing/service.js");
    expect(service).not.toContain("devGrantsAll");
    expect(service).not.toContain("dev-override");
  });

  it("is never exposed to the browser", () => {
    // A NEXT_PUBLIC_ name would be inlined into the client bundle, which would
    // put the configured account's address and id on every page.
    for (const file of [
      "lib/billing/dev-override.js",
      "lib/security/required-config.js",
      ".env.example",
    ]) {
      expect(read(file), file).not.toMatch(/NEXT_PUBLIC_DEV_FEATURE/);
    }
    // The decision is made on the server and handed over as a boolean.
    expect(read("components/header/app-header.jsx")).not.toContain("process.env");
    expect(read("app/(main)/settings/_components/plan-card.jsx")).not.toContain("process.env");
  });

  it("keeps the real account out of the committed example configuration", () => {
    const example = read(".env.example");
    expect(example).toContain("DEV_FEATURE_OVERRIDE");
    expect(example).toMatch(/00000000-0000-0000-0000-000000000000/);
    expect(example).not.toMatch(/user_[A-Za-z0-9]{20,}/);
  });
});
