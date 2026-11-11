import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildContentSecurityPolicy,
  clerkHostFromPublishableKey,
  HEADER_NAME,
} from "@/lib/security/csp.mjs";
import {
  billingPolicyContradictions,
  missingProductionConfig,
} from "@/lib/security/required-config";
import { TERMS } from "@/lib/legal/terms";

// A publishable key is the base64 of the frontend API host with a trailing $.
// Built here rather than pasted, so this file contains no real key.
const keyFor = (host) =>
  `pk_test_${Buffer.from(`${host}$`, "utf8").toString("base64")}`;

describe("the Clerk host is derived, not hardcoded", () => {
  it("reads the frontend API host out of the publishable key", () => {
    expect(clerkHostFromPublishableKey(keyFor("example-42.clerk.accounts.dev"))).toBe(
      "example-42.clerk.accounts.dev"
    );
  });

  it("refuses anything that is not a bare host", () => {
    // A decoded value carrying a scheme, a slash or a space would be pasted
    // straight into a response header, so it is rejected rather than trusted.
    for (const bad of [
      `pk_test_${Buffer.from("https://evil.example$").toString("base64")}`,
      `pk_test_${Buffer.from("host.example/path$").toString("base64")}`,
      `pk_test_${Buffer.from("two hosts.example$").toString("base64")}`,
      "pk_test_%%%not-base64%%%",
      "not-a-key",
      null,
      undefined,
    ]) {
      expect(clerkHostFromPublishableKey(bad)).toBeNull();
    }
  });

  it("still produces a usable policy when the key is absent at build time", () => {
    // A missing key must never yield a policy that blocks sign-in outright.
    const csp = buildContentSecurityPolicy({ publishableKey: undefined });
    expect(csp).toContain("https://*.clerk.accounts.dev");
    expect(csp).toContain("https://*.clerk.com");
  });
});

describe("the content security policy", () => {
  it("ships report-only, so a wrong allowlist cannot blank the application", () => {
    expect(HEADER_NAME).toBe("Content-Security-Policy-Report-Only");
  });

  it("carries the directives that do the work", () => {
    const csp = buildContentSecurityPolicy({ publishableKey: keyFor("a.clerk.accounts.dev") });
    // These four are what the policy buys while script-src still allows
    // inline: no framing, no <base> hijack, no off-site form post, no objects.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("allows the third parties the application actually loads", () => {
    const csp = buildContentSecurityPolicy({ publishableKey: keyFor("a.clerk.accounts.dev") });
    expect(csp).toContain("https://a.clerk.accounts.dev");
    // Razorpay Standard Checkout: the script, and the modal it injects.
    expect(csp).toContain("https://checkout.razorpay.com");
    expect(csp).toContain("https://api.razorpay.com");
    // Clerk's bot protection is Cloudflare Turnstile; without it sign-up
    // fails only when the challenge appears.
    expect(csp).toContain("https://challenges.cloudflare.com");
  });

  it("does not ask production to allow eval, and upgrades its requests", () => {
    const prod = buildContentSecurityPolicy({ publishableKey: keyFor("a.clerk.com"), isProduction: true });
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).toContain("upgrade-insecure-requests");

    // Development needs eval for the dev overlay, and must not try to upgrade
    // http://localhost.
    const dev = buildContentSecurityPolicy({ publishableKey: keyFor("a.clerk.com") });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("production configuration is reported when incomplete", () => {
  const saved = {};
  const KEYS = [
    "DATABASE_URL", "DIRECT_URL", "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_WEBHOOK_SIGNING_SECRET",
    "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "INNGEST_SIGNING_KEY",
    "ARCJET_KEY", "SITE_URL", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
    "NEXT_PUBLIC_RAZORPAY_KEY_ID", "RAZORPAY_WEBHOOK_SECRET",
  ];

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      process.env[k] = "present";
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("says nothing when everything is set", () => {
    expect(missingProductionConfig({ selling: true })).toEqual([]);
  });

  it("names the webhook secret and what its absence costs", () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    const [found] = missingProductionConfig();
    expect(found.name).toBe("CLERK_WEBHOOK_SIGNING_SECRET");
    // The cost, not just the name: "missing" is only actionable if you know
    // it means deletion requests are piling up unapplied.
    expect(found.cost).toMatch(/deletion/i);
  });

  it("treats an empty string as absent", () => {
    process.env.SITE_URL = "   ";
    expect(missingProductionConfig().map((m) => m.name)).toContain("SITE_URL");
  });

  it("asks for the Razorpay secrets only when plans are on sale", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(missingProductionConfig({ selling: false })).toEqual([]);
    expect(missingProductionConfig({ selling: true }).map((m) => m.name)).toEqual([
      "RAZORPAY_WEBHOOK_SECRET",
    ]);
  });
});

// The gap the subscription audit of 2026-11-10 found, and the check that
// closes it.
//
// tests/legal-consistency.test.js already guards these pairs, but every one of
// its assertions is wrapped in `if (process.env.X !== undefined)` -- so the
// one state that makes the Terms false, the variable being UNSET, is the one
// state it skips. That guard is correct for a test run, which cannot know how
// production is configured. billingPolicyContradictions() is the answer for a
// deployment, and these are the cases it has to get right.
describe("configuration that contradicts the published Terms", () => {
  const FLAGS = [
    "BILLING_ENFORCEMENT",
    "BILLING_QUOTA_ENFORCEMENT",
    "BILLING_PLANS_ON_SALE",
  ];
  const saved = {};

  beforeEach(() => {
    for (const k of FLAGS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of FLAGS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const codes = (terms) =>
    billingPolicyContradictions(terms ? { terms } : {}).map((c) => c.code);

  // A document that announces enforcement. This is what ships from 2026-11-10,
  // and what shipped from 2026-11-01 -- the difference being that it is now
  // true. Kept as an explicit fixture as well as read from the repository, so
  // that every case below stays meaningful whichever way the document is next
  // rewritten.
  const CLAIMS_ENFORCEMENT = {
    paidPlansAvailable: true,
    checkoutIntegratedButSellsNothing: false,
    perDayTransactionLimitEnforced: false,
  };

  // A document that says paying unlocks nothing: the 2026-10-23 position, and
  // the 2026-11-10 draft that was written and not shipped. The dangerous
  // direction for THIS state is enforcement being switched on underneath it.
  const DENIES_ENFORCEMENT = {
    paidPlansAvailable: false,
    checkoutIntegratedButSellsNothing: true,
    perDayTransactionLimitEnforced: false,
  };

  it("reads the Terms as they actually ship", () => {
    // Section 6 describes enforced plans as of 2026-11-10. If it is ever
    // rewritten the other way, this says so rather than silently passing --
    // and the cases below keep covering both states.
    expect(TERMS.paidPlansAvailable).toBe(true);
    expect(TERMS.checkoutIntegratedButSellsNothing).toBe(false);
  });

  it("is satisfied by the Terms as they now ship, enforcement on", () => {
    // The whole point of switching the flag: this configuration is not a
    // contradiction, because the document describes it.
    process.env.BILLING_ENFORCEMENT = "on";
    process.env.BILLING_PLANS_ON_SALE = "on";
    expect(codes()).toEqual([]);
  });

  it("is not satisfied by the shipped Terms with enforcement forgotten", () => {
    // The state every environment was in until 2026-11-10, and the state a
    // new one starts in. Unset, not "off": that is the case the tripwire in
    // legal-consistency.test.js cannot see.
    expect(codes()).toContain("TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF");
  });

  it("catches enforcement being UNSET while the Terms announce it", () => {
    // The exact state the audit found, and the exact state the tripwire in
    // legal-consistency.test.js cannot see, because it is guarded on the
    // variable being defined.
    expect(codes(CLAIMS_ENFORCEMENT)).toContain(
      "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF"
    );
  });

  it("catches enforcement being explicitly off, too", () => {
    process.env.BILLING_ENFORCEMENT = "off";
    expect(codes(CLAIMS_ENFORCEMENT)).toContain(
      "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF"
    );
  });

  it("is satisfied when that document is matched by enforcement", () => {
    process.env.BILLING_ENFORCEMENT = "on";
    expect(codes(CLAIMS_ENFORCEMENT)).not.toContain(
      "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF"
    );
  });

  it("reads the flag the same way the entitlement engine does", () => {
    // entitlements.js lowercases before comparing, so "ON" enforces. A check
    // that disagreed with the engine would report a contradiction that is not
    // there.
    process.env.BILLING_ENFORCEMENT = "ON";
    expect(codes(CLAIMS_ENFORCEMENT)).not.toContain(
      "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF"
    );
  });

  it("catches a document that denies enforcement while it is on", () => {
    // The other direction, which is what the 2026-11-10 draft would have been
    // exposed to had it shipped: a section 6 saying paying unlocks nothing,
    // with the switch on. Kept tested from a fixture because switching the
    // document back is a decision somebody may yet make.
    process.env.BILLING_ENFORCEMENT = "on";
    expect(codes(DENIES_ENFORCEMENT)).toContain(
      "TERMS_CLAIM_NOTHING_IS_SOLD_WHILE_ENFORCING"
    );
  });

  it("catches an UNDISCLOSED live checkout for what is already free", () => {
    process.env.BILLING_PLANS_ON_SALE = "on";
    expect(codes(CLAIMS_ENFORCEMENT)).toContain("SELLING_WHAT_IS_ALREADY_FREE");
  });

  it("accepts a DISCLOSED one, because that is a decision and not a fault", () => {
    // Narrowed when a document said plainly that paying unlocks nothing while
    // the checkout stayed open: reporting a disclosed decision on every boot
    // would train whoever reads these logs to ignore them. Driven from the
    // fixture now that the shipped document no longer makes that disclosure.
    process.env.BILLING_PLANS_ON_SALE = "on";
    expect(codes(DENIES_ENFORCEMENT)).not.toContain("SELLING_WHAT_IS_ALREADY_FREE");
  });

  it("reports selling the already-free when the document does NOT disclose it", () => {
    // Which is the shipped document, and is the 2026-11-01 state: plans on
    // sale, section 6 saying the tiers are applied, and nothing applying
    // them. Two codes, because they are fixed separately.
    process.env.BILLING_PLANS_ON_SALE = "on";
    expect(codes()).toEqual([
      "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF",
      "SELLING_WHAT_IS_ALREADY_FREE",
    ]);
  });

  it("does not complain about selling once plans are enforced", () => {
    process.env.BILLING_PLANS_ON_SALE = "on";
    process.env.BILLING_ENFORCEMENT = "on";
    expect(codes(CLAIMS_ENFORCEMENT)).not.toContain(
      "SELLING_WHAT_IS_ALREADY_FREE"
    );
  });

  it("catches the transaction cap being applied while the Terms are silent", () => {
    process.env.BILLING_QUOTA_ENFORCEMENT = "on";
    expect(TERMS.perDayTransactionLimitEnforced).toBe(false);
    expect(codes()).toContain("DAILY_CAP_APPLIED_BUT_TERMS_ARE_SILENT");
  });

  it("says nothing about the cap while it is not applied", () => {
    expect(codes()).not.toContain("DAILY_CAP_APPLIED_BUT_TERMS_ARE_SILENT");
  });

  it("reported the audit's two Priority 1 findings together", () => {
    // The configuration and document as the audit found them, both problems
    // named separately because they are fixed separately. Kept as a
    // regression guard on the check itself.
    process.env.BILLING_PLANS_ON_SALE = "on";
    expect(codes(CLAIMS_ENFORCEMENT)).toEqual([
      "TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF",
      "SELLING_WHAT_IS_ALREADY_FREE",
    ]);
  });

  it("gives every contradiction an actionable remedy, not just a name", () => {
    process.env.BILLING_PLANS_ON_SALE = "on";
    process.env.BILLING_QUOTA_ENFORCEMENT = "on";
    const all = [
      ...billingPolicyContradictions({ terms: CLAIMS_ENFORCEMENT }),
      ...billingPolicyContradictions(),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const { code, detail } of all) {
      expect(detail.length, code).toBeGreaterThan(80);
      // Each one has to say what to DO -- the log is read by somebody
      // choosing between setting a variable and rewriting a document.
      expect(detail, code).toMatch(/set|rewrite|bump|refund|stop/i);
    }
  });
});

// The pure function above is the logic; this is the wiring. They are tested
// separately because a correct function that nothing calls is exactly the
// failure mode this whole check exists to prevent -- the entitlement engine
// was correct and switched off, which is how the audit started.
describe("the contradiction actually reaches a production log", () => {
  const FLAGS = ["BILLING_ENFORCEMENT", "BILLING_PLANS_ON_SALE", "NODE_ENV"];
  const saved = {};

  beforeEach(() => {
    for (const k of FLAGS) saved[k] = process.env[k];
    // reportMissingProductionConfig reports once per process, so the module
    // has to be fresh for each case.
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of FLAGS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  const run = async () => {
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
    const mod = await import("@/lib/security/required-config");
    mod.reportMissingProductionConfig();
    return errors.join("\n");
  };

  // These exercise the SHIPPED document. Since enforcement was switched on
  // (2026-11-10) section 6 describes enforced plans, so the contradicting
  // state is the variable being UNSET -- a deployment that serves this
  // document with the switch forgotten. That is the direction these terms are
  // exposed to, and it is no longer hypothetical: it is the state every
  // environment was in until today, and the state any new environment starts
  // in. The opposite direction is covered above with an injected document.
  it("logs the Terms contradiction in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BILLING_ENFORCEMENT;
    process.env.BILLING_PLANS_ON_SALE = "on";

    const logged = await run();
    expect(logged).toMatch(/BILLING POLICY CONTRADICTS THE PUBLISHED TERMS/);
    expect(logged).toContain("TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF");
  });

  it("logs it for an explicit off as well as a forgotten one", async () => {
    // "off" and unset are the same configuration and must read the same in
    // the log. The 2026-11-01 failure was nine days of unset, so unset is the
    // case that matters most and the one a test is least likely to cover.
    process.env.NODE_ENV = "production";
    process.env.BILLING_ENFORCEMENT = "off";
    process.env.BILLING_PLANS_ON_SALE = "on";

    expect(await run()).toContain("TERMS_CLAIM_ENFORCEMENT_THAT_IS_OFF");
  });

  it("stays silent outside production", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.BILLING_ENFORCEMENT;
    process.env.BILLING_PLANS_ON_SALE = "on";

    expect(await run()).toBe("");
  });

  it("says nothing once the configuration and the Terms agree", async () => {
    // Enforcement on with plans on sale is exactly what section 6 now
    // describes, so a correctly configured deployment of this document is
    // silent -- which is what makes the log worth reading when it is not.
    process.env.NODE_ENV = "production";
    process.env.BILLING_ENFORCEMENT = "on";
    process.env.BILLING_PLANS_ON_SALE = "on";

    expect(await run()).not.toMatch(/CONTRADICTS/);
  });

  it("never prints a value, only a variable name", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BILLING_ENFORCEMENT;
    process.env.BILLING_PLANS_ON_SALE = "on-but-secret-looking";

    const logged = await run();
    expect(logged).toMatch(/CONTRADICTS/);
    expect(logged).not.toContain("on-but-secret-looking");
  });
});

// The development override's own boot report. Its own block because, unlike
// everything above, it must speak OUTSIDE production: the override is used in
// development, where a configuration that silently does nothing is the
// likeliest fault and the one hardest to attribute -- you go on seeing
// padlocks and conclude the application is broken.
describe("the development override's state reaches a log in every environment", () => {
  const FLAGS = [
    "NODE_ENV",
    "VERCEL",
    "VERCEL_ENV",
    "DEV_FEATURE_OVERRIDE",
    "DEV_FEATURE_OVERRIDE_USER_ID",
    "DEV_FEATURE_OVERRIDE_EMAIL",
  ];
  const saved = {};

  beforeEach(() => {
    for (const k of FLAGS) {
      saved[k] = process.env[k];
      if (k !== "NODE_ENV") delete process.env[k];
    }
    // reportDevOverrideState reports once per process too.
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of FLAGS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  const run = async () => {
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
    const mod = await import("@/lib/security/required-config");
    const problems = mod.reportDevOverrideState();
    return { logged: errors.join("\n"), problems };
  };

  it("reports a flag that reached a deployment, in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.DEV_FEATURE_OVERRIDE = "on";

    const { logged, problems } = await run();
    expect(problems.map((p) => p.code)).toContain("DEV_OVERRIDE_ENABLED_ON_VERCEL");
    expect(logged).toMatch(/DEVELOPMENT FEATURE OVERRIDE IS MISCONFIGURED/);
  });

  it("reports a broken override in development, where the other check is silent", async () => {
    // reportMissingProductionConfig returns early outside production. This one
    // must not, or the case it exists for is the case it never covers.
    process.env.NODE_ENV = "development";
    process.env.DEV_FEATURE_OVERRIDE = "on";

    const { logged, problems } = await run();
    expect(problems.map((p) => p.code)).toEqual(["DEV_OVERRIDE_ENABLED_WITHOUT_USER_ID"]);
    expect(logged).toContain("DEV_OVERRIDE_ENABLED_WITHOUT_USER_ID");
  });

  it("says nothing when the override is correctly configured", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_FEATURE_OVERRIDE = "on";
    process.env.DEV_FEATURE_OVERRIDE_USER_ID = "11111111-2222-3333-4444-555555555555";
    process.env.DEV_FEATURE_OVERRIDE_EMAIL = "dev-account@gmail.com";

    const { logged } = await run();
    expect(logged).toBe("");
  });

  it("says nothing when the override is not configured at all", async () => {
    process.env.NODE_ENV = "production";
    const { logged, problems } = await run();
    expect(problems).toEqual([]);
    expect(logged).toBe("");
  });

  it("never prints the configured id or address", async () => {
    // The detail lines name variables. The one exception is the malformed
    // address, which is quoted back because an operator cannot fix a typo they
    // cannot see -- and a malformed address is by definition not an account.
    process.env.NODE_ENV = "production";
    process.env.VERCEL = "1";
    process.env.DEV_FEATURE_OVERRIDE = "on";
    process.env.DEV_FEATURE_OVERRIDE_USER_ID = "11111111-2222-3333-4444-555555555555";
    process.env.DEV_FEATURE_OVERRIDE_EMAIL = "dev-account@gmail.com";

    const { logged } = await run();
    expect(logged).toMatch(/MISCONFIGURED/);
    expect(logged).not.toContain("11111111-2222-3333-4444-555555555555");
    expect(logged).not.toContain("dev-account@gmail.com");
  });

  it("is wired into the startup hook", async () => {
    // A correct check that nothing calls is the failure this file exists to
    // prevent, and instrumentation.js is the only thing that calls either.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../instrumentation.js", import.meta.url),
      "utf8"
    );
    expect(source).toContain("reportDevOverrideState");
    expect(source).toContain("reportMissingProductionConfig");
  });
});
