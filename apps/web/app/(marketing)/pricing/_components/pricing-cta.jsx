"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
// From storage-key rather than from store: store pulls in the sample dataset
// and the dashboard computation, and this page only needs the key.
import { DEMO_STORAGE_KEY } from "@/lib/demo/storage-key";

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

  // The account holder. The sample-data route stays on offer -- the page is
  // public and the button is what it says it is -- but it is no longer the
  // thing being pointed at.
  if (signedIn) {
    return (
      <>
        <Button size={size} asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button size={size} variant="outline" asChild>
          <Link href="/demo">Try it (Sample Data!)</Link>
        </Button>
      </>
    );
  }

  // A guest who has already added rows in the demo. Sending them to "try it"
  // offers something they are in the middle of; what they have not got is an
  // account.
  if (guest) {
    return (
      <>
        <Button size={size} asChild>
          <Link href="/demo">Back to your demo</Link>
        </Button>
        <Button size={size} variant="outline" asChild>
          <Link href="/sign-up">Create a free account</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <Button size={size} asChild>
        <Link href="/demo">Try it (Sample Data!)</Link>
      </Button>
      <Button size={size} variant="outline" asChild>
        <Link href="/sign-up">Create a free account</Link>
      </Button>
    </>
  );
};

export default PricingCta;
