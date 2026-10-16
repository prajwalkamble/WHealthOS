import Link from "next/link";
import { Button } from "./ui/button";
import DashboardProductDemo from "./landing/dashboard-product-demo";
import { SHELL } from "./landing/section";

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
// The walkthrough is the point of this section, so the copy above it is sized
// to be read and then got out of the way. Stacked rather than side by side: the
// demo renders the application's real sidebar plus a three-column grid of
// panels, and in a half-width column the transaction names truncate and the
// cash-flow axis labels collide. It needs the full content width, and the
// headline reads perfectly well above it.
const HeroSection = () => {
  return (
    <div className={SHELL}>
      <div className="mx-auto max-w-4xl text-center">
        {/* Each phrase is its own span so the line can rise in sequence on
            load. The animation is CSS, not GSAP: this is the LCP element, and
            waiting for a client bundle to reveal the headline would delay the
            one thing the page is measured on.
            
            It used to read "Manage your finances with Intelligence." The
            gradient word was the problem: the About page labels the financial
            intelligence layer Planned and ADR-004 records that it is not built,
            so the largest text on the site was promising the one thing the
            product does not do yet. What it does do is put the whole picture in
            one place, which is what it now says. */}
        <h1 className="hero-headline text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
          <span>Your</span> <span>finances.</span>{" "}
          {/* The gradient sits on one phrase, not the whole heading: a fully
              gradient-filled h1 reads as decoration, and it is the single
              loudest thing on a page asking to be trusted with money. */}
          <span className="gradient-title -mr-2">One clear picture.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Track your accounts, record what you spend, plan against a budget and
          see where the month actually went — without connecting a bank or
          handing over a card number.
        </p>

        {/* Two actions, in order: create an account, or look first.
        
            The secondary one is here as well as in the header on purpose. The
            header's "Explore WHealthOS" button is hidden below sm, so on a
            phone the only way into the demo from the first viewport was the
            collapsed menu -- and looking before signing up is the thing most
            visitors to a pre-launch finance product want to do. Both
            destinations exist: /sign-up is the real Clerk flow and /demo is the
            application on sample data. */}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {/* asChild: the button renders as the link itself. A <button>
              nested inside an <a> is invalid HTML. */}
          <Button size="lg" className="w-full px-8 sm:w-auto" asChild>
            <Link href="/sign-up">Get Started</Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full px-8 sm:w-auto" asChild>
            <Link href="/demo">Explore the live demo</Link>
          </Button>
        </div>
      </div>

      {/* Full content width, which is wider than the max-w-6xl it had before:
          the walkthrough is the product demonstration and it was rendering
          narrower than the footer columns beneath it. */}
      <DashboardProductDemo className="mt-12 lg:mt-16" />
    </div>
  );
};

export default HeroSection;
