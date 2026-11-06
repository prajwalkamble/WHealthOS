"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { usePrefetchIntent } from "./use-prefetch-intent";

/**
 * A Link that fetches its destination when somebody looks like they are about
 * to go there, instead of when it scrolls into view.
 *
 * Three tiers, because not every destination is worth the same work:
 *
 * - "full" (the default) turns Next's automatic prefetch off and performs a
 *   complete one -- every segment, the page's own data included -- on hover,
 *   touch or focus. For the pages under (main) that means the Prisma work in
 *   lib/queries.js has already run by the time the click lands.
 *
 * - "shell" leaves Next alone to do what it does by default: fetch the shared
 *   layout down to the first `loading.js` and stop. For a destination whose
 *   render is expensive or gated, that is the right amount -- the skeleton
 *   appears instantly and the data is fetched when it is actually wanted.
 *
 * - "none" asks for nothing at all, for a destination that should only ever be
 *   reached deliberately.
 *
 * Everything else about the link is unchanged: same markup, same keyboard
 * behaviour, same className, and a ref that still reaches the anchor -- which
 * matters because the sidebar renders these through Radix's Slot.
 */
const PrefetchLink = forwardRef(function PrefetchLink(
  {
    href,
    intent = "full",
    children,
    onPointerEnter,
    onPointerLeave,
    onTouchStart,
    onFocus,
    ...rest
  },
  ref
) {
  // Called unconditionally -- a hook cannot be skipped for a tier -- and told
  // to do nothing unless this link is the kind that warms its destination.
  const warm = usePrefetchIntent(href, { enabled: intent === "full" });

  // The caller's handler still runs, and runs first. These links sit inside
  // components that already listen for pointer events, and prefetching is not
  // a reason for one of them to stop working.
  const compose = (theirs, ours) =>
    ours
      ? (event) => {
          theirs?.(event);
          ours(event);
        }
      : theirs;

  // "shell" is the only tier that leaves the prop off, because undefined is
  // how Next spells its own default. The other two start at false: "none"
  // stays there, and "full" is flipped to true by the hook on intent.
  const prefetch = intent === "shell" ? undefined : warm.armed;

  return (
    <Link
      ref={ref}
      href={href}
      prefetch={prefetch}
      onPointerEnter={compose(onPointerEnter, intent === "full" ? warm.onPointerEnter : null)}
      onPointerLeave={compose(onPointerLeave, intent === "full" ? warm.onPointerLeave : null)}
      onTouchStart={compose(onTouchStart, intent === "full" ? warm.onTouchStart : null)}
      onFocus={compose(onFocus, intent === "full" ? warm.onFocus : null)}
      {...rest}
    >
      {children}
    </Link>
  );
});

export default PrefetchLink;
