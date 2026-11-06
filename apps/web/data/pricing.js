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
// The LIMITS are not. The daily transaction cap is not applied to anybody,
// and the feature ticks are only enforced when BILLING_ENFORCEMENT is on,
// which it is not. Until then every account gets every feature whatever it
// has paid, and the checkout screen says so before taking money.

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

export const PLAN_FAQS = [
  {
    question: "Can I use WHealthOS for free?",
    answer:
      "Yes. The Free plan covers the dashboard, accounts, and up to five transactions a day, with no card required. You can also try everything without an account at all from the demo.",
  },
  {
    question: "Does WHealthOS charge per transaction?",
    answer:
      "No. Plans are a flat monthly price. The only per-transaction figure is the daily cap on how many you can add, which differs by plan.",
  },
  {
    question: "What happens when I reach my daily transaction limit?",
    answer:
      "Nothing already recorded is affected — you simply cannot add more until the next day, or until you move to a plan with a higher cap.",
  },
  {
    question: "What features are included in the Intelligent plan?",
    answer:
      "Everything in Pro, along with the AI work: monthly insights, spending analysis, written summaries, natural-language queries, budget suggestions and recommendations.",
  },
  {
    question: "Can I upgrade or downgrade later?",
    answer:
      "Yes, at any time. An upgrade applies immediately; a downgrade takes effect at the end of the period you have already paid for.",
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
      "Yes, whenever you like. You keep the paid features until the end of the current period, then move to the Free plan — your data stays where it is.",
  },
];
