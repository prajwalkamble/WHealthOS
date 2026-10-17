import { auth } from "@clerk/nextjs/server";
import UserAvatar from "./user-avatar";
import Image from "next/image";
import Link from "next/link";
import { Button } from "./ui/button";
import { LayoutDashboard } from "lucide-react";
import ThemeToggle from "./theme-toggle";
import HeaderMobileNav from "./header-mobile-nav";
import HeaderNav, { NAV } from "./header-nav";
import HeaderShell from "./header-shell";
import { cn } from "@/lib/utils";

// The reference's button: 50px tall, a full pill, 16px at weight 500, and
// 32px of padding either side. Shared by both states so the outline and the
// filled version sit on the same baseline.
// The header's actions, all one height. 40px inside the 56px panel on a phone
// and inside the 64px one from lg, which leaves an even margin above and below
// at both -- and keeps the icon controls on the same baseline as the labelled
// ones rather than a notch shorter.
//
// Fully rounded, following the capsule they sit in: squared-off controls
// inside a capsule read as borrowed from a different design.
const ACTION_BASE =
  "h-10 shrink-0 rounded-full px-4 text-sm font-medium lg:px-5";
const ACTION_PRIMARY = ACTION_BASE;
// A hairline rather than the default border weight, so the secondary action
// recedes behind the primary instead of competing with it.
const ACTION_SECONDARY = cn(ACTION_BASE, "border-border/70 bg-transparent");

// Deliberately a server component, and now deliberately free of Clerk's
// client components. It reads the session with auth(), which runs on the
// server off the verified cookie, so the right-hand side is in the first HTML
// rather than appearing a moment after hydration -- and, unlike <SignedIn> /
// <SignedOut>, it needs no ClerkProvider and therefore loads no Clerk
// JavaScript for a visitor who is not signed in. The collapsible menu is the
// only part that needs state, and it lives in its own client component.
//
// No appearance customizer here: it tunes the signed-in dashboard, so it
// belongs to the (main) shell rather than the public pages. The light/dark
// toggle stays, since that is useful to a logged-out visitor too.
//
// No user sync here either. This renders on every route including the landing
// page, so syncing the Clerk user from here meant a Clerk lookup plus a Prisma
// round trip for logged-out visitors. The sync lives in the (main) layout,
// which only wraps the authenticated routes that actually need the row.

// The bar itself is HeaderShell, a client component that owns one boolean:
// whether the page has been scrolled. At the top of a page the header floats
// 30px down with no surface of its own; once the page moves it pins to the top
// and takes on a solid background and a soft shadow. Both states, the height
// below and the geometry of everything in the bar were measured off the
// reference rather than chosen. Keeping that boolean in its own component is
// what lets everything here stay server-rendered.
//
// The height is --header-h, declared in globals.css and reserved as padding on
// <main> by the marketing layout, so the bar's size is stated once and every
// page clears it without knowing the number.

const Header = async () => {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  return (
    <HeaderShell>
      <nav className="flex w-full items-center gap-4 lg:gap-8">
        <Link href="/" className="shrink-0">
          {/* Two files rather than a CSS filter: the wordmark is near-black
              navy, which disappears against the dark background, and no filter
              lifts it without flattening the gradient on the bar chart.
              logo-dark.png is the same mark with lightness remapped and hue
              untouched. Only one carries the accessible name. */}
          <Image
            src="/logo.png"
            alt="WHealthOS"
            height={60}
            width={150}
            className="h-[22px] w-auto cursor-pointer object-contain dark:hidden lg:h-[26px]"
          />
          <Image
            src="/logo-dark.png"
            alt=""
            aria-hidden
            height={60}
            width={150}
            className="hidden h-[22px] w-auto cursor-pointer object-contain dark:block lg:h-[26px]"
          />
        </Link>

        {/* Centred on the bar from xl up, where there is room for it: the
            nav is absolutely positioned there, so it sits in the middle of
            the bar rather than wherever the logo and the buttons happen to
            leave it.

            Below xl it stays in the flow with ml-auto instead. Absolute
            centring cannot be pushed: on a 1024-wide screen the centred nav
            reached under the buttons, and dropping About and Contact from the
            bar leaves only about 20px of clearance there -- still not enough
            to centre on. In the flow the two auto margins split the slack
            evenly, so the nav reads as centred between the logo and the
            buttons and cannot collide with either. */}
        <HeaderNav className="hidden lg:ml-auto lg:flex xl:absolute xl:left-1/2 xl:ml-0 xl:-translate-x-1/2" />

        {/* The reference carries one filled pill on the right. WHealthOS needs
            more than one control there, so the hierarchy is kept rather than
            the count: the primary action is the filled pill, the secondary is
            the same pill outlined, and the theme toggle stays an icon. The
            fill is the theme's own primary rather than a hard-coded colour, so
            a visitor who changed the accent still gets their accent. */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle persist={signedIn} className="h-10 w-10" />

          {signedIn ? (
            <>
              <Button variant="outline" asChild className={ACTION_SECONDARY}>
                <Link href="/dashboard">
                  <LayoutDashboard size={18} />
                  <span className="hidden md:inline">Dashboard</span>
                </Link>
              </Button>
              {/* The one Clerk component left on a public page, and it only
                  renders for someone who is signed in -- which is also the
                  only case where the marketing layout mounts ClerkProvider. */}
              <UserAvatar size="h-9 w-9" />
              <HeaderMobileNav nav={NAV} />
            </>
          ) : (
            <>
              {/* asChild: each button renders as its link. A <button> nested
                  inside an <a> is invalid HTML. */}
              <Button
                variant="outline"
                asChild
                className={cn(ACTION_SECONDARY, "hidden md:inline-flex")}
              >
                <Link href="/demo">Explore WHealthOS</Link>
              </Button>
              <Button asChild className={ACTION_PRIMARY}>
                <Link href="/sign-in">Log in</Link>
              </Button>
              {/* showDemoLink: the desktop button is hidden below md, so the
                  menu carries it at those widths. */}
              <HeaderMobileNav nav={NAV} showDemoLink />
            </>
          )}
        </div>
      </nav>
    </HeaderShell>
  );
};

export default Header;
