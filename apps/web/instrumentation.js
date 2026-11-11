// Next's startup hook. Called once per server process, before the first
// request is served.
//
// It exists for one thing: saying out loud what the configuration gets wrong.
// See lib/security/required-config.js for why that is a log and not a throw.
export async function register() {
  // The Node runtime only. The edge runtime has a different environment and
  // nothing here applies to it.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { reportMissingProductionConfig, reportDevOverrideState } = await import(
    "./lib/security/required-config.js"
  );

  // Production only, by its own early return.
  reportMissingProductionConfig();

  // Every environment, deliberately: the development override is a thing that
  // can be silently broken in development and has no business being set in a
  // deployment, and both of those are worth a line at boot.
  reportDevOverrideState();
}
