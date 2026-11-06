import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The checks that check the checks.
//
// `pnpm lint` reported success for the life of this project while examining
// no .jsx file at all: a flat config walks **/*.js unless a config object
// names other extensions, and none did. 183 component files -- effectively
// the whole UI -- were never linted, which is how a file with an unbalanced
// JSX tag passed lint and was caught by the build instead.
//
// A green lint that looks at nothing is worse than no lint, because it is
// believed. This asserts the config still names the extensions it has to.
const WEB = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

describe("the lint step actually covers the codebase", () => {
  const config = read("eslint.config.mjs").replace(/\s+/g, " ");

  it("names .jsx somewhere in a files pattern", () => {
    expect(config).toMatch(/files:\s*\[[^\]]*\*\*\/\*\.jsx/);
  });

  it("still ignores build output rather than linting bundles", () => {
    expect(config).toContain(".next/**");
    expect(config).toContain("node_modules/**");
  });
});

describe("the production build is not quietly skipping checks", () => {
  const next = read("next.config.mjs").replace(/\s+/g, " ");

  it("does not ignore TypeScript or build errors", () => {
    // ESLint during build is deliberately off -- `next lint` cannot read a
    // flat config in Next 15 and linting runs as its own step. Everything
    // else that would let a broken build through must stay off.
    expect(next).not.toMatch(/typescript:\s*\{[^}]*ignoreBuildErrors:\s*true/);
    expect(next).toContain("ignoreDuringBuilds: true");
    expect(next).toContain("Linting runs as its own step");
  });
});
