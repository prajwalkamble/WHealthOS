"use client";

// A client component, which it effectively already was: the guest demo
// and the landing page both render it inside their own client trees.
// Saying so explicitly is what lets it read the display currency from
// context instead of being handed one by three different callers.
import PrefetchLink from "@/components/navigation/prefetch-link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Widget,
  WidgetHeader,
} from "@/components/dashboard/widget";
import { defaultCategories } from "@/data/categories";
import { cn } from "@/lib/utils";
import { amountClass, amountSign, typeLabel } from "@/lib/money";
import { useCurrency } from "@/components/currency-provider";

const LABELS = Object.fromEntries(
  defaultCategories.map((category) => [category.id, category.name])
);

const initialOf = (text) => (text?.trim()?.[0] ?? "•").toUpperCase();

// Recent activity as a table, like the reference: columns line up, so the eye
// can run down dates or amounts without re-reading each row.
const RecentTransactions = ({
  transactions,
  accounts,
  limit = 7,
  viewAllHref = "/transactions",
}) => {
  // Bound to the display currency the viewer chose. This component is shared
  // by the signed-in dashboard, the guest demo and the landing page, and it
  // formats correctly in all three without any of them telling it which
  // currency to use.
  const { format: formatCurrency } = useCurrency();

  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const rows = transactions.slice(0, limit);

  return (
    <Widget className="h-full w-full">
      <WidgetHeader
        title="Transactions"
        action={
          <Button variant="outline" size="sm" asChild>
            <PrefetchLink href={viewAllHref}>View All</PrefetchLink>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No transactions yet
        </p>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="w-full px-5 py-3 font-medium">Transaction</th>
                <th className="hidden px-5 py-3 font-medium md:table-cell">Date</th>
                <th className="hidden px-5 py-3 font-medium sm:table-cell">Type</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((transaction) => {
                const label =
                  transaction.description ||
                  LABELS[transaction.category] ||
                  transaction.category;
                return (
                  <tr key={transaction.id} className="transition-colors hover:bg-muted/40">
                    <td className="max-w-0 px-5 py-3">
                      <div className="flex items-center gap-3">
                        {/* One neutral badge rather than a different
                            saturated hue per row. Eight rows in eight
                            colours is the loudest thing on the page, and
                            none of those colours encodes anything a reader
                            needs here -- the category is written directly
                            underneath. */}
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {initialOf(label)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{label}</p>
                          <p className="truncate text-xs capitalize text-muted-foreground">
                            {LABELS[transaction.category] ?? transaction.category}
                            {accountNames.has(transaction.accountId) &&
                              ` · ${accountNames.get(transaction.accountId)}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-5 py-3 text-muted-foreground md:table-cell">
                      {format(new Date(transaction.date), "d MMM yyyy")}
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <span className="rounded-md border px-2 py-0.5 text-xs">
                        {typeLabel(transaction.type)}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums",
                        amountClass(transaction.type)
                      )}
                    >
                      {amountSign(transaction.type)}
                      {formatCurrency(transaction.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Widget>
  );
};

export default RecentTransactions;
