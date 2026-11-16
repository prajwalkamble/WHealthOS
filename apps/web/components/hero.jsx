import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Button } from "./ui/button";
import DashboardProductDemo from "./landing/dashboard-product-demo";
import HeroChartBackdrop from "./landing/hero-chart-backdrop";
import { SHELL } from "./landing/section";
import { cn } from "@/lib/utils";
import { landingActions } from "@/lib/landing/cta";

// A server component. It used to be a client component purely to drive a 3D
// tilt on the hero image from a window scroll listener. That cost a client
// bundle on the most-visited page, ran a handler on every scroll frame, had no
// prefers-reduced-motion path, and the perspective transform projected the
// image ~67px wider than the viewport at 1440, which put a horizontal
// scrollbar on the landing page. None of that bought anything, so it is gone.
//
// The visual is the product itself: the signed-in dashboard's own components,
// rendered against demo data and walked through by a GSAP timeline. It is a
// client island; the rest of the hero stays server-rendered.
//
// Stacked rather than side by side: the walkthrough renders the application's
// real sidebar plus a three-column grid of panels, and in a half-width column
// the transaction names truncate and the cash-flow axis labels collide. It
// needs the full content width, and the copy reads perfectly well above it.
// The draw asked for a Settled hero (text on six columns, visual on the other
// six); the material refuses it for that reason, so the posture is the same
// idea stacked -- a short centred head over a full-bleed product visual that
// breaks the fold, which is what puts the product on the first screen.
//
// The figures in the walkthrough are in the visitor's own currency. The
// CurrencyProvider that does it is mounted by app/(marketing)/page.jsx, around
// the whole page rather than around this component, so the hero's demo and the
// Solutions panels further down agree with each other.
const HeroSection = async () => {
  // Read on the server, off the verified cookie, exactly as header.jsx does --
  // so the primary action is correct in the first HTML rather than changing
  // under the reader a moment after hydration, and so a logged-out visitor
  // still loads no Clerk JavaScript for it. The marketing layout already calls
  // auth() on this request, and this page is server-rendered on demand
  // regardless (it reads a currency cookie), so this costs nothing new.
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  // Decided in one place, shared with the page's closing section. There is no
  // third state to render: auth() has resolved by the time this returns, so
  // the first HTML already carries the right button and there is nothing to
  // swap afterwards -- no skeleton, no flash of the wrong action.
  const { primary, secondary } = landingActions(signedIn, {
    signUp: "Get Started",
    demo: "Explore the live demo",
  });

  return (
    // The positioned, full-width wrapper the backdrop hangs off. It is here
    // rather than on SHELL because the chart runs the width of the page while
    // the copy stays inside the 84rem column, and `isolate` keeps the
    // backdrop's negative z-index from escaping into the rest of the page.
    <div className="relative isolate">
      <HeroChartBackdrop />

      <div className={SHELL}>
        <div className="mx-auto max-w-5xl pt-12 text-center md:pt-16">
          {/* Each phrase is its own span so the line can rise in sequence on
              load. The animation is CSS, not GSAP: this is the LCP element,
              and waiting for a client bundle to reveal the headline would
              delay the one thing the page is measured on.

              The brand ramp runs across the whole head, top left to bottom
              right, by instruction. One gradient over both lines rather than
              one per word: the background is painted on the h1 and clipped to
              its text, so the ramp crosses the headline as a single sweep and
              the words keep their own weights inside it.

              It is the brand's own ramp and nothing else. `gradient-fixed`
              reads --brand-headline-from and --brand-headline-to, the one
              pair in the token block the dark theme does not redefine: the
              headline is to read in the same two colours in both themes, by
              instruction, so it does not take the lifted set the rest of the
              ramp switches to on a dark ground. The figures are in the token
              block beside the declaration.

              pb-2: "Manage" and "Intelligence" both have descenders, and
              background-clip: text crops to the text box. Without it the
              tails of the g's are cut. */}
          <h1 className="hero-headline gradient-fixed bg-clip-text pb-2 text-balance text-5xl font-bold leading-[1.03] tracking-tight text-transparent md:text-6xl lg:text-[5.25rem]">
            <span>Manage</span> <span>Your</span> <span>Finances</span>{" "}
            <span>with</span> <span>Intelligence</span>
          </h1>

          {/* One sentence, and the strongest real fact in it. The longer
              version named four features and ended on an em dash; the four
              features are the section directly below this one. */}
          <p className="mx-auto mt-6 max-w-xl text-lg leading-[1.7] text-muted-foreground md:text-xl">
            One place for every account, transaction and budget, with no bank
            connection.
          </p>

          {/* Two actions for a visitor, in order: create an account, or
              look first. One for somebody signed in, straight to their own
              dashboard -- see lib/landing/cta.js, which decides this for the
              closing section too so the page cannot say both things.

              The secondary one is here as well as in the header on purpose.
              The header's "Explore WHealthOS" button is hidden below md, so on
              a phone the only way into the demo from the first viewport was
              the collapsed menu -- and looking before signing up is the thing
              most visitors to a pre-launch finance product want to do. Both
              destinations exist: /sign-up is the real Clerk flow and /demo is
              the application on sample data.

              The demo invitation goes away once there is an account to use:
              sample data is not an upgrade on the real thing. /demo itself is
              untouched and still public -- it is this invitation that is
              conditional, not the route. */}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {/* asChild: the button renders as the link itself. A <button>
                nested inside an <a> is invalid HTML.

                Both buttons keep the size, radius and weight they had. Only
                which of them exists, where they point and what the first one
                is called depend on the reader. */}
            <Button
              size="lg"
              asChild
              className="h-[50px] w-full rounded-full px-8 text-base font-medium sm:w-auto"
            >
              <Link href={primary.href}>{primary.label}</Link>
            </Button>
            {/* Rendered or not at all. An outline button with nothing behind
                it, or a hidden one still holding its width, would leave the
                single action sitting off-centre -- the row centres what it
                actually contains. */}
            {secondary && (
              <Button
                size="lg"
                variant="outline"
                asChild
                className={cn(
                  "h-[50px] w-full rounded-full bg-transparent px-8 text-base font-medium sm:w-auto"
                )}
              >
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Full content width, and deliberately close under the actions: the
            top of the real product has to be on the first screen, because it
            is the only thing on this page that cannot be claimed by anybody
            else. */}
        <DashboardProductDemo className="mt-12 lg:mt-14" />
      </div>
    </div>
  );
};

export default HeroSection;
