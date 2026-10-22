import { GoogleGenerativeAI } from "@google/generative-ai";

// The one place the model is named. The receipt scanner and the monthly
// insights each hard-coded "gemini-1.5-flash"; when Google retired it both
// broke at once, and the insights quietly fell back to the same canned text
// every month. Change the model here and nowhere else.
//
// The default is split out from the export so an operator can override it per
// deployment (GEMINI_MODEL) without editing code -- a model this project does
// not control can be retired on Google's schedule, not ours. The default is
// what the audit in lib/legal/ai.js records, and tests/ai-usage.test.js reads
// DEFAULT_GEMINI_MODEL out of this file to keep the two in step. An override
// is an operator decision and is deliberately not published as a fact.
export const DEFAULT_GEMINI_MODEL = "gemini-4-argon";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

// WHOS runs on its own model, and on a deliberately cheaper one.
//
// The two original features make one call each, on a photo or once a month.
// The assistant is a conversation: several calls per sitting, each resending
// the last few turns, which makes it the only feature here whose cost scales
// with how much people like it. A Flash-Lite model is the cost-efficient
// choice and is what this is set to.
//
// It is also the only model on this project's key that currently answers.
// Verified on 2026-10-19 by listing the models the key can reach and calling
// them: gemini-4-argon above is served but its free-tier quota is zero
// ("limit: 0"), so it answers only on a billed project, and the pinned 2.5
// Flash models return "no longer available to new users". An alias rather
// than a pinned version for exactly the reason the comment above describes --
// a retired model took out both features at once -- at the cost that Google
// can move what it points at without telling us.
export const DEFAULT_AGENT_MODEL = "gemini-flash-lite-latest";

export const AGENT_MODEL = process.env.WHOS_AGENT_MODEL || DEFAULT_AGENT_MODEL;

// Whether a key is configured at all. Callers check this instead of letting
// the SDK fail with a provider error that says nothing useful to a user: a
// missing key is a deployment mistake, not a transient fault, and the two
// deserve different messages.
export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 503 ("model is currently experiencing high demand") is routine and clears
// within seconds. Without a retry, one of them on the 1st of the month sends
// the fallback insights, which is indistinguishable from the model being gone.
// 429 is deliberately not retried: it means a quota is spent (the free tier
// allows 20 requests a day per model), and retrying a second later only burns
// time. Anything else -- a bad key, a missing model -- also fails immediately.
const RETRYABLE_STATUS = new Set([500, 503]);
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateContent(request) {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await model.generateContent(request);
      return result.response.text();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !RETRYABLE_STATUS.has(error.status)) {
        throw error;
      }
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

// A streamed multi-turn generation, for WHOS.
//
// Deliberately NOT built on generateContent above, for three reasons:
//
//   1. No retries. A conversational turn that fails is retried by the person,
//      who can see it failed; retrying automatically multiplies the API
//      charge for a request nobody is waiting on any more.
//   2. It needs the parts generateContent does not pass -- a system
//      instruction, a tool list, a generation config and a per-request
//      timeout -- and widening generateContent's signature would change a
//      function two working features depend on.
//   3. It returns the stream and the final response separately, because the
//      citations only exist on the final response and the text has to start
//      arriving before that resolves.
//
// `signal` aborts the client's wait. Google's own SDK documents that this
// does not cancel the work server-side and does not refund the usage, which
// is why the stop button in the UI is described as stopping the answer rather
// than stopping the cost.
export async function streamChat({
  contents,
  systemInstruction,
  tools,
  maxOutputTokens,
  temperature = 0.4,
  signal,
  timeout,
}) {
  const model = genAI.getGenerativeModel({
    model: AGENT_MODEL,
    systemInstruction,
    ...(tools ? { tools } : {}),
    generationConfig: { maxOutputTokens, temperature },
  });

  return model.generateContentStream({ contents }, { signal, timeout });
}
