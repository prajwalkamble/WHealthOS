// Copies the Prisma query engine into the web app, before `next build`.
//
// The engine is a native binary that Prisma opens by path at runtime, and it
// is generated into the database package (database/generated/client) because
// that package owns the schema. In a deployed Vercel function that directory
// is the wrong side of a boundary: the function's cwd is /var/task/apps/web,
// and Prisma only looks in
//
//   <cwd>/generated/client        <- this is where we put it
//   <cwd>/.next/server
//   <generate-time absolute path> <- /vercel/path0/..., gone at runtime
//   <cwd>/.prisma/client
//   /tmp/prisma-engines
//
// so a copy anywhere else is invisible to it, however faithfully the bundler
// carried it along. Tracing the file out of the database package did get it
// into the deployment and did not help, because the path it landed on was
// /var/task/database/generated/client, which is not on that list.
//
// Staging rather than moving: database/generated/client stays authoritative,
// database/index.js still imports from it, and this copy exists only so the
// engine sits where Prisma will look for it. apps/web/generated/ is build
// output and is not in version control.
//
// Only the engine binaries and the schema are copied. The JavaScript client
// is already imported normally through @whealthos/database, so the bundler
// handles it; it is the binary beside it that nothing knows to carry.

import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "..", "..", "..", "database", "generated", "client");
const target = path.join(here, "..", "generated", "client");

let entries;
try {
  entries = await readdir(source);
} catch {
  // Failing loudly here is the point. The alternative is a build that
  // succeeds and a deployment where every database call dies at startup
  // with "could not locate the Query Engine" -- which is exactly the
  // failure this script exists to prevent, and it is invisible until
  // production serves a request.
  console.error(
    `\nstage-prisma-engine: no generated client at ${source}\n` +
      `Run \`pnpm db:generate\` (or any install, via postinstall) first.\n`
  );
  process.exit(1);
}

const wanted = entries.filter(
  (name) => name.endsWith(".so.node") || name === "schema.prisma"
);

const engines = wanted.filter((name) => name.endsWith(".so.node"));
if (engines.length === 0) {
  console.error(
    `\nstage-prisma-engine: ${source} holds no query engine binary.\n` +
      `Check binaryTargets in database/prisma/schema.prisma.\n`
  );
  process.exit(1);
}

await mkdir(target, { recursive: true });
for (const name of wanted) {
  await cp(path.join(source, name), path.join(target, name));
}

console.log(
  `stage-prisma-engine: staged ${wanted.join(", ")} -> apps/web/generated/client`
);
