// Which of the caller's own records a question needs, decided in application
// code before the model is involved.
//
// Why a classifier here instead of giving the model tools to call
// ---------------------------------------------------------------
// Gemini supports function calling, and the obvious design is to hand it a
// set of read-only financial tools and let it choose. That was rejected for
// this MVP on three counts:
//
//   1. Cost. Tool calling is at least two round trips per question -- one to
//      decide, one to answer -- and the context is resent on the second. It
//      roughly doubles the price of every financial question.
//   2. Attack surface. If the model chooses what to load, then text the model
//      has read can influence that choice. Here the choice is made from the
//      user's own message by code that cannot be talked into anything, and
//      the loader is scoped to the caller by RLS regardless.
//   3. Testability. This file is a pure function. Tool selection by a model
//      is not something a unit test can pin down.
//
// What it costs us: a question phrased in a way no keyword below matches
// loads the default set rather than exactly the right set. That is a wrong
// amount of context, never someone else's context, and the system prompt
// requires the assistant to say when it has not been given what it needs
// rather than fill the gap in.

// The loadable sections. Each maps to a block of the caller's own data in
// lib/queries.js -> getAgentFinancialContext.
export const SECTIONS = Object.freeze({
  TOTALS: "totals",
  ACCOUNTS: "accounts",
  CATEGORIES: "categories",
  TRENDS: "trends",
  BUDGETS: "budgets",
  GOALS: "goals",
});

// Loaded when a question is clearly about this person's money but matches
// nothing more specific. Income, expenses and the month-on-month comparison
// answer more questions than anything else and are three aggregate rows.
const DEFAULT_SECTIONS = [SECTIONS.TOTALS, SECTIONS.CATEGORIES];

// Everything, for a question that asks for an overall picture.
const EVERYTHING = Object.values(SECTIONS);

// A word boundary that treats an apostrophe as part of a word, so "month's"
// does not match on "month" twice and "don't" is one token.
const words = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9₹%'-]+/)
    .filter(Boolean);

const has = (tokens, ...needles) => needles.some((n) => tokens.includes(n));

const phrase = (text, ...needles) => {
  const haystack = String(text ?? "").toLowerCase();
  return needles.some((n) => haystack.includes(n));
};

// Does this question concern the person asking it, rather than the world?
// "How much did I spend" is theirs; "what is inflation" is not. Possessives
// are the strongest signal and the cheapest to detect.
const SELF = ["i", "my", "mine", "me", "we", "our", "us", "i'm", "i've"];

// Money vocabulary. A self-reference alone is not enough -- "explain
// compound interest to me" is a general question with "me" in it.
const MONEY = [
  "spend", "spent", "spending", "spends", "expense", "expenses", "expenditure",
  "income", "earn", "earned", "earning", "earnings", "salary", "paid", "pay",
  "balance", "balances", "money", "cash", "savings", "save", "saved", "saving",
  "budget", "budgets", "goal", "goals", "account", "accounts", "transaction",
  "transactions", "afford", "overspending", "overspend", "net", "surplus",
  "deficit", "finances", "financial", "position", "worth", "outgoings",
  "bills", "cost", "costs", "category", "categories",
];

// Openings that mark a question about the world rather than about the person
// asking. Needed because financial vocabulary alone is not the signal: "what
// are the current income tax slabs" contains "income" and is not about anyone's
// records, while "which expense categories increased the most" contains no
// first-person word at all and is entirely about them.
const GENERAL_OPENERS = [
  "what is ", "what's ", "what are ", "what're ", "whats ",
  "explain ", "define ", "describe ",
  "how does ", "how do ", "how is ", "how are ", "why does ", "why do ",
  "why is ", "tell me about ", "what does ", "meaning of ",
];

const SECTION_WORDS = {
  [SECTIONS.ACCOUNTS]: [
    "account", "accounts", "balance", "balances", "bank", "worth", "across",
    "total", "have", "holding", "holdings", "liquid",
  ],
  [SECTIONS.CATEGORIES]: [
    "category", "categories", "where", "what", "biggest", "largest", "most",
    "breakdown", "going", "goes", "increased", "increase", "decreased",
    "decrease", "rose", "grew", "top", "driver", "drivers", "unusual",
    "groceries", "housing", "rent", "food", "transport", "transportation",
    "utilities", "entertainment", "shopping", "healthcare", "education",
    "travel", "insurance", "bills", "personal", "gifts",
  ],
  [SECTIONS.TRENDS]: [
    "trend", "trends", "month", "months", "monthly", "last", "previous",
    "compare", "compared", "comparison", "history", "over", "since",
    "pattern", "patterns", "increased", "increase", "changed", "change",
    "average", "typical", "usually",
  ],
  [SECTIONS.BUDGETS]: [
    "budget", "budgets", "limit", "limits", "cap", "overspending",
    "overspend", "overbudget", "allowance", "track", "pace",
  ],
  [SECTIONS.GOALS]: [
    "goal", "goals", "target", "targets", "saving", "savings", "save",
    "saved", "objective", "fund", "emergency",
  ],
  [SECTIONS.TOTALS]: [
    "spend", "spent", "spending", "income", "earn", "earned", "net",
    "savings", "rate", "surplus", "deficit", "much", "total", "this",
    "summary", "summarise", "summarize", "overview",
  ],
};

// Phrases that ask for the whole picture rather than one figure.
const OVERVIEW = [
  "summarize my finances", "summarise my finances", "summary of my finances",
  "financial position", "financial summary", "overall picture", "how am i doing",
  "my finances", "financial health", "overview of my", "full picture",
  "where do i stand", "state of my finances",
];

// Questions whose answer changes faster than a model's training data, where
// answering from recollection would be presenting a stale number as a fact.
//
// Deliberately narrow. "What is inflation" is a concept and is answered from
// model knowledge; "what is the current inflation rate" is a reading and is
// not. The distinction is the one the brief draws, and it is drawn here by
// requiring a currency-of-information word alongside the topic.
const LIVE_TOPICS = [
  "rbi", "repo rate", "policy rate", "interest rate", "interest rates",
  "exchange rate", "exchange rates", "usd", "dollar", "sensex", "nifty",
  "stock market", "share price", "gold rate", "gold price", "fd rate",
  "mutual fund", "nav", "inflation rate", "cpi", "tax slab", "tax slabs",
  "income tax", "gst", "budget 2025", "budget 2026", "news", "ipo",
  "market", "markets", "bond yield", "ppf rate", "epf rate",
];

const LIVE_NOW = [
  "current", "currently", "latest", "today", "now", "this week",
  "right now", "live", "recent", "recently", "up to date", "updated",
  "present", "at the moment", "as of",
];

// Planning: what someone could put aside or invest, given what they actually
// earn and spend. This is answerable -- the surplus is in their records and
// is already calculated -- and it is most of what anyone wants to ask.
//
// Kept separate from product selection below, because the two used to be one
// list and the result was an assistant that refused "how much could I invest
// each month?" on the strength of the word "invest". That is the question,
// not the thing to decline.
const PLANNING = [
  "save", "saving", "savings", "set aside", "put aside", "afford",
  "invest", "investing", "investment", "investments", "sip",
  "emergency fund", "rainy day", "retirement", "retire", "nest egg",
  "corpus", "surplus", "spare", "left over", "leftover", "cushion",
  "build up", "grow my money", "put away",
];

// The part that must be declined however it is asked: picking an instrument,
// ranking providers, or predicting what a market will do. Narrow on purpose.
// Everything NOT on this list that mentions investing is a planning question
// and gets answered from their figures.
const PRODUCT_SELECTION = [
  "which stock", "what stock", "which mutual fund", "which fund",
  "what fund should", "which scheme", "which policy", "which bank",
  "best stock", "best fund", "best mutual fund", "best investment",
  "best scheme", "best sip", "recommend a stock", "recommend a fund",
  "recommend an investment", "should i buy shares", "should i buy stock",
  "should i sell", "is it a good time to buy", "will the market",
  "will stocks", "guaranteed return", "guaranteed returns",
  "double my money", "beat the market", "hot tip", "multibagger",
];

// What the model is being asked to do with this message.
//
// `sections` is the only field with authority over what data is read; it is
// an array of SECTIONS values and nothing else, so an unexpected value can
// never widen a query.
export function classifyQuestion(message) {
  const text = String(message ?? "");
  const tokens = words(text);

  const selfReferential = has(tokens, ...SELF) || phrase(text, "my ");
  const financialVocabulary = has(tokens, ...MONEY);

  // Asking what they could put aside or invest. Recognised even without a
  // first-person word ("how much is safe to invest each month"), because the
  // question is inherently about the person asking it.
  //
  // Declared here, above aboutOwnFinances, because that is where it is first
  // used -- a `const` referenced earlier in the same scope is a temporal dead
  // zone error, which throws at the first question rather than failing a
  // check somewhere visible.
  const planning = has(tokens, ...PLANNING) || phrase(text, ...PLANNING);

  // Asked as a question about the world: "what is...", "explain...", "how
  // does... work". A self-reference overrides it, because "how does inflation
  // affect my savings" is both -- and the half that mentions their savings is
  // the half worth answering with their figures.
  const generalKnowledge =
    !selfReferential && GENERAL_OPENERS.some((opener) => text.toLowerCase().trimStart().startsWith(opener));

  // About this person's records.
  //
  // Financial vocabulary is required either way: a question with none of it
  // cannot be about their money, and loading figures for it would cost tokens
  // and send data for nothing. Beyond that, a first-person reference settles
  // it, and otherwise anything that is not phrased as a general-knowledge
  // question is treated as being about them -- which is the right way round
  // to be wrong. Answering "which categories went up most?" with no figures
  // is useless; loading a few aggregates for a question that turned out to be
  // general costs one cheap query the person already had access to.
  const aboutOwnFinances =
    (financialVocabulary || planning) && (selfReferential || !generalKnowledge);

  const timeSensitive =
    phrase(text, ...LIVE_TOPICS) &&
    (phrase(text, ...LIVE_NOW) || phrase(text, "what is the", "what's the"));

  const sections = new Set();

  if (aboutOwnFinances) {
    if (phrase(text, ...OVERVIEW)) {
      for (const section of EVERYTHING) sections.add(section);
    } else {
      for (const [section, keywords] of Object.entries(SECTION_WORDS)) {
        if (has(tokens, ...keywords)) sections.add(section);
      }
      // Nothing matched, or only a vague match: fall back rather than asking
      // the model to answer a question about money with no figures.
      if (sections.size === 0) {
        for (const section of DEFAULT_SECTIONS) sections.add(section);
      }
    }

    // Planning -- what could be saved, set aside or invested. Capacity is
    // income against expenses against commitments, measured over more than
    // one month, with whatever is already committed to a goal and whatever is
    // already held. On keywords alone this reads as a goals question, which
    // would leave out every figure that actually answers it.
    if (planning) {
      sections.add(SECTIONS.TOTALS);
      sections.add(SECTIONS.TRENDS);
      sections.add(SECTIONS.BUDGETS);
      sections.add(SECTIONS.GOALS);
      sections.add(SECTIONS.ACCOUNTS);
    }
  }

  return {
    aboutOwnFinances,
    generalKnowledge,
    timeSensitive,
    // Answerable from their records, and the thing this feature is for.
    planningSought: planning && (selfReferential || !generalKnowledge),
    // Not answerable by anyone honestly, and declined in one sentence.
    productSelectionSought: phrase(text, ...PRODUCT_SELECTION),
    // Sorted so the value is stable for a cache key and for a test.
    sections: EVERYTHING.filter((section) => sections.has(section)),
  };
}
