"use server";

import { cookies } from "next/headers";
import { withCurrentTenant } from "@/lib/prisma";
import {
  CURRENCY_COOKIE,
  CURRENCY_SOURCE,
  encodePreference,
} from "@/lib/currency/resolve";
import { isSupported } from "@/lib/currency/registry";
import { ActionError, runAction } from "@/lib/action-error";
import { enforceRateLimit } from "@/lib/arcjet";
import { currentClerkUserId } from "@/lib/session";

// Choosing a display currency.
//
// Two places remember it, for two different reasons. The cookie is what the
// NEXT request reads before any database call, so the first paint after a
// change is already correct -- and it is the only store a signed-out visitor
// has. The column is what follows an account to another browser.
//
// The cookie is written for everyone, including signed-in users: a server
// component that resolves currency must not have to wait on a query to know
// what to render, and the two are written together so they cannot disagree.
//
// This changes what somebody READS. It does not touch a single stored amount,
// an account's currency or a transaction's currency, and there is deliberately
// no code path here that could.

// A year. Long enough that a returning visitor is not re-asked, short enough
// that a stale preference eventually lapses.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function setDisplayCurrency(currency) {
  return runAction(async () => {
    // Validated against the registry, not against a regex: the only
    // acceptable values are currencies this deployment actually supports, and
    // this is the only gate between a form field and a stored preference.
    if (!isSupported(currency)) {
      throw new ActionError("That is not a currency WHealthOS supports.");
    }
    const code = String(currency).toUpperCase();

    // The browser has already written this cookie synchronously, before this
    // action was called -- that is what makes the change instant. Written
    // again here only so the two cannot drift, and so a client with cookies
    // blocked still gets the preference onto the next request.
    const store = await cookies();
    store.set(CURRENCY_COOKIE, encodePreference(code, CURRENCY_SOURCE.MANUAL), {
      maxAge: COOKIE_MAX_AGE,
      // Readable by the server on every request; there is nothing secret in
      // it, and httpOnly would stop the client provider reading its own
      // starting value.
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    // Signed in or not: a visitor choosing a currency is not an account
    // operation, and refusing a guest would defeat the guest dashboard.
    const clerkUserId = await currentClerkUserId();
    if (clerkUserId) {
      await enforceRateLimit("write", clerkUserId);
      // Through withCurrentTenant, not the bare client. Every query on the
      // request-scoped client runs under row-level security, and without a
      // tenant set the policies match nothing -- the write would silently
      // affect zero rows and the preference would never leave this request.
      await withCurrentTenant((tx, userId) =>
        tx.user.update({
          where: { id: userId },
          data: { displayCurrency: code },
        })
      );
    }

    // Deliberately NO revalidatePath.
    //
    // It used to call revalidatePath("/", "layout"), which re-rendered the
    // whole signed-in tree on the server and streamed it back -- for a change
    // the browser had already made locally. That was the page "reloading":
    // scroll position lost, open dialogs closed, filters reset, every
    // dashboard query re-run, on every click of the currency selector.
    //
    // Nothing needs it. The figures are converted in the browser from the
    // rate table it already holds, and the cookie is written there too, so
    // the next genuine navigation already renders in the right currency.
    // This action now does exactly one thing that matters: remember the
    // choice on the account so it follows the person to another device.
    return { currency: code };
  });
}
