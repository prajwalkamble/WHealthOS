import { cookies } from "next/headers";
import Clerk from "@/components/clerk";
import { redirect } from "next/navigation";
import { checkUser } from "@/lib/checkUser";
import FeedbackWidget from "@/components/feedback-widget";
import AgentWidget from "@/components/whos-agent/agent-widget";
import { planIdFromRows } from "@/lib/billing/service";
import { devGrantsAll } from "@/lib/billing/dev-override";
import { enforcementEnabled, planGrants } from "@/lib/billing/entitlements";
import PreferencesSync from "@/components/preferences-sync";
import { CurrencyProvider } from "@/components/currency-provider";
import { currentCurrency } from "@/lib/currency/server";
import { presentationData } from "@/lib/currency/presentation";
import ConversionNotice from "@/components/conversion-notice";
import AppSidebar from "@/components/app-sidebar";
import AppHeader from "@/components/header/app-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Every route under (main) is behind the middleware's auth check, so this is
// the first point where a Clerk user is guaranteed and the local row is
// actually needed. Doing it here instead of in the shared Header keeps the
// public landing page off the database entirely.
const MainLayout = async ({ children }) => {
  const user = await checkUser();

  // Signed in (the middleware saw to that) but no WHealthOS account yet, which
  // means the consent step has not been completed. The account is created
  // there, so until it is there is nothing here to show and no row for a
  // tenant-scoped query to resolve to.
  //
  // This is the chokepoint for every page under (main), and it is the real
  // enforcement: not a disabled button, and not something the browser can
  // route around, since the row it is checking for is the row the rest of the
  // app needs in order to read or write anything at all.
  //
  // Existing accounts never reach it. A row that already exists is simply
  // returned, so nobody is asked to accept anything twice.
  if (!user) redirect("/welcome");
  // Comes back on the row checkUser already fetches. Reading it separately
  // meant a whole extra tenant transaction on every navigation, for a panel
  // most people never open -- and a transient failure there would have taken
  // down every page in the app rather than one widget.
  const rating = user?.rating?.score ?? null;

  // The sidebar writes its open state to a cookie; reading it here renders it
  // in the right state instead of flicking open on the first paint.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  // Resolved here, on the server, so the first paint is already in the right
  // currency. Doing it in the browser would render every figure in the
  // default and then swap it a frame later -- a hydration mismatch, and an
  // unpleasant one to watch on a page of balances.
  //
  // This layout is already dynamic (it reads cookies and the account), so
  // this costs nothing. The root layout is deliberately left alone: a
  // cookies() call there would opt the marketing pages out of static
  // generation for a currency none of them displays.
  const currency = await currentCurrency();

  // The INPUTS to the presentation decision, not the decision itself.
  //
  // What the ledger is held in, and the current rate table. Both are plain,
  // small and serialisable, and they go to the browser once per page load --
  // after which switching currency is local arithmetic over data it already
  // has, with no server involved.
  //
  // Handing over the decision instead (a scalar computed here) was what made
  // every currency change a round trip, because the client had no way to
  // compute a different one.
  const { ledger, rates } = await presentationData(user.id);

  // Whether a control for `feature` should be OFFERED. A different question
  // from whether the operation would be allowed: the server still decides
  // that, and still must -- savePreferences refuses a paid setting and
  // /api/ai/chat refuses a question, whatever this says.
  //
  // The same three terms the assistant below spells out inline, which
  // tests/entitlement-coverage.test.js asserts are literally there -- so that
  // one stays as it is and this names the rule for everything else. Costs no
  // query: the plan comes from the rows checkUser() has already fetched.
  const offers = (feature) =>
    !enforcementEnabled() ||
    devGrantsAll(user?.id) ||
    planGrants(planIdFromRows(user?.subscriptions), feature);

  return (
    // Always wrapped: everything under (main) is signed in, and the shell is
    // full of Clerk components -- the avatar menu, the profile screen.
    <Clerk>
    <CurrencyProvider initial={currency} ledger={ledger} rates={rates} sync>
    <SidebarProvider defaultOpen={defaultOpen}>
      {/* Applies the theme saved on the account, for a browser that has not
          seen this user before. */}
      <PreferencesSync saved={user?.preferences} />

      <AppSidebar />

      <SidebarInset>
        {/* devAccess is DECIDED here and only displayed there. AppHeader is a
            client component and the override's variables are not NEXT_PUBLIC_,
            so the browser cannot read them -- and nothing is lost by telling
            it the answer, because the answer is not the authorisation. Someone
            flipping this boolean in devtools gets a badge and no features. */}
        <AppHeader
          devAccess={devGrantsAll(user?.id)}
          canCustomize={offers("appearance.customize")}
        />


        {/* app-content: the Content Layout setting centres this column. */}
        <div className="app-content flex flex-1 flex-col gap-6 p-4 md:p-6">
          {/* Where the figures below came from, when they are not simply what
              is stored. A converted balance is an estimate at somebody else's
              published rate, and a finance dashboard that does not say so is
              making a claim it cannot support. */}
          <ConversionNotice />
          {children}
        </div>
      </SidebarInset>

      {/* Pinned to the viewport, so it belongs to the shell rather than any
          one page. */}
      <FeedbackWidget initialRating={rating} />

      {/* WHOS, on the same rail and below the feedback tab -- the space
          that widget's own comment reserved for it. Mounted here rather than
          per page so a question can be asked while looking at the figures it
          is about. It holds no server data: everything it shows is fetched by
          its own authenticated request when a question is asked.

          Not mounted at all without the plan for it, from 2026-11-10. The
          authorisation has not moved -- /api/ai/chat calls
          requireFeature(userId, "ai.queries") before a model is reached, and
          that is still the only thing standing between an account and an
          answer. This decides whether a control is offered, which is a
          different question from whether a request is allowed, and it was
          previously answered "always": every account saw the assistant, and
          from the day enforcement went on, the ones without Intelligent would
          have been invited to ask a question and then refused.

          The plan comes from the rows checkUser() already fetched, so this
          costs no query. planGrants rather than entitlementSummary: no part of
          this decision is sent to the browser, and the children of a false
          branch are never rendered, so there is no markup to strip.

          enforcementEnabled() is part of the condition for the same reason
          components/billing/feature-gate.jsx puts it in its own: while
          enforcement is off the route lets every account through, and hiding
          a control that would in fact work is as much a lie as a padlock on
          one that is not locked. The two have to agree about when a refusal
          actually happens. */}
      {(!enforcementEnabled() ||
        devGrantsAll(user?.id) ||
        planGrants(planIdFromRows(user?.subscriptions), "ai.queries")) && (
        <AgentWidget />
      )}
    </SidebarProvider>
    </CurrencyProvider>
    </Clerk>
  );
};

export default MainLayout;
