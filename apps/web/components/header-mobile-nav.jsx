"use client";

import { useEffect, useState } from "react";
import PrefetchLink from "@/components/navigation/prefetch-link";
import { Menu, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

// Only the collapsible menu is a client component.
//
// The header itself stays on the server so Clerk's <SignedIn>/<SignedOut> can
// resolve there: in a client component they depend on auth state that is not
// known until Clerk loads in the browser, so the whole right-hand side of the
// bar rendered empty in the initial HTML and popped in after hydration.
const HeaderMobileNav = ({ nav = [], showDemoLink = false }) => {
  const [open, setOpen] = useState(false);

  // Escape closes it, the way any menu should, and the body does not scroll
  // underneath it while it is open -- the panel covers the viewport's width
  // and scrolling the page behind it leaves the menu pointing at a position
  // the reader can no longer see.
  //
  // The overflow is restored from whatever it was rather than hard-set to
  // "visible", so this cannot fight anything else that locks scrolling.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const linkClass =
    "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0 lg:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Matched to the panel above it: the same 16px corners, the same
          hairline border, the same glass. max-h with its own scroll so a long
          menu cannot run off the bottom of a short phone. */}
      {open && (
        <div className="absolute inset-x-0 top-full mt-2 max-h-[calc(100vh-var(--header-space)-1.5rem)] overflow-y-auto rounded-2xl border border-border/60 bg-background/95 shadow-panel backdrop-blur-md backdrop-saturate-150 lg:hidden">
          <div className="flex flex-col gap-0.5 px-4 py-3">
            {/* No hover on a touch screen, so a section's children are simply
                listed under it rather than hidden behind a dropdown. */}
            {nav.map(({ label, href, items }) => (
              <div key={label} className="py-1.5">
                {href ? (
                  <PrefetchLink
                    href={href}
                    className={linkClass}
                    onClick={() => setOpen(false)}
                  >
                    {label}
                  </PrefetchLink>
                ) : (
                  <span
                    className={cn(
                      items
                        ? "text-xs font-semibold uppercase tracking-wider text-foreground"
                        : linkClass,
                      "cursor-default"
                    )}
                  >
                    {label}
                  </span>
                )}

                {items && (
                  <div className="mt-1.5 flex flex-col gap-1 border-l pl-3">
                    {items.map((item) =>
                      item.href ? (
                        <PrefetchLink
                          key={item.label}
                          href={item.href}
                          className={cn(linkClass, "py-1")}
                          onClick={() => setOpen(false)}
                        >
                          {item.label}
                        </PrefetchLink>
                      ) : (
                        <span
                          key={item.label}
                          className={cn(linkClass, "cursor-default py-1")}
                        >
                          {item.label}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}

            {showDemoLink && (
              <Button variant="outline" asChild className="mt-2 sm:hidden">
                <PrefetchLink href="/demo" onClick={() => setOpen(false)}>
                  Explore WHealthOS
                </PrefetchLink>
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default HeaderMobileNav;
