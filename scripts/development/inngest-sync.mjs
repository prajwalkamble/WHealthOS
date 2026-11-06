// Registers this deployment's background jobs with Inngest.
//
// Why this exists, and why it is not optional.
//
// Inngest does not poll. It holds a registration -- an app URL and the list of
// functions it serves -- and it fires crons and events against THAT. A deploy
// changes the code; it does not change the registration. So a deploy that adds
// a cron, renames a function, or repairs a broken endpoint has no effect at
// all until something syncs.
//
// Normally the Vercel–Inngest integration does that on every deploy. Without
// it, nothing does, and the failure is silent in the worst way: the endpoint
// answers correctly, the dashboard shows an app, and no job ever runs.
//
// That is not hypothetical. Production's crons died on 2026-10-15, when a
// middleware change briefly had Arcjet refuse every request to /api/inngest.
// The middleware was fixed and deployed. The crons stayed dead for three
// weeks, because fixing the endpoint does not re-register the app -- the
// uptime heartbeat, the budget alerts, the monthly reports and the recurring
// transactions were all simply not running.
//
// Usage, from the repository root:
//
//   node scripts/development/inngest-sync.mjs https://www.whealthos.com
//
// or, taking the origin from SITE_URL:
//
//   node --env-file=apps/web/.env scripts/development/inngest-sync.mjs
//
// Idempotent: syncing an already-correct app changes nothing.

const origin =
  process.argv[2] ??
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  null;

if (!origin) {
  console.error(
    "No origin. Pass one as an argument, or set SITE_URL and use --env-file."
  );
  process.exit(1);
}

let base;
try {
  base = new URL(/^https?:\/\//i.test(origin) ? origin : `https://${origin}`).origin;
} catch {
  console.error(`"${origin}" is not a URL.`);
  process.exit(1);
}

// Refusing localhost outright: the Inngest dev server discovers local apps by
// itself, and registering a localhost URL with Inngest Cloud produces an app
// it can never reach -- which looks exactly like the failure this script is
// meant to repair.
if (/\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(base)) {
  console.error(
    `${base} is local. Run \`npx inngest-cli@latest dev\` instead; it finds local apps on its own.`
  );
  process.exit(1);
}

const endpoint = `${base}/api/inngest`;

async function main() {
  // First, is the endpoint even reachable? A 403 here means something in
  // front of the route is refusing it -- the Arcjet matcher is the one that
  // has done this before -- and that is worth saying plainly rather than
  // letting the sync fail with a less specific message.
  const probe = await fetch(endpoint, { method: "GET" });
  if (probe.status === 403) {
    console.error(
      `${endpoint} answered 403 before reaching the handler.\n` +
        "Something in front of the route is blocking it. Check that the\n" +
        "middleware matcher in apps/web/middleware.js still excludes\n" +
        "api/inngest in BOTH patterns -- tests/middleware-matcher.test.js\n" +
        "pins this."
    );
    process.exit(1);
  }

  // 401 is the healthy answer to an unsigned GET once a signing key is set.
  console.log(`${endpoint} is reachable (GET ${probe.status}).`);

  const response = await fetch(endpoint, { method: "PUT" });
  const body = await response.text();

  if (!response.ok) {
    console.error(`Sync failed: HTTP ${response.status}\n${body}`);
    process.exit(1);
  }

  console.log(`Synced: ${body}`);
  console.log(
    "\nCrons schedule from the registration, so the next run is within one\n" +
      "cron interval. The quickest confirmation is the uptime heartbeat,\n" +
      "which writes a row every five minutes:\n\n" +
      '  psql "$DIRECT_URL" -c \'select max(slot) from uptime_checks;\'\n'
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
