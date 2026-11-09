import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SHELL } from "./section";
import { cn } from "@/lib/utils";

// The page's closing action.
//
// No background of its own, by instruction. An earlier pass gave this a
// full-bleed slab of deep brand colour, following the reference's closing
// section; the owner asked for the landing page to carry no added background,
// so the section sits on the page's own surface like every other one and the
// gradient is back to the single phrase it tints.
//
// Not built on Section, which would render its own heading: this one needs the
// centring, so the section carries its heading directly rather than having a
// second, hidden one above it for a screen reader to read twice.
//
// Deliberately narrow in what it claims. No countdown, no "limited places", no
// trial length -- there is no billing integration to run a trial through --
// and no promise about what the product will do for someone's money. The two
// destinations are the two real ones: the Clerk sign-up flow, and the demo.
//
// It sits above the footer's own call to action, which says much the same
// thing on every page of the site. That overlap is deliberate and was asked
// for: this one closes the argument the page has been making, and the
// footer's is a standing offer that belongs to every other page too.
const FinalCta = () => (
  <section aria-labelledby="get-started" className="reveal mt-20 md:mt-28">
    <div className={cn(SHELL, "text-center")}>
      <h2
        id="get-started"
        className="mx-auto max-w-3xl scroll-mt-28 text-balance text-3xl font-semibold leading-[1.15] tracking-tight md:text-[2.5rem]"
      >
        Bring your finances into focus.
      </h2>

      <p className="mx-auto mt-5 max-w-xl text-lg leading-[1.8] text-muted-foreground">
        Start with one account and a week of transactions. That is enough for
        the dashboard to tell you something you did not already know.
      </p>

      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button
          asChild
          size="lg"
          className="h-[50px] w-full rounded-full px-8 text-base font-medium sm:w-auto"
        >
          <Link href="/sign-up">Create your account</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-[50px] w-full rounded-full bg-transparent px-8 text-base font-medium sm:w-auto"
        >
          <Link href="/demo">Try it without signing up</Link>
        </Button>
      </div>
    </div>
  </section>
);

export default FinalCta;
