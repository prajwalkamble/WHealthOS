import Link from "next/link";
import { Lock } from "lucide-react";
import Clerk from "@/components/clerk";
import ThemeToggle from "@/components/theme-toggle";
import Logo from "@/components/brand/logo";

// The checkout shell: a brand mark, a theme toggle, and nothing else.
//
// Not the (main) shell on purpose. Paying for something is the one screen in
// this application that should have no sidebar to wander into, no feedback
// tab, no assistant widget and no navigation -- every one of those is an
// invitation to leave halfway through a payment, and none of them helps
// anybody decide whether to buy a plan.
//
// Still behind the same gates as the rest of the signed-in app: the
// middleware protects /billing(.*), so a signed-out visitor is sent to Clerk
// and returned here afterwards with the plan still named in the URL.
// The "do you have an account to bill" check is NOT here. It belongs to each
// page, because the destination it redirects to has to carry the plan being
// bought, and a layout cannot see the page's search params. See
// lib/billing/account-gate.js.
const CheckoutLayout = ({ children }) => {
  return (
    <Clerk>
      <div className="flex min-h-screen flex-col bg-muted/30">
        <header className="border-b bg-background">
          <div className="container mx-auto flex h-16 items-center gap-4 px-4">
            <Link href="/dashboard" aria-label="WHealthOS">
              {/* The link already carries aria-label="WHealthOS", so the
                  logo itself is decorative here -- otherwise the name is
                  announced twice for one link. */}
              <Logo id="checkout" decorative className="h-[22px] w-auto" />
            </Link>

            {/* Not a certification claim, and worded so it cannot be read as
                one: it says where the details go, which is a fact about the
                integration, rather than asserting a standard this application
                has not been audited against. */}
            <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              <span>Payment details are entered on Razorpay</span>
            </p>

            <ThemeToggle persist className="h-9 w-9" />
          </div>
        </header>

        <main className="container mx-auto flex-1 px-4 py-8 md:py-12">{children}</main>

        <footer className="border-t bg-background py-6">
          <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 text-xs text-muted-foreground">
            <Link href="/terms" className="underline-offset-4 hover:underline">
              Terms of Service
            </Link>
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms#plans" className="underline-offset-4 hover:underline">
              Cancellation &amp; refunds
            </Link>
            <Link href="/contact" className="underline-offset-4 hover:underline">
              Billing support
            </Link>
          </div>
        </footer>
      </div>
    </Clerk>
  );
};

export default CheckoutLayout;
