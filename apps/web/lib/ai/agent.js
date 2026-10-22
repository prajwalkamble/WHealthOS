// One conversational turn of WHOS, end to end.
//
// The flow, and where each guarantee comes from:
//
//   classify (lib/ai/intent.js)        -- app code decides what data is needed
//   load     (lib/queries.js)          -- RLS scopes it to the signed-in person
//   build    (lib/ai/context.js)       -- app code does every calculation
//   prompt   (lib/ai/prompt.js)        -- the model is told what it may claim
//   stream   (lib/ai/gemini.js)        -- one provider call, no retries
//
// The caller (app/api/ai/chat/route.js) has already authenticated the person
// and spent their rate limit. This module reads records and calls a model; it
// writes nothing, anywhere, and is deliberately given no way to.

import {
  AGENT_LIMITS,
  SEARCH_GROUNDING,
  agentPolicyFor,
  groundingTools,
} from "@/lib/ai/agent-config";
import { buildFinancialContext } from "@/lib/ai/context";
import { AGENT_MODEL, hasGeminiKey, streamChat } from "@/lib/ai/gemini";
import { classifyQuestion } from "@/lib/ai/intent";
import { buildContents, systemInstruction, turnGuidance } from "@/lib/ai/prompt";
import { getAgentFinancialContext } from "@/lib/queries";

// Raised for a condition the person should be told about in plain words. Any
// other throw is logged and reported generically, because its message can
// carry provider, query or key detail.
export class AgentError extends Error {
  constructor(message, { code = "AGENT_ERROR", status = 400 } = {}) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
  }
}

// Provider failures, mapped to something true and actionable.
//
// Each branch is a different operational fault with a different fix, and
// collapsing them into "the assistant is unavailable" is what made the
// monthly insights fail silently for months. None of these messages contains
// a stack trace, a key, a model name or an internal path.
export function describeProviderFailure(error) {
  const status = error?.status ?? error?.response?.status ?? null;
  const text = String(error?.message ?? "");

  if (error?.name === "AbortError") {
    return new AgentError("The answer was stopped.", {
      code: "ABORTED",
      status: 499,
    });
  }
  if (status === 429 || /quota|rate limit|resource_exhausted/i.test(text)) {
    return new AgentError(
      "WHOS - Financial Intelligence has reached its usage limit with the AI provider for now. Please try again later.",
      { code: "PROVIDER_QUOTA", status: 429 }
    );
  }
  if (status === 401 || status === 403 || /api key|permission|unauthenticated/i.test(text)) {
    return new AgentError(
      "WHOS - Financial Intelligence is not configured correctly on the server, so it cannot answer right now. Nothing is wrong with your account.",
      { code: "PROVIDER_AUTH", status: 503 }
    );
  }
  if (status === 404 || /not found|is not supported/i.test(text)) {
    return new AgentError(
      "WHOS - Financial Intelligence cannot reach the AI model it is configured to use. This needs a change on the server.",
      { code: "PROVIDER_MODEL", status: 503 }
    );
  }
  if (status === 400 && /billing|billed users|free tier/i.test(text)) {
    return new AgentError(
      "WHOS - Financial Intelligence needs billing enabled on the server's AI project before it can answer.",
      { code: "PROVIDER_BILLING", status: 503 }
    );
  }
  if (status === 503 || status === 500 || /timeout|timed out|deadline/i.test(text)) {
    return new AgentError(
      "The AI provider did not answer in time. Please try again in a moment.",
      { code: "PROVIDER_UNAVAILABLE", status: 503 }
    );
  }
  return new AgentError(
    "WHOS - Financial Intelligence could not answer that just now. Please try again.",
    { code: "PROVIDER_FAILED", status: 502 }
  );
}

// Sources Google actually returned, never sources we assembled. An entry
// without a usable URI is dropped rather than shown with a placeholder.
export function citationsFrom(response) {
  const metadata = response?.candidates?.[0]?.groundingMetadata;
  const chunks = metadata?.groundingChunks ?? [];

  const seen = new Set();
  const out = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ uri, title: chunk.web.title || new URL(uri).hostname });
    if (out.length >= 6) break;
  }
  return out;
}

// Why an answer stopped, when it stopped for a reason worth telling someone.
//
// MAX_TOKENS matters: a truncated answer looks like a complete one, and a
// figure cut off mid-sentence is worse than no figure. SAFETY and RECITATION
// mean the model declined, which must not be dressed up as a failure.
export function truncationNote(response) {
  const reason = response?.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") {
    return "That answer was cut short because it reached its length limit. Ask for a specific part of it and I can go into more detail.";
  }
  if (reason === "SAFETY" || reason === "RECITATION" || reason === "BLOCKLIST") {
    return "I stopped that answer part way through. Try rephrasing the question.";
  }
  return null;
}

// Runs a turn, yielding events as they happen.
//
//   { type: "meta",  ... }  once, before the model is called
//   { type: "delta", text } zero or more times, as the answer arrives
//   { type: "done",  ... }  once, on success
//
// A failure throws an AgentError, which the route turns into a message. The
// generator yields meta first so the browser can show what the answer is
// being based on before any text exists.
export async function* runAgentTurn({ message, history = [], userId, signal }) {
  if (!hasGeminiKey()) {
    throw new AgentError(
      "WHOS - Financial Intelligence is not available: this deployment has no AI provider configured.",
      { code: "NOT_CONFIGURED", status: 503 }
    );
  }

  const limits = await agentPolicyFor(userId);
  const intent = classifyQuestion(message);
  const grounded = SEARCH_GROUNDING.enabled;

  // Only the sections the question needs, and nothing at all for a general
  // question. A conversation about compound interest never touches the
  // database.
  const data = intent.sections.length
    ? await getAgentFinancialContext(intent.sections)
    : null;
  const context = data ? buildFinancialContext(data) : null;

  yield {
    type: "meta",
    // What this answer is based on, so the UI can be specific instead of
    // claiming the assistant "analysed your finances".
    sections: intent.sections,
    usedRecords: Boolean(context),
    dataReadAt: data?.generatedAt?.toISOString() ?? null,
    period: data?.period?.label ?? null,
    grounded,
    // True when the person asked for something live and this deployment
    // cannot check it. The UI says so next to the answer rather than relying
    // only on the model having followed its instruction.
    liveInfoUnavailable: intent.timeSensitive && !grounded,
  };

  const contents = buildContents({
    message,
    history,
    context,
    guidance: turnGuidance({ ...intent, grounded }),
  });

  let result;
  try {
    result = await streamChat({
      contents,
      systemInstruction: systemInstruction({ grounded }),
      tools: groundingTools(),
      maxOutputTokens: limits.maxOutputTokens,
      signal,
      timeout: limits.timeoutMs,
    });
  } catch (error) {
    // Logged without the prompt: the request body is this person's financial
    // position and has no business in a production log.
    console.error({
      code: "WHOS_AGENT_PROVIDER_FAILED",
      details: { model: AGENT_MODEL, status: error?.status ?? null, grounded },
    });
    throw describeProviderFailure(error);
  }

  let produced = 0;
  try {
    for await (const chunk of result.stream) {
      if (signal?.aborted) break;
      const text = chunk.text();
      if (!text) continue;
      produced += text.length;
      yield { type: "delta", text };
    }
  } catch (error) {
    // A failure part way through a stream. If nothing has been shown yet it
    // is an ordinary failure; if text is already on screen, saying "that
    // failed" under a half-written answer is more confusing than stopping.
    if (produced === 0) {
      console.error({
        code: "WHOS_AGENT_STREAM_FAILED",
        details: { model: AGENT_MODEL, status: error?.status ?? null },
      });
      throw describeProviderFailure(error);
    }
    yield {
      type: "done",
      citations: [],
      note: "The connection dropped part way through that answer.",
      truncated: true,
    };
    return;
  }

  const response = await result.response.catch(() => null);

  // An empty answer is a failure, not an answer. Returning nothing would
  // leave an empty bubble on screen that looks like the assistant ignored
  // the question.
  if (produced === 0) {
    const blocked = response?.promptFeedback?.blockReason;
    throw new AgentError(
      blocked
        ? "I could not answer that one. Try rephrasing it."
        : "WHOS - Financial Intelligence returned an empty answer. Please try again.",
      { code: blocked ? "BLOCKED" : "EMPTY", status: 502 }
    );
  }

  yield {
    type: "done",
    citations: grounded ? citationsFrom(response) : [],
    note: truncationNote(response),
    truncated: response?.candidates?.[0]?.finishReason === "MAX_TOKENS",
  };
}
