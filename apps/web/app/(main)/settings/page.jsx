import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import AiSummaryToggle from "./_components/ai-summary-toggle";
import AppearanceCard from "./_components/appearance-card";
import CurrencyCard from "./_components/currency-card";
import { FeatureNotice } from "@/components/billing/feature-gate";
import PlanCard from "./_components/plan-card";
import { ExportButton } from "@/components/export-drawer";
import { ImportButton } from "@/components/import-drawer";
import { AI_USAGE_LINK } from "@/lib/legal/ai";
import { publicAvailability, plansAreOnSale } from "@/lib/billing/availability";
import { billingSummary } from "@/lib/billing/service";
import { enforcementEnabled } from "@/lib/billing/entitlements";
import { getCurrentUserId } from "@/lib/prisma";
import { getMonthlyInsightsEnabled, getUserAccounts } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ?plan= and ?duration= preselect a plan here, the same vocabulary /pricing
// uses. Advisory only: they move a toggle and outline a card, nothing more.
// Every commercially significant value is resolved server-side when checkout
// is called, so a hand-edited query string buys nothing.
export default async function SettingsPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  // The same answer the pricing page gets, from the same place, so the two
  // surfaces cannot disagree about whether this deployment sells anything.
  const availability = publicAvailability();

  const [user, accounts, monthlyInsights, billing] = await Promise.all([
    currentUser(),
    getUserAccounts(),
    getMonthlyInsightsEnabled(),
    getCurrentUserId().then((id) => billingSummary(id)),
  ]);
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    email;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your account and how WHealthOS looks.
        </p>
      </div>

      {/* Above appearance on purpose: this changes what the figures SAY,
          which matters more than what they look like -- and unlike the
          appearance settings it is free on every plan, because reading your
          own money in your own currency is not something to charge for. */}
      <CurrencyCard />

      {/* Said, not enforced here: the card mixes nine paid settings with the
          light/dark switch, which every plan includes, so hiding it would
          take a free feature away with them. savePreferences refuses the paid
          ones on the server; this is what tells somebody why beforehand. */}
      <div className="space-y-2">
        <FeatureNotice feature="appearance.customize">
          Colour, type and density are saved to your account on a paid plan.
        </FeatureNotice>
        <AppearanceCard />
      </div>

      {/* Hidden rather than disabled when this deployment has no Razorpay
          credentials. A card whose only button reports "payments are not
          available" is worse than no card: it reads as an outage to the
          person looking at it, when in fact nothing is wrong with their
          account. Both the secret and the published key id are required --
          see lib/payments/config.js for why the second one matters. */}
      {billing && (
        <PlanCard
          summary={billing}
          enforced={enforcementEnabled()}
          onSale={plansAreOnSale()}
          availability={availability}
          initialPlanId={typeof params.plan === "string" ? params.plan : null}
          initialInterval={typeof params.duration === "string" ? params.duration : null}
        />
      )}

      {/* The findable home for both directions. The buttons on Transactions
          are shortcuts to these same drawers; someone looking for "where do I
          get my data in or out" looks in Settings. */}
      <Card id="data-privacy">
        <CardHeader>
          <CardTitle>Data &amp; Privacy</CardTitle>
          <CardDescription>
            Your transactions are yours. Take them out in a format you can open
            anywhere, or bring in history from a spreadsheet or a bank export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <section className="space-y-2" aria-labelledby="import-export-heading">
            <h3 id="import-export-heading" className="text-sm font-medium">
              Import &amp; Export
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <ImportButton accounts={accounts} label="Import transactions" />
              <ExportButton label="Export transactions" />
            </div>
            <p className="text-sm text-muted-foreground">
              Import a CSV or XLSX — every row is checked and shown to you
              before anything is added, and rows already in WHealthOS are
              skipped. Export as CSV, Excel or PDF for any period; the PDF is a
              report of your own records, not a certified or audited statement.
            </p>
          </section>

          <section className="space-y-1 border-t pt-4" aria-labelledby="privacy-heading">
            <h3 id="privacy-heading" className="text-sm font-medium">
              Privacy
            </h3>
            <p className="text-sm text-muted-foreground">
              Imported files are read to create your transactions and are not
              stored. Three features do send information to an external AI
              provider: the receipt scanner sends the photo you choose, the
              monthly summary email sends that month&apos;s totals by category,
              and WHOS sends the question you type along with the totals
              needed to answer it. The{" "}
              <Link
                href={AI_USAGE_LINK}
                className="underline underline-offset-4"
              >
                AI Usage page
              </Link>{" "}
              sets out exactly what each one sends and what it does not.
            </p>
            <div className="pt-3">
              <AiSummaryToggle enabled={monthlyInsights} />
            </div>
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your name, email and password are managed by your WHealthOS sign-in.
            Use the avatar menu in the top bar to change them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Name: </span>
            {name ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Email: </span>
            {email ?? "No email address"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
