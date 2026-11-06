import { Check } from "lucide-react";
import { FEATURE_GROUPS, HEADLINE_FEATURE } from "@/data/pricing";

// What "free" actually covers.
//
// The page this replaced was a three-column comparison, and the comparison
// was the point: which plan unlocked which row. With one plan there is
// nothing to compare, so the same catalogue is rendered flat -- every row
// ticked, grouped as before.
//
// Read from FEATURE_GROUPS rather than retyped, because that list is the
// feature matrix the backend authorises against (each row carries the
// entitlement key from lib/billing/entitlements.js). A hand-written list here
// would be a second version of it, free to drift, and the drift would be
// invisible: a feature quietly advertised that nothing grants.
const EverythingIncluded = () => (
  <section
    aria-labelledby="included-heading"
    className="rounded-xl border bg-card p-6 md:p-8"
  >
    <div>
      <h2 id="included-heading" className="text-xl font-bold tracking-tight">
        Everything, for everyone
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        There is one plan and this is all of it. No tiers, no card, no trial
        that ends.
      </p>
    </div>

    {/* The daily transaction cap used to be the headline row because it was
        the number that differed between plans. It no longer differs, so it is
        stated once, plainly, instead of being the first thing anybody reads. */}
    <p className="mt-6 flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>
        <span className="font-medium">{HEADLINE_FEATURE.label}:</span>{" "}
        <span className="text-muted-foreground">
          no longer limited by plan.
        </span>
      </span>
    </p>

    {/* Columns rather than a two-column grid. A grid aligns the groups into
        rows, so the tallest group in each row sets the height and the short
        ones leave a hole underneath -- with six groups of one to six features
        that left a conspicuous gap beside AI & Insights. Multi-column flows
        them instead, and break-inside-avoid keeps a group from being split
        down the middle. */}
    <div className="mt-8 md:columns-2 md:gap-8">
      {FEATURE_GROUPS.map((group) => (
        <div key={group.title} className="mb-8 break-inside-avoid last:mb-0">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {group.title}
          </h3>
          <ul className="mt-3 space-y-3">
            {group.features.map((feature) => (
              <li key={feature.key} className="flex items-start gap-3 text-sm">
                <Check
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                />
                <span>
                  <span className="font-medium">{feature.label}</span>
                  {feature.hint && (
                    <span className="block text-muted-foreground">
                      {feature.hint}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </section>
);

export default EverythingIncluded;
