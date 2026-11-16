"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
// From storage-key rather than from store: store pulls in the sample dataset
// and the dashboard computation, and this page only needs the key.
import { DEMO_STORAGE_KEY } from "@/lib/demo/storage-key";
import { landingActions, DEMO_HREF, SIGN_UP_HREF } from "@/lib/landing/cta";

// The buttons, which depend on who is reading the page.
//
// Three states, and only two of them are knowable on the server:
//
// - signed in. auth() answers this, so it arrives as a prop.
// - a guest with a demo session. Demo mode keeps everything in localStorage
//   and sets no cookie, by design -- so the server cannot know, and this is
//   the only reason any of this is a client component.
// - neither: a first-time visitor.
//
// `guest` starts null, meaning "not looked yet", and the null branch renders
// the first-time variant. That is deliberate: it is what the server renders
// too, so the first client pass agrees with it and there is no hydration
// mismatch and no flicker for the visitor this page is mostly for. The same
// reasoning as lib/demo/store.js, which reads its rows on the pass after
// mount for exactly this reason.
const PricingCta = ({ signedIn, size }) => {
  const [guest, setGuest] = useState(null);

  useEffect(() => {
    // Somebody signed in is not a guest whatever is in storage, and asking
    // would only produce a worse set of buttons for them.
    if (signedIn) return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY));
      setGuest(Array.isArray(raw) && raw.length > 0);
    } catch {
      // Blocked, private or corrupt storage. Treated as a first visit, which
      // is the variant that assumes the least.
      setGuest(false);
    }
  }, [signedIn]);

  // The account holder. One action, and not the sample data: /demo is still
  // public and still reachable by URL, but an invitation to sample figures is
  // not worth a button on a page being read by somebody who has the real
  // thing. This branch used to keep it; the rule changed on 2026-11-13 and
  // now comes from lib/landing/cta.js, shared with the landing page, /about
  // and the footer so the site cannot say two different things.
  if (signedIn) {
    const { primary } = landingActions(true, { signUp: "Get Started Free" });
    return (
      <Button size={size} asChild>
        <Link href={primary.href}>{primary.label}</Link>
      </Button>
    );
  }

  // A guest who has already added rows in the demo. Sending them to "try it"
  // offers something they are in the middle of; what they have not got is an
  // account.
  if (guest) {
    return (
      <>
        <Button size={size} asChild>
          <Link href={DEMO_HREF}>Back to your demo</Link>
        </Button>
        <Button size={size} variant="outline" asChild>
          <Link href={SIGN_UP_HREF}>Create a free account</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <Button size={size} asChild>
        <Link href={DEMO_HREF}>Try it (Sample Data!)</Link>
      </Button>
      <Button size={size} variant="outline" asChild>
        <Link href={SIGN_UP_HREF}>Create a free account</Link>
      </Button>
    </>
  );
};

export default PricingCta;
