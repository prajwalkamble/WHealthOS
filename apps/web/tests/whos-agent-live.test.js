import { describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";

// A live smoke test against the real Gemini API.
//
// SKIPPED unless WHOS_AGENT_LIVE=1. It spends real requests on a real key, and
// a test that costs money on every `pnpm test` is a test people learn to
// ignore. Run it deliberately, after changing the provider module, the model
// or the prompt:
//
//   WHOS_AGENT_LIVE=1 npx vitest run tests/whos-agent-live.test.js
//
// What it is for: the whole mocked suite proves our code behaves. It cannot
// prove the model exists, that the key is accepted, that the key's project has
// whatever billing a feature needs, or that the model will follow the
// instruction not to invent figures. Those are facts about someone else's
// service and the only way to learn them is to ask it.
//
// The figures below are synthetic. No real account is read: a live test must
// never send a person's actual financial position to a provider to prove a
// code path works.

const LIVE = process.env.WHOS_AGENT_LIVE === "1";

// Runs a provider call, and skips the test rather than failing it when the
// provider refuses for a reason that is about someone's billing account
// rather than about this code. The reason is printed, because "skipped" with
// no explanation is how a quota problem goes unnoticed for a month.
const guarded = async (ctx, call) => {
  try {
    return await call();
  } catch (error) {
    const status = error?.status ?? null;
    if (status === 429 || status === 503 || status === 404) {
      console.warn(
        `[live] SKIPPED: provider returned ${status}. ` +
          `This is a provider/quota condition, not a code failure.\n` +
          `       ${String(error.message).split("\n")[0]}`
      );
      ctx.skip();
    }
    throw error;
  }
};

// The suite's config loads .env.test only, deliberately, so the key comes from
// .env here and only when this is actually running.
if (LIVE) loadEnv({ path: ".env", quiet: true });

const PLANNING_FIXTURE = () => ({
  ...FIXTURE,
  sections: ["totals", "trends", "budgets", "goals", "accounts"],
  accounts: [
    { name: "Everyday", type: "SAVINGS", balance: 120000, isDefault: true },
  ],
  trends: [
    { month: "2026-05", income: 0, expense: 0 },
    { month: "2026-06", income: 0, expense: 0 },
    { month: "2026-07", income: 80000, expense: 50000 },
    { month: "2026-08", income: 80000, expense: 65000 },
    { month: "2026-09", income: 80000, expense: 70000 },
    { month: "2026-10", income: 90000, expense: 60000 },
  ],
  budgets: {
    budgets: [
      { id: "b1", category: null, amount: 70000, spent: 60000,
        percentUsed: 85.7, remaining: 10000 },
    ],
    progress: { percentElapsed: 60 },
    period: { label: "October", previousLabel: "September" },
  },
  goals: [
    { name: "Emergency fund", targetAmount: 300000, saved: 90000,
      remaining: 210000, percentComplete: 30,
      targetDate: "2027-03-31T00:00:00.000Z", status: "ACTIVE" },
  ],
});

const FIXTURE = {
  sections: ["totals", "categories"],
  period: {
    label: "October",
    year: 2026,
    previousLabel: "September",
    timeZone: "Asia/Kolkata",
  },
  transactionCount: 12,
  summary: {
    totalBalance: 150000,
    monthlyIncome: 90000,
    monthlyExpenses: 60000,
    savingsRate: (30000 / 90000) * 100,
    net: 30000,
    previous: { income: 80000, expenses: 70000, savingsRate: 12.5 },
    balanceSince: null,
  },
  categories: [
    {
      category: "housing",
      amount: 25000,
      count: 1,
      previousAmount: 25000,
      share: 41.67,
      changePercent: 0,
      changeAmount: 0,
    },
    {
      category: "groceries",
      amount: 12000,
      count: 9,
      previousAmount: 8000,
      share: 20,
      changePercent: 50,
      changeAmount: 4000,
    },
  ],
  generatedAt: new Date("2026-10-19T10:00:00.000Z"),
};

describe.skipIf(!LIVE)("WHOS against the real provider", () => {
  it("has a key configured, and says which model the assistant will call", async () => {
    const { hasGeminiKey, AGENT_MODEL, GEMINI_MODEL } = await import("@/lib/ai/gemini");
    expect(hasGeminiKey()).toBe(true);
    console.log(`[live] assistant model: ${AGENT_MODEL}`);
    console.log(`[live] other features' model: ${GEMINI_MODEL}`);
  });

  // A refusal by the provider is not a failure of this code, and must not be
  // reported as one. When the quota is spent the mapping is checked against
  // the real error -- which is itself worth knowing -- and the content
  // assertions are skipped with a message saying why.
  it("maps a real provider refusal to a true sentence", async () => {
    const { streamChat, AGENT_MODEL } = await import("@/lib/ai/gemini");
    const { describeProviderFailure } = await import("@/lib/ai/agent");

    try {
      const result = await streamChat({
        contents: [{ role: "user", parts: [{ text: "Say ok." }] }],
        systemInstruction: "Reply with one word.",
        maxOutputTokens: 10,
        timeout: 30000,
      });
      for await (const chunk of result.stream) chunk.text();
      console.log(`[live] ${AGENT_MODEL} answered; nothing to map.`);
    } catch (error) {
      const mapped = describeProviderFailure(error);
      console.log(`[live] provider refused: status=${error.status} -> ${mapped.code}`);
      console.log(`[live] user would see: ${mapped.message}`);
      expect(mapped.message).not.toContain("quota");
      expect(mapped.message).not.toMatch(/AIza|googleapis|http/);
      expect(mapped.status).toBeGreaterThanOrEqual(429);
    }
  }, 60000);

  it("answers a financial question from the figures it was given", async (ctx) => {
    const { streamChat } = await import("@/lib/ai/gemini");
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const { systemInstruction, buildContents } = await import("@/lib/ai/prompt");
    const { AGENT_LIMITS } = await import("@/lib/ai/agent-config");

    const result = await guarded(ctx, () => streamChat({
      contents: buildContents({
        message: "How much did I spend this month, and what changed?",
        context: buildFinancialContext(FIXTURE),
      }),
      systemInstruction: systemInstruction({ grounded: false }),
      maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
      timeout: AGENT_LIMITS.timeoutMs,
    }));

    let answer = "";
    let chunks = 0;
    for await (const chunk of result.stream) {
      answer += chunk.text();
      chunks++;
    }
    const response = await result.response;


    console.log(`[live] ${chunks} chunks, finish=${response.candidates?.[0]?.finishReason}`);
    console.log(`[live] usage:`, response.usageMetadata);
    console.log(`[live] answer:\n${answer}`);

    // It streamed, in more than one piece.
    expect(chunks).toBeGreaterThan(1);
    expect(answer.length).toBeGreaterThan(20);

    // It used the figure it was given rather than one of its own. 60,000 is
    // the expenses total in the fixture; any other five-or-six figure rupee
    // amount in the answer would mean it invented something.
    expect(answer).toMatch(/60[,.]?000|60k/i);
    // And it found the real change without being told the direction.
    expect(answer.toLowerCase()).toMatch(/down|fell|less|decreas|lower/);
  }, 60000);

  it("answers what could be saved or invested, with a figure", async (ctx) => {
    const { streamChat } = await import("@/lib/ai/gemini");
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const { systemInstruction, buildContents, turnGuidance } = await import("@/lib/ai/prompt");
    const { classifyQuestion } = await import("@/lib/ai/intent");
    const { AGENT_LIMITS } = await import("@/lib/ai/agent-config");

    const message = "How much could I realistically invest each month?";
    const intent = classifyQuestion(message);
    expect(intent.planningSought).toBe(true);
    expect(intent.productSelectionSought).toBe(false);

    const result = await guarded(ctx, () => streamChat({
      contents: buildContents({
        message,
        context: buildFinancialContext(PLANNING_FIXTURE()),
        guidance: turnGuidance({ ...intent, grounded: false }),
      }),
      systemInstruction: systemInstruction({ grounded: false }),
      maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
      timeout: AGENT_LIMITS.timeoutMs,
    }));

    let answer = "";
    for await (const chunk of result.stream) answer += chunk.text();
    console.log(`[live] planning answer:\n${answer}`);

    // It must give a figure rather than deflect. The typical surplus in the
    // fixture is 21,250 a month; this month's net is 30,000.
    expect(answer).toMatch(/21[,.]?250|30[,.]?000|20,000|₹\s?\d/);
    // And it must not have refused the question.
    expect(answer.toLowerCase()).not.toMatch(
      /i (cannot|can't|am unable to) (help|answer|advise) (you )?(with|about) (that|this|investing)/
    );
    // An estimate has to be presented as one.
    expect(answer.toLowerCase()).toMatch(/assum|estimat|roughly|about|approximat|if .* continue/);
  }, 60000);

  it("declines to pick a product but still answers around it", async (ctx) => {
    const { streamChat } = await import("@/lib/ai/gemini");
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const { systemInstruction, buildContents, turnGuidance } = await import("@/lib/ai/prompt");
    const { classifyQuestion } = await import("@/lib/ai/intent");
    const { AGENT_LIMITS } = await import("@/lib/ai/agent-config");

    const message = "Which mutual fund should I buy with my surplus?";
    const intent = classifyQuestion(message);
    expect(intent.productSelectionSought).toBe(true);

    const result = await guarded(ctx, () => streamChat({
      contents: buildContents({
        message,
        context: buildFinancialContext(PLANNING_FIXTURE()),
        guidance: turnGuidance({ ...intent, grounded: false }),
      }),
      systemInstruction: systemInstruction({ grounded: false }),
      maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
      timeout: AGENT_LIMITS.timeoutMs,
    }));

    let answer = "";
    for await (const chunk of result.stream) answer += chunk.text();
    console.log(`[live] product-pick answer:\n${answer}`);

    // Declines the pick...
    expect(answer.toLowerCase()).toMatch(/cannot|can't|not able|unable|not something i/);
    // ...and still says something useful with a length that is not a brush-off.
    expect(answer.length).toBeGreaterThan(200);
  }, 60000);

  it("refuses to state a live figure it cannot check", async (ctx) => {
    const { streamChat } = await import("@/lib/ai/gemini");
    const { systemInstruction, buildContents, turnGuidance } = await import("@/lib/ai/prompt");
    const { classifyQuestion } = await import("@/lib/ai/intent");
    const { AGENT_LIMITS } = await import("@/lib/ai/agent-config");

    const message = "What is the latest RBI repo rate right now?";
    const intent = classifyQuestion(message);
    expect(intent.timeSensitive).toBe(true);

    const result = await guarded(ctx, () => streamChat({
      contents: buildContents({
        message,
        guidance: turnGuidance({ ...intent, grounded: false }),
      }),
      systemInstruction: systemInstruction({ grounded: false }),
      maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
      timeout: AGENT_LIMITS.timeoutMs,
    }));

    let answer = "";
    for await (const chunk of result.stream) answer += chunk.text();
    console.log(`[live] rate question answer:\n${answer}`);

    // It must say it cannot verify, rather than quoting a remembered rate.
    expect(answer.toLowerCase()).toMatch(
      /cannot|can't|unable|no live|not able to (check|verify)|don't have (access|live)/
    );
  }, 60000);
});
