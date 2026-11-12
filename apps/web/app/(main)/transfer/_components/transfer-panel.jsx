"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency/format";
import TransferFlow, { STEP, transferCopy } from "@/components/transfer-flow";

// The page's shell around TransferFlow, and the reason /transfer needs a
// client component at all: the flow takes callbacks, and a server component
// cannot hand one across.
//
// ---------------------------------------------------------------------------
// WHAT THE PAGE ADDS THAT THE DRAWER DOES NOT
// ---------------------------------------------------------------------------
// A drawer is a place you do one thing and leave. A page is a place you
// arrive at, and it has room, so it carries two things the drawer cannot:
//
//   - the three steps, stated up front. A transfer is not a form you submit;
//     it is a form, a review and a receipt, and saying so before the first
//     field means the review step reads as part of the process rather than as
//     an interruption of it.
//
//   - a rail beside the form that answers the question the feature exists for
//     -- "what does this actually do to my books?" -- while the form is being
//     filled in, using the same state the form is using. Not decoration: the
//     whole reason internal transfers were built is that recording one as an
//     income and an expense wrecks the month's figures, and this is where
//     that is visible.
//
// Both are composition. Neither knows a rule about transfers; the rules are
// in lib/transfers/rules.js and the flow applies them.
const STEPS = [
  { id: STEP.FORM, label: "Details" },
  { id: STEP.REVIEW, label: "Review" },
  { id: STEP.DONE, label: "Done" },
];

const TransferPanel = ({ accounts, defaultFromAccountId = null }) => {
  const [step, setStep] = useState(STEP.FORM);
  // The same remount-is-the-reset rule the drawer uses.
  const [session, setSession] = useState(0);

  const copy = transferCopy(step);
  const activeIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 pb-4">
      <header className="space-y-3">
        {/* Display type, tracked in. The page title is the one piece of
            typography here allowed to be large, and the figure on the form is
            the other -- nothing in between competes with either. */}
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {copy.title}
        </h1>
        {/* Held to a readable measure instead of running the width of a
            desktop monitor. */}
        <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
          {copy.description}
        </p>
      </header>

      <StepRail activeIndex={activeIndex} />

      <TransferFlow
        key={session}
        accounts={accounts}
        defaultFromAccountId={defaultFromAccountId}
        onStepChange={setStep}
        onDone={() => {
          setSession((n) => n + 1);
          setStep(STEP.FORM);
        }}
        cancelSlot={
          <Button type="button" variant="outline" className="flex-1" asChild>
            <Link href="/accounts">Cancel</Link>
          </Button>
        }
        renderAside={(context) => <Rail {...context} />}
      />
    </div>
  );
};

// Three steps, as a rule with marks on it.
//
// A horizontal rule rather than three numbered pills: pills are the generic
// shape for this and they take the vertical space of a section heading to say
// something that is one line of information. The rule reads at a glance and
// costs 40px.
const StepRail = ({ activeIndex }) => (
  <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
    {STEPS.map((item, index) => {
      const done = index < activeIndex;
      const active = index === activeIndex;
      return (
        <li key={item.id} className="flex items-center gap-3">
          <span className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[0.625rem] font-semibold tabular-nums transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                active && !done && "border-primary text-foreground",
                !done && !active && "border-border text-muted-foreground"
              )}
            >
              {done ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <span
              className={cn(
                "font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground"
              )}
              // The only step that is a state rather than a place.
              aria-current={active ? "step" : undefined}
            >
              {item.label}
            </span>
          </span>
          {index < STEPS.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "h-px w-8 transition-colors sm:w-12",
                done ? "bg-primary/40" : "bg-border"
              )}
            />
          )}
        </li>
      );
    })}
  </ol>
);

// The column beside the form. Its content follows the step, because what is
// worth saying changes: what this will record, then what you cannot undo,
// then where the thing you just made has gone.
const Rail = ({ step, source, destination, amount }) => {
  if (step === STEP.REVIEW) {
    return (
      <Panel title="Before you confirm">
        <p>
          A transfer cannot be edited afterwards. To correct one you delete it,
          which removes both sides and restores both balances, and then make
          another.
        </p>
        <p>
          The reference on the receipt is the transfer&rsquo;s own id. It is
          what identifies this transfer anywhere in the application.
        </p>
      </Panel>
    );
  }

  if (step === STEP.DONE) {
    return (
      <Panel title="Where it went">
        <p>
          Both sides are now in the ledger and both balances have been updated.
        </p>
        <p>
          The two rows appear in each account&rsquo;s transactions, filterable
          together under <span className="text-foreground">Transfer</span>.
        </p>
        <Button variant="outline" size="sm" className="mt-1 w-full" asChild>
          <Link href="/transactions">View transactions</Link>
        </Button>
      </Panel>
    );
  }

  // The form step: what this will write, as it is being decided.
  const ready = Boolean(source && destination && amount > 0);
  const currency = source?.currency ?? destination?.currency ?? null;

  return (
    <Panel title="What gets recorded">
      <p>
        One transfer, two rows &mdash; a debit here, a credit there. They carry
        their own type, so nothing that totals income or expenses picks them up.
      </p>

      <div className="divide-y rounded-lg border bg-card/50">
        <Leg
          icon={ArrowUpRight}
          label="Transfer out"
          account={source}
          amount={ready ? -amount : null}
          currency={currency}
          tone="out"
        />
        <Leg
          icon={ArrowDownLeft}
          label="Transfer in"
          account={destination}
          amount={ready ? amount : null}
          currency={currency}
          tone="in"
        />
      </div>
    </Panel>
  );
};

const Panel = ({ title, children }) => (
  <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
    <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {title}
    </h2>
    {/* The prose inside a rail is small and loose; it is read in glances
        rather than straight through. */}
    <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </div>
  </section>
);

// One leg of the transfer-to-be. Dashes rather than zeroes until there is
// something real to show: a row reading "₹0.00" is a claim about an amount,
// and nobody has entered one yet.
const Leg = ({ icon: Icon, label, account, amount, currency, tone }) => (
  <div className="flex items-start gap-2.5 p-3">
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        account
          ? tone === "out"
            ? "bg-negative/10 text-negative"
            : "bg-positive/10 text-positive"
          : "bg-muted text-muted-foreground/60"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "block truncate text-xs",
          account ? "font-medium text-foreground" : "text-muted-foreground/60"
        )}
      >
        {account?.name ?? "Not chosen yet"}
      </span>
    </span>
    <span
      className={cn(
        "shrink-0 text-xs font-semibold tabular-nums",
        amount == null
          ? "text-muted-foreground/40"
          : tone === "out"
            ? "text-negative"
            : "text-positive"
      )}
    >
      {amount == null
        ? "—"
        : `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount), currency)}`}
    </span>
  </div>
);

export default TransferPanel;
