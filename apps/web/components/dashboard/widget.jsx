import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// The anatomy every dashboard widget shares: a header strip holding the title
// and at most one small action, divided from the body by a hairline. Keeping
// every card on the same bones -- same padding, same title size, same rule --
// is most of what makes a dashboard read as designed rather than assembled.

export const Widget = ({ className, children, ...props }) => (
  <section
    className={cn(
      "flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
      className
    )}
    {...props}
  >
    {children}
  </section>
);

export const WidgetHeader = ({ title, action, className, children }) => (
  <header
    className={cn(
      "flex min-h-14 items-center justify-between gap-3 border-b px-5 py-3",
      className
    )}
  >
    <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
      {title}
    </h2>
    <div className="shrink-0">{action ?? children}</div>
  </header>
);

export const WidgetContent = ({ className, children }) => (
  <div className={cn("flex-1 p-5", className)}>{children}</div>
);

export const WidgetFooter = ({ className, children }) => (
  <footer className={cn("border-t px-5 py-3 text-sm", className)}>
    {children}
  </footer>
);

// Below this a change is treated as no change, so a rounding artefact does not
// render as a trend. Shared with the label so the two cannot drift apart.
const FLAT_BELOW = 0.05;

// Above this a percent change is written as a multiplier instead.
const MULTIPLIER_ABOVE = 100;

// How a change is written on a badge.
//
// A percent change has no ceiling. Spending 4.94 times last month's total is
// +394%, which is arithmetically correct and still the wrong thing to print:
// a bare "394%" sitting beside a rupee figure reads as a share of something,
// and nothing on this dashboard is 394% of anything. Past a doubling the
// ratio states the same fact more plainly, so anything above +100% becomes a
// multiplier and no percentage over 100 is ever shown.
//
// Opt in with `multiplier`, because most values here should not take it. A
// savings rate's change is a difference in percentage points rather than a
// ratio, so 150 of them are not 2.5× of anything; a balance is read as growth
// against the 1st, and one that crosses zero has no sensible multiple at all.
// Only a flow compared with the same flow last month -- what the expenses
// card shows -- is a ratio that stays meaningful once it passes a doubling.
export const trendLabel = (value, { suffix = "%", multiplier = false } = {}) => {
  if (!Number.isFinite(value) || Math.abs(value) < FLAT_BELOW) return `0${suffix}`;

  if (multiplier && value > MULTIPLIER_ABOVE) {
    const times = 1 + value / 100;
    if (times >= 1000) return ">999×";
    return times < 100 ? `${times.toFixed(1)}×` : `${Math.round(times)}×`;
  }

  // A fall is bounded at -100% for any quantity that cannot go negative, so
  // these stay percentages; only a balance crossing zero reaches past it.
  const magnitude = Math.abs(value);
  if (magnitude > 999) return `>999${suffix}`;
  if (magnitude >= 100) return `${Math.round(magnitude)}${suffix}`;
  return `${magnitude.toFixed(1)}${suffix}`;
};

// A change as an outlined pill -- "↗ 12.5%", or "↗ 4.9×" for a caller that asked
// for `multiplier` -- coloured by whether the direction is good news. goodWhenUp
// is false for things like expenses.
export const TrendBadge = ({ value, goodWhenUp = true, suffix = "%", multiplier = false, className }) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground",
          className
        )}
      >
        <Minus className="h-3 w-3" />
        New
      </span>
    );
  }

  const flat = Math.abs(value) < FLAT_BELOW;
  const good = flat || (value > 0) === goodWhenUp;
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        flat
          ? "text-muted-foreground"
          : good
            ? "border-green-600/30 bg-green-500/5 text-green-700 dark:border-green-400/30 text-positive"
            : "border-red-600/30 bg-red-500/5 text-red-700 dark:border-red-400/30 text-negative",
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {trendLabel(value, { suffix, multiplier })}
    </span>
  );
};

// Change against a previous value, as a percentage. Null when there is
// nothing to compare against -- every first month would otherwise read
// "+100%", which says nothing.
export const percentChange = (current, previous) => {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

// The order categorical series take their colours in: strong, pale, strong,
// pale around the ramp, so neighbouring slices and segments always contrast.
// Shared so a category is the same colour in every widget on the page.
export const SERIES_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-3))",
];

const PILL_TONES = {
  good: "border-green-600/30 bg-green-500/5 text-green-700 dark:border-green-400/30 text-positive",
  warn: "border-amber-600/30 bg-amber-500/5 text-amber-700 dark:border-amber-400/30 dark:text-amber-400",
  bad: "border-red-600/30 bg-red-500/5 text-red-700 dark:border-red-400/30 text-negative",
  neutral: "text-muted-foreground",
};

// A short labelled pill -- "Healthy", "First month", "+₹1,200" -- for badges
// where a percentage would say nothing to a new user.
export const StatusBadge = ({ tone = "neutral", icon: Icon, className, children }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
      PILL_TONES[tone],
      className
    )}
  >
    {Icon && <Icon className="h-3 w-3" />}
    {children}
  </span>
);
