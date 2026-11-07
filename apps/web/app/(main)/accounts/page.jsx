import { getUserAccounts } from "@/lib/queries";
import AccountCard from "../dashboard/_components/account-card";
import CreateAccountDrawer from "@/components/create-account-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import AccountsTotal from "./_components/accounts-total";
import { Plus, Wallet } from "lucide-react";

export default async function AccountsPage() {
  const accounts = await getUserAccounts();
  const total = accounts.reduce((sum, account) => sum + account.balance, 0);

  return (
    <div className="space-y-6">
      {/* The same header shape as /transactions: title, one line of context,
          and the page's primary action on the right. Creating an account
          used to be reachable only through a tile inside the grid, so the
          two sibling pages disagreed about where a new thing comes from. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            <AccountsTotal count={accounts.length} total={total} />
          </p>
        </div>
        <CreateAccountDrawer>
          <Button size="sm" className="h-9">
            <Plus className="h-4 w-4" />
            New Account
          </Button>
        </CreateAccountDrawer>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Wallet className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No accounts yet</p>
              <p className="text-sm text-muted-foreground">
                Add an account to start tracking what moves through it.
              </p>
            </div>
            <CreateAccountDrawer>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
                New Account
              </Button>
            </CreateAccountDrawer>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}

          {/* Last, and dashed. It led the grid with a solid border and a
              40px plus, so it looked like an account called "Add New
              Account" sitting in front of the real ones. */}
          <CreateAccountDrawer>
            <Card className="cursor-pointer border-dashed bg-transparent shadow-none transition-colors hover:border-primary/50 hover:bg-muted/40 motion-reduce:transition-none">
              <CardContent className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 p-6 text-muted-foreground">
                <Plus className="h-5 w-5" aria-hidden />
                <p className="text-sm font-medium">Add account</p>
              </CardContent>
            </Card>
          </CreateAccountDrawer>
        </div>
      )}
    </div>
  );
}
