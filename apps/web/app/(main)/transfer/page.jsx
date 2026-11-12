import PrefetchLink from "@/components/navigation/prefetch-link";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";

import { getUserAccounts } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import TransferPanel from "./_components/transfer-panel";

export const metadata = {
  title: "Fund Transfer",
  description: "Move money between two of your own accounts.",
};

// Moving money between two of your own accounts, as a page.
//
// The drawer on /accounts and on an account's own page came first and stays:
// it is the right shape when you are already looking at the account you want
// to move money out of. This page exists because that was the ONLY way in,
// and an action hidden behind a button that disappears when you have fewer
// than two accounts is an action people cannot find -- which is exactly how
// it was reported.
//
// Both render the same TransferFlow. Nothing about what a transfer is lives
// here.
export default async function TransferPage({ searchParams }) {
  const { from } = (await searchParams) ?? {};
  const accounts = await getUserAccounts();

  // Honoured only if it is really one of this person's accounts. `from` comes
  // from the query string, so it is a claim rather than a fact; an id that
  // does not match simply leaves the select empty, which is what an absent
  // one does.
  const defaultFromAccountId = accounts.some((account) => account.id === from)
    ? from
    : null;

  // Fewer than two accounts is not an error and not an empty state about
  // transfers -- it is one step of setup, so the page says which step and
  // links to where it is done. The drawer could only ever explain the problem
  // after you had found it; this is the advantage of being a page.
  if (accounts.length < 2) return <Setup count={accounts.length} />;

  return (
    <TransferPanel
      accounts={accounts}
      defaultFromAccountId={defaultFromAccountId}
    />
  );
}

// The setup state, built from the same parts as the real screen rather than
// as a bordered box with a shrug in it.
//
// It shows the shape of a transfer -- one row out, one row in -- greyed, with
// the missing half named. Somebody who has never made one learns what the
// feature is while being told why they cannot use it yet, which is strictly
// more than "You need two accounts" manages.
const Setup = ({ count }) => (
  <div className="mx-auto w-full max-w-4xl space-y-8 pb-4">
    <header className="space-y-3">
      <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        Fund Transfer
      </h1>
      {/* The same sentence transferCopy() carries. Repeated as a literal
          rather than imported: transfer-flow.jsx is a "use client" module and
          this is a server component, so pulling a plain function across that
          boundary is not worth a shared string. */}
      <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
        Shift money you already hold from one account to another: savings set aside, a card cleared, a bill&rsquo;s account topped up. You end up no better or worse off — which is why it counts as neither income nor an expense.
      </p>
    </header>

    <section className="max-w-xl space-y-5 rounded-xl border bg-muted/20 p-5 sm:p-6">
      <div className="divide-y rounded-lg border bg-card/50">
        <GhostLeg
          icon={ArrowUpRight}
          label="Transfer out"
          caption="The account the money leaves"
        />
        <GhostLeg
          icon={ArrowDownLeft}
          label="Transfer in"
          caption="The account it arrives in"
        />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-sm font-medium">
          {count === 0
            ? "You don't have any accounts yet"
            : "You have one account"}
        </h2>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          A transfer moves money between two of your own accounts, so there has
          to be somewhere for it to go.{" "}
          {count === 0
            ? "Add two accounts and this page becomes available."
            : "Add one more and this page becomes available."}
        </p>
      </div>

      <Button size="sm" asChild>
        <PrefetchLink href="/accounts">
          <Plus className="h-4 w-4" />
          {count === 0 ? "Add an account" : "Add another account"}
        </PrefetchLink>
      </Button>
    </section>
  </div>
);

const GhostLeg = ({ icon: Icon, label, caption }) => (
  <div className="flex items-center gap-3 p-3.5">
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground/60"
    >
      <Icon className="h-4 w-4" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="block truncate text-sm text-muted-foreground/60">
        {caption}
      </span>
    </span>
    <span className="shrink-0 text-sm font-semibold text-muted-foreground/40">
      —
    </span>
  </div>
);
