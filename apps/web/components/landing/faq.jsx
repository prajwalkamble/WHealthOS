import { Plus } from "lucide-react";
import { LANDING_FAQS } from "@/data/landing";
import Section, { BODY } from "./section";

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
//
// It used to close with a line pointing at the demo. FinalCta sits directly
// below it now and offers the same thing as a button, so the line was two
// invitations to the same place, one above the other.
const Faq = () => {
  const half = Math.ceil(LANDING_FAQS.length / 2);
  const columns = [LANDING_FAQS.slice(0, half), LANDING_FAQS.slice(half)];

  return (
    <Section
      id="faq"
      gap="l"
      title="FAQs"
      lead="The things worth knowing that the rest of this page does not answer."
    >
      <div className="mt-10 grid gap-x-14 md:grid-cols-2">
        {columns.map((column, index) => (
          <div key={index}>
            {column.map(({ question, answer }) => (
              <details key={question} className="group border-b">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-5 text-base font-medium [&::-webkit-details-marker]:hidden">
                  <Plus
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  />
                  {question}
                </summary>
                <p className={`pb-5 pl-7 ${BODY}`}>{answer}</p>
              </details>
            ))}
          </div>
        ))}
      </div>

    </Section>
  );
};

export default Faq;
