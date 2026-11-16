import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { landingActions } from "@/lib/landing/cta";

// Closes the page the way the landing page's FinalCta closes that one, and
// asks the same function so the two cannot disagree.
const AboutCta = async () => {
  const { userId } = await auth();
  const { primary, secondary } = landingActions(Boolean(userId), {
    signUp: "Get Started",
    demo: "Explore WHealthOS",
  });

  return (
  <section
    aria-labelledby="cta"
    className="reveal mt-16 flex flex-col items-start justify-between gap-6 rounded-xl border bg-card p-6 md:flex-row md:items-center md:p-8"
  >
    <div>
      <h2 id="cta" className="scroll-mt-28 text-xl font-bold tracking-tight">
        Take control of your financial picture.
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Start building a clearer understanding of your money with WHealthOS.
      </p>
    </div>

    <div className="flex shrink-0 flex-wrap gap-3">
      <Button asChild>
        <Link href={primary.href}>{primary.label}</Link>
      </Button>
      {secondary && (
        <Button variant="outline" asChild>
          <Link href={secondary.href}>{secondary.label}</Link>
        </Button>
      )}
    </div>
  </section>
  );
};

export default AboutCta;
