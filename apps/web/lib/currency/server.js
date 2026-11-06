import { cache } from "react";
import { cookies, headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { CURRENCY_COOKIE, resolveCurrency } from "./resolve.js";
import { DEFAULT_CURRENCY } from "./registry.js";

// The display currency for the request being rendered.
//
// Server-side, and that is the whole point. The first paint has to be in the
// right currency: resolving it in the browser would mean every amount on the
// page rendering in rupees and then flipping to dollars a frame later, which
// is both a hydration mismatch and -- on a finance dashboard -- genuinely
// alarming to look at.
//
// Three inputs, none of them trusted blindly: a cookie the person's own
// browser holds, a column on their account, and a country header the edge
// put there. lib/currency/resolve.js decides between them and validates
// every one against the registry.
//
// Memoised per request with React's cache(), not across requests. Five server
// components on one dashboard each need the answer, and without this each
// would re-read the cookie and re-query the account for a value that cannot
// change mid-render. The cache is scoped to a single render pass, so two
// visitors never share one -- which an ordinary module-level cache would get
// catastrophically wrong here.

/**
 * @returns {Promise<{currency: string, source: string, country: string|null, detected: boolean}>}
 */
export const currentCurrency = cache(async function currentCurrency() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const cookie = cookieStore.get(CURRENCY_COOKIE)?.value ?? null;

  // The account's saved preference, when there is an account. A signed-out
  // visitor never touches the database for this.
  let account = null;
  try {
    const { userId } = await auth();
    if (userId) {
      const user = await db.user.findUnique({
        where: { clerkUserId: userId },
        select: { displayCurrency: true },
      });
      account = user?.displayCurrency ?? null;
    }
  } catch {
    // No session, or Clerk is unavailable. A visitor who cannot be
    // identified still gets a currency; they just get the suggested one.
  }

  return resolveCurrency({
    cookie,
    account,
    // No workspaces exist in WHealthOS, so there is never a workspace
    // reporting currency to apply. The argument is passed explicitly rather
    // than omitted, so the day one exists there is one line to change.
    workspace: null,
    headers: headerList,
  });
});

/**
 * The same, for a route or component that only needs the code.
 *
 * Falls back rather than throwing: a page that cannot work out a currency
 * should render in the default, not 500.
 */
export async function currentCurrencyCode() {
  try {
    return (await currentCurrency()).currency;
  } catch {
    return DEFAULT_CURRENCY;
  }
}
