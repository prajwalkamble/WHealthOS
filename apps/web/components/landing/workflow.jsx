import { WORKFLOW } from "@/data/landing";
import { cn } from "@/lib/utils";
import Section, { BODY } from "./section";

// Three steps from an empty account to a month that reads.
//
// Kept because the hero's walkthrough shows the destination and not the route
// to it: a visitor watching the dashboard animation learns what WHealthOS
// looks like once it has their data, and nothing about how it got there.
//
// Deliberately not a card each. Numbers in a rule-separated row read as a
// sequence, which is what this is; three bordered boxes read as three
// unrelated things, which is what the old "How It Works" grid did with its
// circles. The numeral is decorative -- the ordered list carries the sequence
// for a screen reader -- so it is aria-hidden rather than read out twice.
const Workflow = () => (
  <Section
    id="workflow"
    title="Three steps to a month you can read"
    lead="No bank connection to authorise and no import to wait on. You record what moves, and WHealthOS does the arithmetic."
  >
    <ol className="mt-12 grid gap-px overflow-hidden rounded-[20px] border bg-border md:grid-cols-3">
      {WORKFLOW.map(({ title, body }, index) => (
        <li key={title} className="bg-card p-7 md:p-8">
          {/* The numeral sits on the title's line, not as an "01" label
              stacked above it: a number alone on a row is a label, and a
              label over a head is the shape 54 names. The <ol> already
              carries the sequence for a screen reader, so this is decorative
              and aria-hidden rather than read out twice. */}
          <h3 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight">
            <span aria-hidden className="tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            {title}
          </h3>
          <p className={cn("mt-3", BODY)}>{body}</p>
        </li>
      ))}
    </ol>
  </Section>
);

export default Workflow;
