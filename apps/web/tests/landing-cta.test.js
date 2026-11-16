import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  landingActions,
  DASHBOARD_ACTION,
  SIGN_UP_HREF,
  DEMO_HREF,
} from "@/lib/landing/cta";

// The rule itself is a pure function, so most of this file is ordinary unit
// testing. The rest reads source, because the things most likely to go wrong
// here are not logic errors: a third CTA added later that spells the old rule
// out itself, or a well-meaning addition to the middleware that puts the demo
// behind a login. Neither shows up in a unit test of a function nobody called.

const WEB = path.join(process.cwd());
const read = (p) => readFileSync(path.join(WEB, p), "utf8");

describe("what the landing page offers", () => {
  const copy = { signUp: "Get Started", demo: "Explore the live demo" };

  it("offers a visitor both the sign-up and the demo", () => {
    const { primary, secondary } = landingActions(false, copy);

    expect(primary).toEqual({ label: "Get Started", href: "/sign-up" });
    expect(secondary).toEqual({
      label: "Explore the live demo",
      href: "/demo",
    });
  });

  it("sends somebody signed in to their own dashboard instead", () => {
    const { primary } = landingActions(true, copy);

    expect(primary.href).toBe("/dashboard");
    expect(primary.label).toBe("Go to Dashboard");
  });

  it("never offers sign-up to somebody who already has an account", () => {
    const { primary, secondary } = landingActions(true, copy);

    expect(primary.href).not.toBe(SIGN_UP_HREF);
    expect(secondary).toBeNull();
  });

  // Null, specifically: the sections render `{secondary && ...}`, so anything
  // truthy -- an empty object, a disabled action -- would put a button back on
  // the page. This is what keeps the row from holding a gap.
  it("returns no second action at all rather than an empty one", () => {
    const { secondary } = landingActions(true, copy);

    expect(secondary).toBeNull();
    expect(Boolean(secondary)).toBe(false);
  });

  it("lets each section keep its own words for the same destinations", () => {
    const closing = landingActions(false, {
      signUp: "Create your account",
      demo: "Try it without signing up",
    });

    expect(closing.primary.label).toBe("Create your account");
    expect(closing.primary.href).toBe(SIGN_UP_HREF);
    expect(closing.secondary.label).toBe("Try it without signing up");
    expect(closing.secondary.href).toBe(DEMO_HREF);
  });

  // A section's guest copy must not leak into the signed-in case, or the
  // button would read "Create your account" and go to /dashboard.
  it("ignores the section's guest copy once somebody is signed in", () => {
    const { primary } = landingActions(true, {
      signUp: "Create your account",
      demo: "Try it without signing up",
    });

    expect(primary).toEqual(DASHBOARD_ACTION);
  });

  // Anything but a confirmed session is a visitor. The caller resolves the
  // session on the server and passes a boolean; undefined is what a forgotten
  // await looks like, and it must not open the dashboard button.
  it("treats an unresolved session as a visitor, not as signed in", () => {
    for (const value of [undefined, null, 0, ""]) {
      expect(landingActions(value, copy).primary.href).toBe(SIGN_UP_HREF);
    }
  });

  it("does not let a caller mutate the shared dashboard action", () => {
    expect(Object.isFrozen(DASHBOARD_ACTION)).toBe(true);
  });

  // The footer has one button and never had a demo one. Omitting the label
  // has to mean "no second action", not a button reading "undefined".
  it("gives a one-action section no second action, visitor or not", () => {
    expect(landingActions(false, { signUp: "Get Started" }).secondary).toBeNull();
    expect(landingActions(true, { signUp: "Get Started" }).secondary).toBeNull();
  });
});

describe("the sections that use it", () => {
  // Every call to action on a public page. The list is the point: a new one
  // added without the shared rule is the failure these tests exist to catch.
  const SECTIONS = [
    ["hero", "components/hero.jsx"],
    ["final-cta", "components/landing/final-cta.jsx"],
    ["footer", "components/footer.jsx"],
    ["about-hero", "app/(marketing)/about/_components/about-hero.jsx"],
    ["about-cta", "app/(marketing)/about/_components/about-cta.jsx"],
    ["plan-pricing", "app/(marketing)/pricing/_components/plan-pricing.jsx"],
    ["pricing-cta", "app/(marketing)/pricing/_components/pricing-cta.jsx"],
  ].map(([name, file]) => [name, read(file)]);

  // These resolve the session themselves. plan-pricing takes it as a prop
  // from the page, and pricing-cta is a client component on purpose -- it has
  // a third state that depends on localStorage, which no server can see.
  const SERVER_RESOLVED = new Set([
    "hero",
    "final-cta",
    "footer",
    "about-hero",
    "about-cta",
  ]);

  // Sections that render a second action at all. The footer has one button
  // and never had a demo one; pricing-cta builds its guest branches itself.
  const TWO_ACTIONS = new Set([
    "hero",
    "final-cta",
    "about-hero",
    "about-cta",
    "plan-pricing",
  ]);

  it("decide it in one place rather than each on its own", () => {
    for (const [name, source] of SECTIONS) {
      expect(source, `${name} does not use the shared module`).toMatch(
        /from "@\/lib\/landing\/cta"/
      );
    }
  });

  // The actual bug this guards against: a section that keeps its own
  // href="/sign-up" goes on inviting a signed-in reader to make an account.
  it("name neither destination themselves any more", () => {
    for (const [name, source] of SECTIONS) {
      expect(source, `${name} still hard-codes /sign-up`).not.toContain(
        'href="/sign-up"'
      );
      expect(source, `${name} still hard-codes /demo`).not.toContain(
        'href="/demo"'
      );
      expect(source, `${name} still hard-codes /dashboard`).not.toContain(
        'href="/dashboard"'
      );
    }
  });

  it("resolve the session on the server, so there is no state to flash", () => {
    for (const [name, source] of SECTIONS) {
      if (!SERVER_RESOLVED.has(name)) continue;
      expect(source, `${name} does not read auth on the server`).toContain(
        "@clerk/nextjs/server"
      );
      expect(source, `${name} is not a server component`).not.toContain(
        '"use client"'
      );
    }
  });

  it("render the second action conditionally rather than hiding it in CSS", () => {
    for (const [name, source] of SECTIONS) {
      if (!TWO_ACTIONS.has(name)) continue;
      expect(source, `${name} does not drop the second action`).toContain(
        "{secondary && ("
      );
    }
  });

  // pricing-cta keeps a third state the shared rule cannot express: a guest
  // who already has rows in the demo. Asserted so a later tidy-up does not
  // quietly flatten it into the first-visit case.
  it("keeps the pricing page's guest-mid-demo state", () => {
    const [, source] = SECTIONS.find(([name]) => name === "pricing-cta");

    expect(source).toContain("Back to your demo");
    expect(source).toContain("DEMO_STORAGE_KEY");
  });
});

describe("the demo the hidden button points at", () => {
  it("stays public: hiding an invitation is not the same as locking a door", () => {
    const middleware = read("middleware.js");
    const protectedList = middleware.slice(
      middleware.indexOf("const isProtectedRoute"),
      middleware.indexOf("])", middleware.indexOf("const isProtectedRoute"))
    );

    // Proves we are reading the list and not an empty slice -- without this
    // the assertion below would pass just as happily on "".
    expect(protectedList).toContain('"/dashboard(.*)"');
    expect(protectedList).not.toContain("/demo");
  });

  // The reason an authenticated reader can still open /demo safely, asserted
  // rather than assumed: nothing under it can reach the database at all.
  // A server action or a prisma import appearing here later is the moment
  // real figures could land in the sample dashboard.
  it("cannot reach real data, because it has no way to ask for any", () => {
    const root = path.join(WEB, "app/demo");
    const walk = (dir) =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    const files = walk(root);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const where = path.relative(WEB, file);

      expect(source, `${where} imports server actions`).not.toMatch(
        /from "@\/actions\//
      );
      expect(source, `${where} imports prisma`).not.toMatch(
        /from "@\/lib\/prisma"/
      );
      expect(source, `${where} reads the session`).not.toMatch(
        /from "@clerk\//
      );
    }
  });
});
