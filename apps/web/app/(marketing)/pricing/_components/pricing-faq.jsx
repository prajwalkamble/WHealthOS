import { Plus } from "lucide-react";
import { PLAN_FAQS } from "@/data/pricing";

// <details>/<summary> rather than a React accordion: it opens and closes
// without JavaScript, is keyboard operable for free, and the browser exposes
// the expanded state to assistive tech without any aria wiring.
// faqs: which set to show. There are two -- PLAN_FAQS while the plans are on
// sale, FREE_FAQS while they are not -- because the questions people ask are
// not the same ones. The caller decides, since the caller is the page that
// already knows which pricing it is showing.
const PricingFaq = ({ faqs = PLAN_FAQS, subtitle }) => {
  const columns = [
    faqs.slice(0, Math.ceil(faqs.length / 2)),
    faqs.slice(Math.ceil(faqs.length / 2)),
  ];

  return (
    <section className="rounded-xl border bg-card p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Frequently asked questions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {subtitle ?? "Everything you need to know about WHealthOS pricing."}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-x-8 md:grid-cols-2">
        {columns.map((column, index) => (
          <div key={index}>
            {column.map((faq) => (
              <details key={faq.question} className="group border-b">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45" />
                  {faq.question}
                </summary>
                <p className="pb-4 pl-7 text-sm text-muted-foreground">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
};

export default PricingFaq;
