"use client";

import { useEffect, useRef, useState } from "react";
import PrefetchLink from "@/components/navigation/prefetch-link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// The marketing nav. Where it sits in the bar is the caller's business --
// header.jsx centres it from xl up and lets it flow below that.
//
// Its own client component so the header itself can stay on the server, where
// Clerk's <SignedIn>/<SignedOut> resolve from the verified session. Nothing
// here depends on auth.

// Items without an href have no page behind them yet, so they render as plain
// text rather than as links that go nowhere.
//
// No About or Contact. They are the footer's Company group now, by
// instruction, and the bar carries what someone is deciding between rather
// than what they read once.
export const NAV = [
  {
    label: "Product",
    items: [
      {
        label: "Dashboard",
        description: "Balances, cash flow and spending at a glance",
        href: "/demo",
      },
      {
        label: "Transactions",
        description: "Every payment in one searchable ledger",
        href: "/demo/transactions",
      },
      {
        label: "Budgets",
        description: "Set a monthly limit and track against it",
      },
      {
        label: "AI Insights",
        description: "A monthly read on where your money went",
      },
    ],
  },
  {
    label: "Features",
    items: [
      {
        label: "Advanced Analytics",
        description: "Trends across months, not just this one",
        href: "/#features",
      },
      {
        label: "Smart Receipt Scanner",
        description: "Photograph a receipt, get a filled-in transaction",
        href: "/#features",
      },
      {
        label: "Multi-Account Support",
        description: "Current and savings accounts side by side",
        href: "/#features",
      },
      {
        label: "Multi-Currency",
        description: "Track money held in more than one currency",
        href: "/#features",
      },
    ],
  },
  { label: "Pricing", href: "/pricing" },
  {
    label: "Resources",
    items: [
      { label: "Documentation", description: "How everything works" },
      { label: "Help Center", description: "Answers to common questions" },
      { label: "Getting Started", description: "From sign-up to first insight" },
      { label: "Changelog", description: "What shipped recently" },
    ],
  },
];

// A same-page anchor, scrolled rather than jumped.
//
// Only for a link whose href is "/#thing" when the browser is already on "/".
// Anywhere else it does nothing and the Link navigates normally, so following
// Features from /pricing is still a route change that happens to land on a
// fragment.
//
// Smoothing lives here rather than in a global `html { scroll-behavior:
// smooth }` because that declaration breaks the other case: loading /#features
// directly, the browser animates towards the fragment and the App Router's own
// scroll handling cancels the animation partway, leaving the reader at the top
// of the page. Doing it per control, as components/back-to-top.jsx already
// does, smooths the click without touching the load. globals.css records the
// measurement.
//
// scroll-padding-top on <html> supplies the offset for the fixed header, so
// there is no magic number here.
const scrollToHash = (event, href) => {
  if (typeof window === "undefined") return;
  if (!href?.startsWith("/#")) return;
  if (window.location.pathname !== "/") return;

  const target = document.getElementById(href.slice(2));
  if (!target) return;

  event.preventDefault();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  // The fragment still belongs in the address bar: a reader who copies the URL
  // should get the section back, and the back button should return them.
  window.history.pushState(null, "", href);
};

// A short grace period on leaving, so moving the pointer diagonally from the
// trigger down into the panel does not close it on the way.
const CLOSE_DELAY_MS = 120;

// Measured off the reference: 17px at weight 500, with 13px of padding either
// side of each item -- so the visual gap between two labels is 26px and the
// padding is also the hover target. The container carries no gap of its own
// for that reason.
// Navigation reads as navigation: muted until it is wanted, the theme's own
// foreground on hover and focus, and no surface of its own. The padding is the
// hover target rather than a visible shape -- an item that draws a box around
// itself is a button, and four buttons in a row is a toolbar, not a nav.
//
// The focus ring is the one state that does draw a shape, because it has to.
const triggerClass = cn(
  "flex items-center gap-1 rounded-md px-3 py-1.5 text-[15px] font-medium",
  "text-muted-foreground transition-colors duration-150 hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background"
);

const HeaderNav = ({ className }) => {
  const [openLabel, setOpenLabel] = useState(null);
  const timer = useRef(null);

  const cancelClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => setOpenLabel(null), CLOSE_DELAY_MS);
  };

  const open = (label) => {
    cancelClose();
    setOpenLabel(label);
  };

  useEffect(() => cancelClose, []);

  // Escape closes, the way any menu should.
  useEffect(() => {
    if (!openLabel) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpenLabel(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openLabel]);

  return (
    <div className={cn("flex items-center", className)}>
      {NAV.map(({ label, href, items }) => {
        if (!items) {
          return href ? (
            <PrefetchLink key={label} href={href} className={triggerClass}>
              {label}
            </PrefetchLink>
          ) : (
            <span key={label} className={cn(triggerClass, "cursor-default")}>
              {label}
            </span>
          );
        }

        const isOpen = openLabel === label;

        return (
          <div
            key={label}
            className="relative"
            onMouseEnter={() => open(label)}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              className={triggerClass}
              aria-expanded={isOpen}
              aria-haspopup="true"
              // Keyboard users get the same menu: focus opens it, and the
              // panel closes when focus leaves the whole group.
              onFocus={() => open(label)}
              onClick={() => setOpenLabel(isOpen ? null : label)}
            >
              {label}
              {/* Small and half-strength: the chevron says a panel exists,
                  it is not a second piece of punctuation. */}
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-3.5 w-3.5 opacity-60 transition-transform duration-200 motion-reduce:transition-none",
                  isOpen && "rotate-180"
                )}
              />
            </button>

            {isOpen && (
              <div
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setOpenLabel(null);
                  }
                }}
                className="absolute left-1/2 top-full z-50 w-[290px] -translate-x-1/2 pt-2.5"
              >
                {/* The padding above sits inside the hover area, so the gap
                    between trigger and panel does not count as "left". */}
                {/* Matched to the header panel: the same 16px corners, the
                    same hairline border and the same glass, so the dropdown
                    reads as the panel extending rather than as a separate
                    object appearing underneath it.

                    The shadow is low-contrast and pulled in by a negative
                    spread -- enough to lift the panel off the page, not enough
                    to be a feature of its own. It fades and rises 2px, which
                    is the smallest movement that reads as "this came from the
                    trigger"; motion-reduce drops the rise. */}
                <div className="overflow-hidden rounded-2xl border border-border/60 bg-popover/95 p-2 text-popover-foreground shadow-panel backdrop-blur-md backdrop-saturate-150 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                  {items.map((item) =>
                    item.href ? (
                      <PrefetchLink
                        key={item.label}
                        href={item.href}
                        onClick={(event) => {
                          setOpenLabel(null);
                          scrollToHash(event, item.href);
                        }}
                        className="block rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block text-sm font-medium leading-snug">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                          {item.description}
                        </span>
                      </PrefetchLink>
                    ) : (
                      <span
                        key={item.label}
                        className="block cursor-default rounded-xl px-3 py-2.5"
                      >
                        <span className="block text-sm font-medium leading-snug">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HeaderNav;
