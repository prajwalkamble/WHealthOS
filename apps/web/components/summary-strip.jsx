import { cn } from "@/lib/utils";

// The row of headline figures that opens a section page.
//
// Budgets and Goals had each built this separately and arrived at identical
// cell markup inside different containers -- one a hairline-divided strip,
// the other four separate cards -- so two sibling pages presented the same
// kind of information two different ways. One component, so they cannot
// drift again.
//
// A <section> rather than a <div>: it carries an aria-label, and a label on
// a plain div is ignored.
export const SummaryStrip = ({ className, children, ...props }) => (
  <section
    className={cn(
      // Breakpoints set by the widest figure these cells have to hold, not
      // by eye. A grouped rupee total like "\u20B934,30,000.00" needs about
      // 155px at text-xl; two columns on a 375px phone left 130px and clipped
      // it, and four columns at lg left 147px once the 256px sidebar is
      // subtracted, so it clipped there too. One column on a phone, two in
      // between, four only from xl where each cell clears 200px.
      "grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-4",
      className
    )}
    {...props}
  >
    {children}
  </section>
);

// One figure. `children` is for the rare cell that needs more than a hint --
// the spend-change line on Budgets, for instance, which carries its own
// arrow and colour.
export const SummaryCell = ({ label, value, hint, valueClassName, children }) => (
  <div className="bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p
      className={cn(
        "mt-1 text-xl font-bold tabular-nums tracking-tight",
        valueClassName
      )}
    >
      {value}
    </p>
    {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    {children}
  </div>
);
