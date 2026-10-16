import { WORKFLOW } from "@/data/landing";
import Section from "./section";

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
    eyebrow="How it works"
    title="Three steps to a month you can read"
    lead="No bank connection to authorise and no import to wait on. You record what moves, and WHealthOS does the arithmetic."
  >
    <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
      {WORKFLOW.map(({ title, body }, index) => (
        <li key={title} className="bg-card p-6 md:p-7">
          <span
            aria-hidden
            className="block text-sm font-semibold tabular-nums text-primary"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
        </li>
      ))}
    </ol>
  </Section>
);

export default Workflow;
