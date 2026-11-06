import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // Build output and generated code are not ours to lint. Without this,
    // `eslint .` reports hundreds of violations from compiled bundles.
    ignores: [
      ".next/**",
      ".next-build/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      // Written by scripts/build-brand-assets.mjs, not by hand. It is one
      // base64 blob; there is nothing in it for a linter to have an opinion
      // about.
      "lib/brand/raster.generated.mjs",
    ],
  },
  ...compat.extends("next/core-web-vitals"),

  // Lint .jsx at all.
  //
  // `eslint .` with a flat config only walks **/*.js unless a config object
  // names other extensions, and nothing here did -- so for the life of this
  // project the lint step checked 458 .js files and none of the ~200 .jsx
  // ones, which is to say none of the components. It reported success while
  // a file with an unbalanced JSX tag sat in components/, and the build was
  // what caught it.
  {
    files: ["**/*.jsx", "**/*.mjs"],
  },
];

export default eslintConfig;
