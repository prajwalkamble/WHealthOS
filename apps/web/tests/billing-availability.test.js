import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canSell,
  checkoutAvailability,
  describeUnavailability,
  publicAvailability,
} from "@/lib/billing/availability";

const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

const KEYS = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  "RAZORPAY_PLAN_PRO_MONTHLY",
  "RAZORPAY_PLAN_PRO_YEARLY",
  "RAZORPAY_PLAN_INTELLIGENT_MONTHLY",
  "RAZORPAY_PLAN_INTELLIGENT_YEARLY",
  "NODE_ENV",
];

const ID = "rzp_test_0000000000000";
let saved;

const configureEverything = () => {
  process.env.RAZORPAY_KEY_ID = ID;
  process.env.RAZORPAY_KEY_SECRET = "secret";
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = ID;
  process.env.RAZORPAY_PLAN_PRO_MONTHLY = "plan_a";
  process.env.RAZORPAY_PLAN_PRO_YEARLY = "plan_b";
  process.env.RAZORPAY_PLAN_INTELLIGENT_MONTHLY = "plan_c";
  process.env.RAZORPAY_PLAN_INTELLIGENT_YEARLY = "plan_d";
};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  configureEverything();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("a fully configured deployment", () => {
  it("is ready and sells every plan", () => {
    const state = checkoutAvailability();
    expect(state.ready).toBe(true);
    expect(state.missing).toEqual([]);
    expect(state.anyPlanSellable).toBe(true);

    for (const planId of ["pro", "intelligent"]) {
      for (const interval of ["monthly", "yearly"]) {
        expect(canSell(publicAvailability(), planId, interval), `${planId} ${interval}`).toBe(
          true
        );
      }
    }
  });
});

// The bug this file exists for: with nothing configured, the pricing page
// offered a live-looking button that failed with "Payments are not available
// just now." -- a sentence identical for five different causes and useful for
// none of them.
describe("an unconfigured deployment names what is missing", () => {
  it("reports every absent variable rather than the first", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

    const state = checkoutAvailability();
    expect(state.ready).toBe(false);
    expect(state.missing).toEqual(
      expect.arrayContaining([
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
        "NEXT_PUBLIC_RAZORPAY_KEY_ID",
      ])
    );
  });

  it("sells nothing when the gateway is not configured, however many plans are", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const state = checkoutAvailability();
    expect(state.anyPlanSellable).toBe(false);
    expect(canSell(publicAvailability(), "pro", "monthly")).toBe(false);
  });

  it("catches a published key id belonging to another account", () => {
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_test_9999999999999";
    const state = checkoutAvailability();
    expect(state.ready).toBe(false);
    expect(state.mismatched).toBe(true);
    expect(describeUnavailability()).toMatch(/does not match/);
  });

  it("marks only the plans that have no Razorpay Plan behind them", () => {
    delete process.env.RAZORPAY_PLAN_PRO_MONTHLY;
    const available = publicAvailability();

    expect(canSell(available, "pro", "monthly")).toBe(false);
    // And does not take the others down with it.
    expect(canSell(available, "pro", "yearly")).toBe(true);
    expect(canSell(available, "intelligent", "monthly")).toBe(true);
  });
});

describe("what reaches the browser", () => {
  it("names the missing configuration outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.RAZORPAY_KEY_SECRET;

    const available = publicAvailability();
    expect(available.ready).toBe(false);
    expect(available.developmentHint).toContain("RAZORPAY_KEY_SECRET");
  });

  // Variable names are not secrets -- they are in .env.example, which is in
  // version control -- but there is no reason to narrate this deployment's
  // configuration to every visitor either.
  it("says nothing about the configuration in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_KEY_SECRET;

    const available = publicAvailability();
    expect(available.ready).toBe(false);
    expect(available.developmentHint).toBeNull();
  });

  it("never carries a secret, in any environment", () => {
    for (const env of ["development", "production"]) {
      process.env.NODE_ENV = env;
      const serialised = JSON.stringify(publicAvailability());
      expect(serialised).not.toContain("secret");
      expect(serialised).not.toContain(ID);
    }
  });

  it("treats an absent availability as 'assume it works'", () => {
    // Only the case in a render with no page behind it -- a test, or a story.
    expect(canSell(null, "pro", "monthly")).toBe(false);
  });
});

describe("a button that cannot work does not look like one that can", () => {
  const plans = read("app/(marketing)/pricing/_components/pricing-plans.jsx");

  it("disables a plan this deployment cannot sell", () => {
    expect(plans).toContain("canSell(availability");
    expect(plans).toContain("Not available yet");
  });

  // The guarantee these two used to make, in the shape it now takes.
  //
  // Both were about the pricing page opening a payment window itself: one that
  // a link naming an unconfigured plan must not pop an error toast on arrival,
  // the other that a failed click must not leave ?plan=pro in the address bar
  // as a shareable link to a checkout nobody can reach. Neither can happen
  // now -- the pricing CTA is a <Link>, so the URL IS the navigation and
  // nothing opens on arrival. What replaced them is the review page refusing
  // to offer a plan this deployment cannot sell.
  it("does not offer a plan the deployment cannot sell, however it was reached", () => {
    const page = read("app/(checkout)/billing/page.jsx");
    expect(page).toContain("publicAvailability()");
    expect(page).toMatch(/state === "unavailable"/);
    expect(page).toMatch(/is not available yet/);
    // ...and it resolves that on the server, with the catalogue, rather than
    // letting the button find out by failing.
    expect(page).toContain("checkoutState({ userId, planId: plan, interval, availability })");
  });

  it("checks it again on the server when the button is actually pressed", () => {
    // The plan could be disabled between the page rendering and the click.
    // gatewayReady() answers 503 before a body is even read, and
    // resolvePurchase() refuses a plan with no provider id after that.
    const route = read("app/api/billing/checkout/route.js");
    expect(route).toContain("gatewayReady()");
    const service = read("lib/billing/service.js");
    expect(service).toContain("resolvePurchase(planId, interval)");
    expect(service).toContain("PLAN_UNAVAILABLE");
  });

  it("uses the same source of truth on every surface that sells", () => {
    // Was asserted against /pricing until the paid plans were discontinued.
    // That page no longer offers to sell anything, so the surfaces left are
    // Settings and the checkout page itself.
    const settings = read("app/(main)/settings/page.jsx");
    expect(settings).toContain("publicAvailability()");
    const billing = read("app/(checkout)/billing/page.jsx");
    expect(billing).toContain("publicAvailability()");
  });

  it("is not consulted by the pricing page, which sells nothing", () => {
    // The replacement for the assertion above, and the stronger half of it:
    // a free page that still read the billing configuration would be a free
    // page one commit away from offering a plan again.
    const page = read("app/(marketing)/pricing/page.jsx");
    expect(page).not.toContain("publicAvailability");
    expect(page).not.toContain("canSell");
    expect(page).not.toContain("checkoutUrl");
  });
});

describe("the refusal explains itself", () => {
  it("names the cause in the server log and, outside production, in the response", () => {
    const http = read("lib/billing/http.js");
    expect(http).toContain("describeUnavailability");
    expect(http).toContain('process.env.NODE_ENV === "production" ? {} : { detail: reason }');
  });

  it("tells the operator which variable to set when the public key is missing", () => {
    const hook = read("components/billing/use-checkout.js");
    expect(hook).toContain("NEXT_PUBLIC_RAZORPAY_KEY_ID is not set");
    expect(hook).toContain("restart the dev server");
  });
});
