// The pricing page's content, kept apart from its layout so the plans and the
// comparison table can be edited without touching the markup.
//
// NOTE on what is real here, because the two halves differ.
//
// The PRICES are real. Razorpay Plans exist at these rupee figures, the paid
// CTAs link to /billing, and a subscription taken there renews and can be
// cancelled. lib/billing/plans.js derives the amount charged from the
// `monthly` values below, so editing one of them changes what somebody pays
// -- and will disagree with the Razorpay Plan until that is updated too.
//
// The LIMITS depend on configuration, and this comment deliberately no longer
// asserts which way it is set -- it said "which it is not" while .env said
// otherwise, which sent the 2026-11-10 audit looking in the wrong place.
//
// The feature ticks are enforced only when BILLING_ENFORCEMENT is "on"; the
// daily cap only when BILLING_QUOTA_ENFORCEMENT is. With either unset, every
// account gets that much whatever it has paid, and /pricing, /billing and the
// Settings plan card all say so before taking money. To read the live answer
// rather than a comment: enforcementEnabled() in lib/billing/entitlements.js
// and quotaEnforcementEnabled() in lib/billing/quota.js.

export const BILLING_PERIODS = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly", note: "Save 20%" },
];

export const YEARLY_DISCOUNT = 0.2;

export const PLANS = [
  {
    id: "free",
    name: "Free",
    tagline: "Start managing your finances.",
    monthly: 0,
    cta: { label: "Create Free Account", href: "/sign-up" },
    limit: "5 per day",
    dailyTransactions: 5,
    accent: "neutral",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Take control of your complete finances.",
    monthly: 399,
    cta: { label: "Start with Pro", href: "/sign-up" },
    limit: "15 per day",
    dailyTransactions: 15,
    accent: "blue",
    popular: true,
  },
  {
    id: "intelligent",
    name: "Intelligent",
    tagline: "Understand your finances with AI-powered insights.",
    monthly: 699,
    cta: { label: "Get Intelligent", href: "/sign-up" },
    limit: "Higher / Unlimited",
    dailyTransactions: null,
    accent: "violet",
  },
];

// The highlighted row above the grouped features: a value per plan rather than
// a tick, so it is called out on its own.
// `limit` is the string the pricing table prints; `dailyTransactions` is the
// number the server enforces, and null means no cap. They are two fields on
// purpose: parsing a number back out of marketing copy would make a reworded
// cell silently change what people are allowed to do, and
// tests/usage-quota.test.js asserts the two still say the same thing.
//
// null for Intelligent reads "Higher / Unlimited" literally as unlimited.
// That is the only reading that cannot under-serve somebody who has paid, but
// it IS an interpretation of ambiguous copy -- see docs/billing.md.
export const HEADLINE_FEATURE = {
  icon: "CalendarClock",
  label: "Transactions per day",
  description: "Number of transactions you can add daily.",
};

// Each row lists the plans that include it. Anything absent shows a dash.
//
// `key` is the entitlement key the backend authorises against
// (lib/billing/entitlements.js). It is here rather than in a second list so
// the thing a visitor is shown and the thing the server enforces cannot drift
// apart: this table IS the feature matrix, and tests/entitlements.test.js
// fails if a feature appears without a key or two features share one.
//
// Changing a key is a breaking change. Changing a label is not.
export const FEATURE_GROUPS = [
  {
    title: "Core Finance Management",
    features: [
      {
        icon: "LayoutDashboard",
        key: "dashboard.basic",
        label: "Basic dashboard",
        hint: "Balances, income, spending and savings rate at a glance.",
        plans: ["free", "pro", "intelligent"],
      },
      {
        icon: "FileText",
        key: "transactions.manage",
        label: "Add and manage transactions",
        hint: "Record income and expenses, edit them, and delete in bulk.",
        plans: ["free", "pro", "intelligent"],
      },
      {
        icon: "Wallet",
        key: "accounts",
        label: "Accounts",
        hint: "Track current and savings accounts separately.",
        plans: ["free", "pro", "intelligent"],
      },
      {
        icon: "CreditCard",
        key: "cards",
        label: "Cards & wallet",
        hint: "Keep your cards alongside the accounts they draw on.",
        plans: ["free", "pro", "intelligent"],
      },
      {
        icon: "BarChart3",
        key: "overview.basic",
        label: "Basic financial overview",
        hint: "Monthly totals and a six-month cash-flow chart.",
        plans: ["free", "pro", "intelligent"],
      },
    ],
  },
  {
    title: "Financial Planning",
    features: [
      {
        icon: "PiggyBank",
        key: "budgets",
        label: "Budgets",
        hint: "Set a monthly limit and get alerted before you pass it.",
        plans: ["pro", "intelligent"],
      },
      {
        icon: "Target",
        key: "goals",
        label: "Goals",
        hint: "Put money aside towards something and watch it build.",
        plans: ["pro", "intelligent"],
      },
      {
        icon: "ChartPie",
        key: "analytics",
        label: "Analytics",
        hint: "Break spending down by category and compare months.",
        plans: ["pro", "intelligent"],
      },
    ],
  },
  {
    title: "Global & Data",
    features: [
      {
        icon: "Globe",
        key: "currency.multi",
        label: "Multi-currency support",
        hint: "Hold and report on balances in more than one currency.",
        plans: ["pro", "intelligent"],
      },
      {
        icon: "Download",
        key: "data.export",
        label: "Data export",
        hint: "Take everything with you as CSV whenever you want.",
        plans: ["pro", "intelligent"],
      },
    ],
  },
  {
    title: "Customization",
    features: [
      {
        icon: "Palette",
        key: "theme.toggle",
        label: "Theme toggle (light/dark)",
        hint: "Switch between light, dark and your system setting.",
        plans: ["free", "pro", "intelligent"],
      },
      {
        icon: "LayoutGrid",
        key: "dashboard.customize",
        label: "Dashboard customization",
        hint: "Choose the layout and how the shell is arranged.",
        plans: ["pro", "intelligent"],
      },
      {
        icon: "Paintbrush",
        key: "appearance.customize",
        label: "Appearance customization (colors, typography, charts)",
        hint: "Theme colour, chart palette, fonts, scale and corner radius.",
        plans: ["pro", "intelligent"],
      },
    ],
  },
  {
    title: "AI & Insights",
    features: [
      // Receipt scanning, added to this table on 2026-11-10 and Intelligent
      // from the start of the same day.
      //
      // It had no row here at all until then, and no entitlement key: it has
      // sent photos to Gemini since before plans existed, behind a session and
      // an Arcjet token bucket and nothing else -- not granted, not denied,
      // never considered. The pricing table was the only surface silent about
      // it; data/landing.js advertises it, lib/legal/terms.js lists it among
      // what the service does, and lib/legal/ai.js documents what it sends and
      // what it gets wrong.
      //
      // It was published free-on-every-plan for the length of one commit,
      // because that is what the running product did. The operator's rule is
      // the one that decides it instead: AI functionality belongs to
      // Intelligent, and a plan below it ends at the customisation features.
      // Receipt scanning reaches a model, so it is in this group and it is
      // Intelligent-only, like every other row here.
      //
      // That takes a working feature away from accounts that have it, which is
      // the thing section 6 of the Terms promises notice of first. The notice
      // is the version dated 2026-11-10, which is also the day enforcement was
      // switched on -- so it goes with the rest rather than arriving as a
      // separate surprise later.
      //
      // Unlike the other six, this one has its own surface and therefore its
      // own gate: actions/transaction.js, before the image is read and before
      // the model is called. tests/entitlement-coverage.test.js asserts the
      // gate is in that file and that no model call site is left without one.
      {
        icon: "ScanLine",
        key: "ai.receipts",
        label: "Receipt scanning",
        hint: "Photograph a receipt and have the amount, date, merchant and category read into a draft you confirm.",
        plans: ["intelligent"],
      },
      {
        icon: "Sparkles",
        key: "ai.insights",
        label: "AI financial insights",
        hint: "A monthly read on what changed and why.",
        plans: ["intelligent"],
      },
      {
        icon: "MessageSquare",
        key: "ai.spending",
        label: "AI spending analysis",
        hint: "Patterns in your spending, picked out for you.",
        plans: ["intelligent"],
      },
      {
        icon: "FileBarChart",
        key: "ai.summaries",
        label: "Personalized financial summaries",
        hint: "A written summary of your month, sent by email.",
        plans: ["intelligent"],
      },
      {
        icon: "Lightbulb",
        key: "ai.queries",
        label: "Natural-language financial queries",
        hint: "Ask about your money in plain words.",
        plans: ["intelligent"],
      },
      {
        icon: "Wand2",
        key: "ai.budgeting",
        label: "AI-assisted budgeting",
        hint: "Budget suggestions based on what you actually spend.",
        plans: ["intelligent"],
      },
      {
        icon: "Brain",
        key: "ai.recommendations",
        label: "Smart recommendations",
        hint: "Practical next steps, not generic advice.",
        plans: ["intelligent"],
      },
    ],
  },
  {
    title: "Support",
    features: [
      {
        icon: "Headphones",
        key: "support.priority",
        label: "Priority support",
        hint: "Your questions answered ahead of the queue.",
        plans: ["pro", "intelligent"],
      },
    ],
  },
];

// Two sets, because there are two pricing pages and the switch between them
// is plansAreOnSale() in lib/billing/availability.js.
//
// They cannot be merged. "Can I upgrade or downgrade later?" has no answer
// when there is one plan, and "what happened to the Pro plan?" has no answer
// when it is on the page above. Whichever set is wrong for the current state
// would be the most confident wrong thing on the page, so the page picks.
export const FREE_FAQS = [
  {
    question: "Is WHealthOS really free?",
    answer:
      "Yes. There is one plan, it costs nothing, and it includes everything — budgets, goals, analytics, exports and the AI features included. No card is asked for at any point.",
  },
  {
    question: "What happened to the Pro and Intelligent plans?",
    answer:
      "They are discontinued. Everything they used to unlock is open to every account instead. Nothing was taken away from anybody in the process — the plans stopped being a gate, not a feature set.",
  },
  {
    question: "Is there a limit on how many transactions I can add?",
    answer:
      "Not one that depends on what you pay, which is what the old per-plan daily caps were. Practical limits may still apply to keep the service healthy for everybody.",
  },
  {
    question: "Can I try it without creating an account?",
    answer:
      "Yes. The demo runs on sample data entirely in your browser — nothing is saved, no account is created and no email is asked for. It is the \u201cTry it (Sample Data!)\u201d button above.",
  },
  {
    question: "I subscribed before the plans were discontinued. What now?",
    answer:
      "You are not being charged for something nobody else pays for. A subscription that is still active can be cancelled from Settings, and anything charged for a feature that is now free is refunded in full — the Terms have said so for as long as the checkout has existed.",
  },
  {
    question: "Will it stay free?",
    answer:
      "It is free for now, and that is the honest answer rather than a promise about next year. If it ever changes it will be said plainly and in advance, and it will not be done by quietly locking a feature you already use. Your data remains yours and exportable either way.",
  },
  {
    question: "Is the AI financial advice?",
    answer:
      "No. The insights describe your own spending and suggest things to look at. They are not regulated financial advice, and you should speak to a qualified adviser before any significant decision.",
  },
  {
    question: "Do I have to self-host to get the free version?",
    answer:
      "No. This is the hosted service and it is the free one. There is no separate paid edition with more in it.",
  },
];

// Rewritten 2026-11-10, twice. First because three of these answers described
// a per-day cap that nothing applies and a fourth promised an upgrade that
// "applies immediately" through a plan switch that does not exist -- S5 and S3
// in the subscription audit (docs/testing/). Then again, later the same day,
// when BILLING_ENFORCEMENT was switched on and the two answers that said
// nothing was withheld from the free plan stopped being true.
//
// The rule survives both edits and is the thing to keep: an answer to a direct
// question is a statement about what happens, so it may not assert a mechanism
// that does not run -- and may not deny one that does. The comparison table
// above is allowed to describe what the plans are INTENDED to separate; an
// answer is not.
//
// Both halves are live at once right now, which is why these answers read the
// way they do. Feature tiers ARE enforced: a free account no longer has
// budgets, goals, analytics, export, customisation or the AI features. The
// transactions-per-day figures are NOT applied -- that is
// BILLING_QUOTA_ENFORCEMENT, a separate switch, still off -- so an answer that
// describes reaching a daily limit would be describing nothing.
//
// tests/pricing-copy.test.js holds these to it, with each assertion tied to
// the mechanism rather than to the wording.
export const PLAN_FAQS = [
  {
    question: "Can I use WHealthOS for free?",
    answer:
      "Yes. The free plan needs no card at any point and keeps the core of the product: your accounts, transactions, cards, the dashboard and the financial overview, with no limit on how much you record. Budgets, goals, analytics, data export and the customisation settings are on Pro. Everything that uses AI — including reading a receipt from a photo — is on Intelligent. You can also try the whole application, paid features included, without an account at all from the demo.",
  },
  {
    question: "Does WHealthOS charge per transaction?",
    answer:
      "No. A plan is a flat monthly or yearly price, and nothing is charged per transaction, per account or per export.",
  },
  {
    question: "What are the transactions-per-day figures in the table?",
    answer:
      "What each plan is meant to allow if those limits are ever applied. They are not applied to anyone today — every account can add as many transactions as it needs. If that changes, it will be said in advance and in a new version of the Terms, which already commit us to telling you first.",
  },
  {
    question: "What features are included in the Intelligent plan?",
    answer:
      "Everything in Pro, and all of the AI work: monthly insights, spending analysis, written summaries, natural-language queries, budget suggestions, recommendations, and reading a receipt from a photo. Anything that sends your figures or an image to a model is on this plan and no other — Pro stops at the customisation settings.",
  },
  {
    question: "Can I move between the paid plans later?",
    // Upwards, yes, in one step. Downwards, still not -- and the answer says
    // which is which rather than "you can change plans", because the two go
    // through completely different routes and take different amounts of time.
    //
    // Note what it does not promise: that the upgrade is immediate. It lands
    // at the end of the period already paid for, which for a yearly
    // subscriber can be months away, and an answer that said "you can upgrade
    // any time" would be read as "and have it today". The previous version of
    // this answer was written to replace exactly that kind of sentence.
    answer:
      "You can move up to a higher plan in one step, from Settings. It takes effect at the end of the period you have already paid for: nothing is charged on the day you ask, you keep the plan you are on until then, and the new price is charged when the subscription next renews. Moving down to a lower plan, or changing between monthly and yearly, still takes two steps — cancel the subscription you have, keep it to the end of the paid period, then subscribe again on what you want. That asymmetry is deliberate: we do not calculate part-period refunds, so a move down cannot be done without one.",
  },
  {
    question: "Is AI financial advice?",
    answer:
      "No. The insights describe your own spending and suggest things to look at. They are not regulated financial advice, and you should speak to a qualified adviser before any significant decision.",
  },
  {
    question: "Are there any setup fees?",
    answer: "None. You pay the plan price and nothing else.",
  },
  {
    question: "Can I cancel my subscription?",
    answer:
      "Yes, whenever you like, from Settings. It runs to the end of the period you have already paid for — the paid features stay available until then and stop when it ends — and your data stays exactly where it is either way. Nothing you created on a paid plan is deleted; a budget or a goal you can no longer open is still there if you subscribe again.",
  },
];
