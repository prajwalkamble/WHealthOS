import Link from "next/link";
import { Plus } from "lucide-react";
import { LANDING_FAQS } from "@/data/landing";
import Section from "./section";

// <details>/<summary> rather than a React accordion, for the same reasons the
// pricing FAQ does it: it opens and closes with no JavaScript, it is keyboard
// operable for free, and the browser reports the expanded state to assistive
// technology without a line of aria wiring. This section ships no client
// bundle at all.
//
// The questions are in data/landing.js and are deliberately not the pricing
// FAQ. That one covers plans, caps, upgrades and cancellation and is rendered
// in full on /pricing; repeating any of it here would be the same answer in
// two places, which is exactly the redundancy this page was trimmed to remove.
const Faq = () => {
  const half = Math.ceil(LANDING_FAQS.length / 2);
  const columns = [LANDING_FAQS.slice(0, half), LANDING_FAQS.slice(half)];

  return (
    <Section
      id="faq"
      eyebrow="Questions"
      title="Before you sign up"
      lead="The things worth knowing that the rest of this page does not answer."
    >
      <div className="mt-8 grid gap-x-12 md:grid-cols-2">
        {columns.map((column, index) => (
          <div key={index}>
            {column.map(({ question, answer }) => (
              <details key={question} className="group border-b">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <Plus
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  />
                  {question}
                </summary>
                <p className="pb-4 pl-7 text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        ))}
      </div>

      {/* One line rather than a closing call-to-action band. The footer's own
          CTA row -- "Take control of your finances" with Get Started -- sits
          immediately below this and is on every page; a second one stacked on
          top of it said the same thing twice, which is why the page-level one
          was removed in the first place. This points at the one thing someone
          who is still undecided actually wants. */}
      <p className="mt-8 text-sm text-muted-foreground">
        Still deciding?{" "}
        <Link
          href="/demo"
          className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Open the demo
        </Link>{" "}
        — it is the whole application on sample data, with no account and no
        email address.
      </p>
    </Section>
  );
};

export default Faq;
