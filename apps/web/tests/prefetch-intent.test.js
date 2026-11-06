import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HOVER_DELAY_MS,
  isPrefetchable,
} from "@/components/navigation/use-prefetch-intent";

// Predictive prefetching, asserted where it can be asserted.
//
// isPrefetchable and the delay are real unit tests -- the guard is a pure
// function and the whole feature's blast radius depends on it. Everything
// below them is a source assertion, in the idiom of billing-checkout.test.js,
// because this package runs vitest with environment: "node" and has no DOM,
// no @testing-library and no renderer. What a render test would check here --
// that a hover produces one request and a pointer passing by produces none --
// is a network fact, verified against a production build with the browser's
// own inspector; see docs/prefetching.md.
//
// These guard the decisions rather than the implementation: that nothing
// fetches without intent, that the expensive page and the checkout page are
// opted out, and that a failed prefetch cannot reach the user.
const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const flat = (relative) => read(relative).replace(/\s+/g, " ");

const HOOK = "components/navigation/use-prefetch-intent.js";
const LINK = "components/navigation/prefetch-link.jsx";
const SIDEBAR = "components/app-sidebar.jsx";
const PLAN_CARD = "app/(main)/settings/_components/plan-card.jsx";
const PRICING = "app/(marketing)/pricing/_components/pricing-plans.jsx";
const CONFIG = "next.config.mjs";

describe("which destinations may be prefetched at all", () => {
  it("accepts an ordinary internal path", () => {
    expect(isPrefetchable("/dashboard")).toBe(true);
    expect(isPrefetchable("/account/abc123")).toBe(true);
    expect(isPrefetchable("/billing?plan=pro&duration=monthly")).toBe(true);
  });

  it("refuses a hash link, which is a scroll and not a navigation", () => {
    // The marketing header is full of these -- "/#features" and friends.
    expect(isPrefetchable("/#features")).toBe(false);
    expect(isPrefetchable("/pricing#faq")).toBe(false);
  });

  it("refuses another origin, including the protocol-relative form", () => {
    expect(isPrefetchable("https://razorpay.com")).toBe(false);
    expect(isPrefetchable("http://localhost:3000/dashboard")).toBe(false);
    // Begins with a slash and looks local; the browser reads it as a host.
    expect(isPrefetchable("//evil.example")).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    expect(isPrefetchable({ pathname: "/dashboard" })).toBe(false);
    expect(isPrefetchable(undefined)).toBe(false);
    expect(isPrefetchable(null)).toBe(false);
    expect(isPrefetchable("")).toBe(false);
    expect(isPrefetchable("dashboard")).toBe(false);
  });

  it("waits 120ms before believing a hover", () => {
    expect(HOVER_DELAY_MS).toBe(120);
  });
});

describe("nothing fetches without intent", () => {
  const link = flat(LINK);

  it("turns Next's viewport prefetch off until the hook arms it", () => {
    // "shell" is the only tier that leaves the prop undefined, which is how
    // Next spells its own default. The others start at false.
    expect(link).toContain(
      'const prefetch = intent === "shell" ? undefined : warm.armed;'
    );
    expect(link).toContain("prefetch={prefetch}");
  });

  it("attaches intent handlers only on the tier that warms a destination", () => {
    for (const handler of [
      "onPointerEnter",
      "onPointerLeave",
      "onTouchStart",
      "onFocus",
    ]) {
      expect(link).toContain(`intent === "full" ? warm.${handler} : null`);
    }
  });

  it("keeps the caller's own handlers working", () => {
    expect(link).toContain("theirs?.(event)");
  });

  it("forwards a ref, because the sidebar renders it through Radix Slot", () => {
    expect(link).toContain("forwardRef");
    expect(link).toContain("ref={ref}");
  });
});

describe("the hook cannot leak, loop or surface a failure", () => {
  const hook = read(HOOK);

  it("clears a pending timer when the pointer leaves", () => {
    expect(hook).toContain("onPointerLeave: cancel");
    expect(hook).toContain("clearTimeout(timer.current)");
  });

  it("clears a pending timer on unmount", () => {
    expect(hook).toContain("useEffect(() => cancel, [cancel])");
  });

  it("latches, so repeated hovers cost nothing", () => {
    expect(hook).toContain("if (latched.current) return;");
  });

  it("does not make a touch wait for the hover delay", () => {
    expect(hook).toMatch(/pointerType === "touch"\)\s*return;/);
    expect(hook).toContain("const onTouchStart = useCallback(() => arm(), [arm]);");
  });

  it("swallows a prefetch failure both ways it can arrive", () => {
    // A rejected promise and a synchronous throw. Navigation must still work.
    expect(hook).toContain("pending.catch(() => {})");
    expect(hook).toMatch(/\}\s*catch\s*\{/);
  });

  it("never writes a prefetched payload anywhere persistent", () => {
    expect(hook).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
  });
});

describe("the expensive and the irreversible are opted out", () => {
  const sidebar = flat(SIDEBAR);

  it("gives analytics the shell and not the figures", () => {
    // getAnalytics runs requireFeatureInAction behind a paid-feature gate and
    // reads up to 24 months. A hover must not do that.
    expect(sidebar).toContain(
      '{ title: "Analytics", url: "/analytics", icon: BarChart3, intent: "shell" }'
    );
  });

  it("still lists every section, and all of them through PrefetchLink", () => {
    for (const url of [
      "/dashboard",
      "/transactions",
      "/accounts",
      "/cards",
      "/budgets",
      "/goals",
      "/analytics",
      "/settings",
    ]) {
      expect(sidebar).toContain(`url: "${url}"`);
    }
    expect(sidebar).toContain("<PrefetchLink href={item.url} intent={item.intent}>");
    expect(sidebar).not.toContain("<Link ");
  });

  it("never warms the checkout page", () => {
    // /billing is where a payment starts. It is reached deliberately or not
    // at all -- prefetching it is read-only, but it is also the one route
    // where a request nobody asked for is worth refusing on principle.
    expect(flat(PLAN_CARD)).toContain(
      '<PrefetchLink href={checkoutUrl(plan.id, interval)} intent="none">'
    );
    expect(flat(PRICING)).toMatch(
      /<PrefetchLink href=\{checkoutUrl\(plan\.id, period\)\} intent="none"/
    );
  });
});

describe("the client cache window is deliberate", () => {
  const config = read(CONFIG);

  it("reuses a prefetched page for 30s and no longer", () => {
    // Next 15 defaults dynamic to 0, which would throw away a payload fetched
    // on hover before the click arrived. 30s covers hover-then-click and a
    // glance back; it is short enough that no figure goes visibly stale.
    expect(config).toMatch(/staleTimes:\s*\{\s*dynamic:\s*30,\s*static:\s*180,\s*\}/);
  });

  it("does not raise it to the five minutes the static default allows", () => {
    expect(config).not.toMatch(/dynamic:\s*(300|600|1800)/);
  });
});
