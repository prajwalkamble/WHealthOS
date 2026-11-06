import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PRICING_ICONS } from "@/app/(marketing)/pricing/_components/pricing-icons";
import { FEATURE_GROUPS, HEADLINE_FEATURE } from "@/data/pricing";

const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
// Source with its comments removed. Both files explain in prose why the
// namespace import is wrong, and a comment saying so must not count as the
// code doing it.
const code = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// Every icon the pricing table asks for, from the content file itself.
const named = [
  HEADLINE_FEATURE.icon,
  ...FEATURE_GROUPS.flatMap((group) => group.features.map((feature) => feature.icon)),
].filter(Boolean);

describe("the pricing table's icons", () => {
  // The point of this file. The map is explicit so that the whole icon
  // library is not pulled into the bundle, and the cost of being explicit is
  // that it can fall behind the content. This is what stops that being a
  // silent fallback to a circle.
  it("has every icon data/pricing.js names", () => {
    const missing = named.filter((name) => !PRICING_ICONS[name]);
    expect(
      missing,
      `add these to app/(marketing)/pricing/_components/pricing-icons.js: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("has nothing it does not need", () => {
    const unused = Object.keys(PRICING_ICONS).filter((name) => !named.includes(name));
    expect(unused, `unused icons still being imported: ${unused.join(", ")}`).toEqual([]);
  });

  it("maps each name to something renderable", () => {
    for (const name of named) {
      const icon = PRICING_ICONS[name];
      expect(["function", "object"], `${name} is not a component`).toContain(typeof icon);
    }
  });

  // The regression this exists to prevent. `import * as icons from
  // "lucide-react"` needs the whole namespace object at runtime, so neither
  // tree-shaking nor Next's optimizePackageImports can trim it -- it made this
  // one route's JavaScript 172 kB against 200 B for comparable pages.
  it("does not reach for the library's namespace", () => {
    const plans = code("app/(marketing)/pricing/_components/pricing-plans.jsx");
    expect(plans).not.toMatch(/import \* as .* from ["']lucide-react["']/);

    const icons = code("app/(marketing)/pricing/_components/pricing-icons.js");
    expect(icons).not.toMatch(/import \* as/);
    // Named imports only, which is what optimizePackageImports can rewrite.
    expect(icons).toMatch(/^import \{/m);
  });
});
