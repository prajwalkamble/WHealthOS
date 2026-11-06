"use client";

import { useUser } from "@clerk/nextjs";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import ThemeToggle from "@/components/theme-toggle";
import ThemeCustomizer from "@/components/theme-customizer";
import UserAvatar from "@/components/user-avatar";
import GlobalSearch from "./global-search";
import NotificationBell from "./notification-bell";
import CurrencySelector from "@/components/currency-selector";

// The signed-in app's top bar: the rail toggle, a search that spans
// transactions and accounts, then notifications, appearance and the account
// menu on the right.
const AppHeader = () => {
  const { user, isLoaded } = useUser();

  // Clerk resolves in the browser, so the name appears on the pass after
  // hydration rather than differing between server and client.
  const firstName = isLoaded
    ? user?.firstName || user?.username || null
    : null;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md md:px-6">
      <SidebarTrigger className="-ml-1" />

      <GlobalSearch className="w-full max-w-md" />

      <div className="ml-auto flex items-center gap-1">
        {/* Before the bell, because it changes what every figure on the page
            says while the other controls change how it looks. Hidden on the
            narrowest screens, where the same control lives in Settings.

            It can live here now that the figures actually convert: picking a
            currency changes the amounts, not just the symbol. When no rate is
            available the amounts stay in the currency they are held in and
            ConversionNotice says why, so the control never silently lies. */}
        <CurrencySelector className="hidden sm:inline-flex" />
        <NotificationBell />
        {/* Everything under (main) is signed in. */}
        <ThemeToggle persist />
        <ThemeCustomizer />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <div className="flex items-center gap-2">
          <UserAvatar />
          {firstName && (
            <span className="hidden text-sm font-medium sm:inline">
              {firstName}
            </span>
          )}
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
