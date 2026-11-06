"use client";

import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  LayoutDashboard,
  PiggyBank,
  Settings,
  Target,
  Wallet,
} from "lucide-react";
import AppSidebar from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import DemoHeader from "./demo-header";
import { useDemo } from "./demo-provider";
import { useCurrency } from "@/components/currency-provider";

// The same rail as the signed-in app, pointed at /demo. Sections a guest
// cannot use are marked `soon`, which the sidebar already renders as disabled
// with a tooltip -- rather than as links to pages that would bounce them to
// sign-in.
const DEMO_NAV = [
  { title: "Dashboard", url: "/demo", icon: LayoutDashboard },
  { title: "Transactions", url: "/demo/transactions", icon: ArrowLeftRight },
  { title: "Accounts", icon: Wallet, soon: true },
  { title: "Cards", icon: CreditCard, soon: true },
  { title: "Budgets", icon: PiggyBank, soon: true },
  { title: "Goals", icon: Target, soon: true },
  { title: "Analytics", icon: BarChart3, soon: true },
  { title: "Settings", icon: Settings, soon: true },
];

const DemoShell = ({ children }) => {
  const demo = useDemo();
  // The conversion facts come from the currency provider now: it is what
  // converts these figures, so it is what can say how.
  const { converted, locked, selected, currency, rateAsOf } = useCurrency();

  return (
    <SidebarProvider>
      <AppSidebar items={DEMO_NAV} homeHref="/demo" />

      <SidebarInset>
        <DemoHeader onReset={demo.reset} addedCount={demo.addedCount} />

        <div className="app-content flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
          {/* Where the figures came from, said plainly.
              §12 of the multi-currency brief: converted sample data has to be
              identified as such. A visitor reading ¥ here is looking at Indian
              sample figures put through a real ECB fixing, and is entitled to
              know that rather than to assume these are native yen amounts. */}
          {/* Asked for a currency we have no rate for. Said outright, because
              the alternative -- showing INR again with no explanation -- looks
              exactly like a selector that does not work. */}
          {locked && (
            <p className="text-xs text-muted-foreground">
              No exchange rate is available for {selected} yet, so these
              figures are still shown in {currency}. They are not being
              relabelled: converting them without a real rate would misstate
              them.
            </p>
          )}
          {converted && (
            <p className="text-xs text-muted-foreground">
              Sample figures are held in INR and shown in {currency}, converted at
              the European Central Bank reference rate{rateAsOf ? ` of ${rateAsOf}` : ""}.
              Indicative only — not a dealing rate.
            </p>
          )}
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default DemoShell;
