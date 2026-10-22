// What WHOS is allowed to cost, and what it is allowed to reach.
//
// Every number here is a ceiling rather than a target, and every one is
// settable from the environment, because the right value depends on a billing
// account this repository cannot see. The defaults are chosen to be cheap: a
// conversational turn on this model costs money per token in and per token
// out, and the two things that actually drive the bill are how much history
// is resent and how long an answer is allowed to run.
//
// Nothing here is a subscription entitlement. WHealthOS has plan *marketing*
// (data/pricing.js) and no plan enforcement anywhere in the codebase -- there
// is no plan column, no entitlement table and no payment integration -- so
// inventing per-plan AI quotas here would be inventing a product decision.
// This is one server-side policy that applies to every signed-in account, and
// the place a real entitlement lookup would be wired in later is marked below.

const positiveInt = (raw, fallback) => {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const AGENT_LIMITS = Object.freeze({
  // One question. Long enough for a real multi-part question, short enough
  // that a pasted document cannot be laundered through the endpoint.
  maxMessageChars: positiveInt(process.env.WHOS_AGENT_MAX_MESSAGE_CHARS, 1000),

  // How many earlier messages travel with the question. This is the follow-up
  // budget: "what about last month?" needs the turn before it, and little
  // else. Counted in messages, so 8 is four exchanges.
  maxHistoryMessages: positiveInt(process.env.WHOS_AGENT_MAX_HISTORY, 8),

  // A second ceiling on history, in characters, because a long assistant
  // answer can be worth more tokens than four short ones. Whichever bites
  // first wins.
  maxHistoryChars: positiveInt(process.env.WHOS_AGENT_MAX_HISTORY_CHARS, 6000),

  // The answer length. The assistant is asked to be concise and this is what
  // makes that binding rather than aspirational.
  maxOutputTokens: positiveInt(process.env.WHOS_AGENT_MAX_OUTPUT_TOKENS, 900),

  // How long the provider gets before the request is abandoned. A chat that
  // hangs holds a serverless invocation open, so this is deliberately shorter
  // than the platform's own limit.
  timeoutMs: positiveInt(process.env.WHOS_AGENT_TIMEOUT_MS, 45_000),

  // Requests per hour per signed-in account, enforced by Arcjet in
  // lib/arcjet.js. Low by default: this is the only control standing between
  // a stuck client and an unbounded bill.
  requestsPerHour: positiveInt(process.env.WHOS_AGENT_REQUESTS_PER_HOUR, 30),
  // The burst a fresh account may spend before the refill rate governs.
  burst: positiveInt(process.env.WHOS_AGENT_BURST, 10),
});

// Google Search grounding, off unless an operator turns it on.
//
// Off is the honest default for three separate reasons, all verified rather
// than assumed:
//
//   1. The installed SDK (@google/generative-ai 0.21.0) types the grounding
//      tool as `googleSearchRetrieval`, which is the Gemini 1.5 shape. Newer
//      models expect `googleSearch` instead and reject the old one. The shape
//      is therefore settable below rather than hard-coded, and neither has
//      been confirmed against the model this project runs.
//   2. Grounding bills as a billable search per request on Google's paid
//      tier and is not available at all on some unpaid projects.
//   3. Sending a question to a search tool sends it outside the model, which
//      is a privacy change an operator should make knowingly.
//
// When it is off, a time-sensitive question is answered with an explicit
// statement that the figure could not be verified live -- never with the
// model's own recollection presented as current. See lib/ai/prompt.js.
export const SEARCH_GROUNDING = Object.freeze({
  enabled: process.env.WHOS_AGENT_SEARCH_GROUNDING === "on",
  // "retrieval" -> { googleSearchRetrieval: {} }  (Gemini 1.5 era)
  // "search"    -> { googleSearch: {} }           (Gemini 2.0 and later)
  shape: process.env.WHOS_AGENT_SEARCH_TOOL === "retrieval" ? "retrieval" : "search",
});

// The tool list for a grounded request, or undefined for an ungrounded one.
//
// The object is built by hand rather than taken from an SDK constant because
// the SDK's type only covers the older shape; the SDK serialises whatever it
// is given, so the newer one passes through unchanged.
export function groundingTools() {
  if (!SEARCH_GROUNDING.enabled) return undefined;
  return SEARCH_GROUNDING.shape === "retrieval"
    ? [{ googleSearchRetrieval: {} }]
    : [{ googleSearch: {} }];
}

// Where a subscription entitlement would be read, once one exists.
//
// Returns the single policy above for every account today. It is a function
// rather than a bare object so that adding a real lookup later is a change
// to one body, not to every call site.
export async function agentPolicyFor(_userId) {
  return AGENT_LIMITS;
}
