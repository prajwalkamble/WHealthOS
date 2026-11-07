import { Suspense } from 'react'
import { getAccountWithTransactions } from '@/actions/accounts';
import { BarLoader, HashLoader } from 'react-spinners';
import { TransactionTable } from '../_components/transaction-table';
import { notFound } from 'next/navigation';
import { AccountChart } from '../_components/account-chart';
import { ExportButton } from "@/components/export-drawer";
import AccountBalance from '../_components/account-balance';

export default async function AccountsPage({ params }) {
  const { id } = await params;
  const accountData = await getAccountWithTransactions(id);

  if(!accountData) {
    notFound();
  }

  const { transactions, ...account } = accountData;

  return (
    <Suspense fallback={<BarLoader className="mt-4" width={"100%"} color="hsl(var(--primary))" />}>
      {/* space-y-6 and no padding of its own, like /transactions and
          /accounts. This page carried space-y-8 and px-5, so it sat a few
          pixels in from every other page in the shell. */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {/* The name used to be a 60px gradient headline above a 20px
                balance -- the page shouted whose account it was and
                whispered what was in it. The two have swapped weight, and
                the heading now matches the h1 on /transactions and
                /accounts instead of being the only gradient title in the
                shell. */}
            <h1 className="truncate text-2xl font-bold capitalize tracking-tight">
              {account.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {account.type.charAt(0) + account.type.slice(1).toLowerCase()} Account
              {" · "}
              {account._count.transactions}
              {account._count.transactions === 1
                ? " transaction"
                : " transactions"}
            </p>
            {account.hasMoreTransactions && (
              <p className="text-xs text-muted-foreground">
                The table shows the most recent {account.transactionLimit}
              </p>
            )}
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            <AccountBalance balance={account.balance} />
            {/* Scoped to this account, so the file matches the page. */}
            <ExportButton
              accountId={account.id}
              scopeLabel={`${account.name} transactions`}
            />
          </div>
        </div>

        {/* Chart Section */}
        <Suspense
          fallback={<HashLoader className="mt-4" width={"100%"} color="hsl(var(--primary))" />}
        >
          <AccountChart dailyTotals={account.dailyTotals} />
        </Suspense>

        {/* Transaction Table */}
        <Suspense
          fallback={<BarLoader className="mt-4" width={"100%"} color="hsl(var(--primary))" />}
        >
          <TransactionTable transactions={transactions} />
        </Suspense>
      </div>
    </Suspense>
  );
};
