// "Signed in, but is there a WHealthOS account to bill?"
//
// The middleware guarantees a Clerk session on /billing. It does not
// guarantee a row in `users`: that is created at the consent step, and
// somebody who signed in and closed the tab before accepting the Terms has a
// session and no account. Every tenant-scoped query would then resolve to
// nobody, and a subscription has to belong to something.
//
// So they are sent to /welcome, and the thing they were trying to buy travels
// with them. (main)/layout.js does the same for the rest of the signed-in
// app; this exists separately because the destination has to carry a `next`,
// which a layout cannot know -- it has no access to the page's search params.

import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/prisma";
import { safeRedirect } from "@/lib/safe-redirect";

export async function requireBillingAccount(next = "/billing") {
  let userId = null;
  try {
    userId = await getCurrentUserId();
  } catch {
    // No account yet. Deliberately not distinguished from any other failure
    // to resolve one: either way there is nobody to bill, and the consent
    // step is where that is fixed.
    userId = null;
  }

  // Outside the catch on purpose. redirect() works by throwing, and a catch
  // around it would swallow the navigation and carry on rendering a page for
  // a user that does not exist.
  if (!userId) {
    // Validated even though it is ours: this value is about to become a
    // redirect, and the one rule for those is that they are checked at the
    // point of use rather than trusted because of where they came from.
    const destination = safeRedirect(next, "/billing");
    redirect(`/welcome?next=${encodeURIComponent(destination)}`);
  }

  return userId;
}
