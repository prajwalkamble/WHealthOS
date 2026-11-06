"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// How long the pointer has to stay on a link before it counts as intent.
// Short enough that the prefetch is already in flight by the time a deliberate
// click lands, long enough that a pointer crossing the sidebar on its way
// somewhere else does not fetch all eight pages on the way past.
export const HOVER_DELAY_MS = 120;

// Hrefs this hook will not prefetch, whatever the caller asks for:
//
// - a hash link ("/#features") is a scroll on a page already open, and the
//   router has nothing to fetch for it;
// - anything absolute belongs to another origin, which Next cannot prefetch
//   and which has no business being warmed from here. That includes the
//   protocol-relative form: "//example.com" begins with a slash and looks
//   local to a naive check, but the browser reads it as another host.
//
// A non-string href (Link also accepts a UrlObject) is refused for the same
// reason the rest of this file is careful: there is no cheap way to tell
// whether it is internal, and guessing wrong means a request nobody asked for.
export const isPrefetchable = (href) =>
  typeof href === "string" &&
  href.startsWith("/") &&
  !href.startsWith("//") &&
  !href.includes("#");

/**
 * Navigation-intent detection, one link per call.
 *
 * Detection only. This hook decides *when* somebody means to navigate; what
 * that is worth is the caller's business, and in this application the answer
 * is always "let the router fetch the destination" -- the pages under (main)
 * are server components, so their data arrives inside the RSC payload and
 * warming the route warms the figures with it. There is no separate data
 * cache to prime and no query key to match.
 *
 * `armed` is the mechanism, not a status flag. It starts false, which lets the
 * caller render `<Link prefetch={false}>` and keep Next from fetching all
 * eight sidebar destinations the moment the rail scrolls into view. On intent
 * it latches true, and Next then performs a full prefetch of every segment --
 * the documented behaviour of `prefetch` being explicitly true, and the only
 * way to get the page's own data rather than the `loading.js` skeleton.
 *
 * It latches rather than tracking the pointer, so leaving and returning costs
 * one render in total and no further requests: Next will not refetch an href
 * it already holds.
 *
 * @param {unknown} href destination, as passed to Link
 * @param {{ delay?: number, enabled?: boolean }} [options]
 * @returns {{
 *   armed: boolean,
 *   onPointerEnter: (event?: { pointerType?: string }) => void,
 *   onPointerLeave: () => void,
 *   onTouchStart: () => void,
 *   onFocus: () => void,
 * }}
 */
export function usePrefetchIntent(href, options = {}) {
  const { delay = HOVER_DELAY_MS, enabled = true } = options;

  const router = useRouter();
  const [armed, setArmed] = useState(false);

  const timer = useRef(null);
  // Mirrors `armed` so the handlers can bail out without reading state and
  // without being rebuilt when it changes. Once a destination is warm, a
  // hundred more hovers do nothing at all.
  const latched = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A pending timer must not outlive the link. The sidebar remounts its items
  // on navigation, and a timer left behind would fire against an unmounted
  // component -- a leak, and a request for a page nobody is looking at.
  useEffect(() => cancel, [cancel]);

  const arm = useCallback(() => {
    if (latched.current) return;
    if (!enabled || !isPrefetchable(href)) return;

    latched.current = true;
    setArmed(true);

    // Belt and braces, and deliberately so. Flipping the prop is what gets
    // the full payload, but it only takes effect on the render that follows;
    // this call starts the router working during the gap. Next dedupes by
    // href, so the two do not become two round trips for the same page.
    //
    // Swallowed, both ways it can fail. A prefetch is an optimisation and
    // nothing downstream depends on it: a rejected promise here must not
    // reach an error boundary, and must not stop the click that follows from
    // navigating perfectly normally.
    try {
      const pending = router.prefetch(href);
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {});
      }
    } catch {
      // Ignored for the reason above.
    }
  }, [enabled, href, router]);

  // Desktop. Debounced, and cancelled if the pointer leaves first.
  //
  // A touch produces a pointerenter as well as a touchstart, and on a phone
  // it arrives with the tap -- waiting 120ms to act on it would delay the
  // fetch for no reason. touchstart has already handled that case.
  const onPointerEnter = useCallback(
    (event) => {
      if (event?.pointerType === "touch") return;
      if (latched.current) return;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        arm();
      }, delay);
    },
    [arm, cancel, delay]
  );

  // Mobile: no hover to wait for, so the tap is the intent.
  const onTouchStart = useCallback(() => arm(), [arm]);

  // Keyboard. Tabbing onto a link is as clear a statement of intent as
  // hovering it, and acting on focus is additive -- it changes nothing about
  // how the link behaves for a keyboard user, who still reaches it, reads it
  // and activates it exactly as before.
  const onFocus = useCallback(() => arm(), [arm]);

  return { armed, onPointerEnter, onPointerLeave: cancel, onTouchStart, onFocus };
}
