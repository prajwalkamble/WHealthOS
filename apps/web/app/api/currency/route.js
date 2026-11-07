import { cookies } from "next/headers";
import { isSupported } from "@/lib/currency/registry";
import {
  CURRENCY_COOKIE,
  CURRENCY_SOURCE,
  encodePreference,
} from "@/lib/currency/resolve";
import { PREFERENCE_MAX_AGE, saveDisplayCurrency } from "@/lib/currency/preference";

// Remembering a display currency on the account.
//
// A route handler rather than a Server Action, and that is the entire reason
// it exists. Next re-renders the current route's server components after any
// Server Action resolves, so persisting a preference through one re-rendered
// the whole signed-in tree a moment after every currency change -- which is
// what made switching look like a page reload. A route handler returns JSON
// and nothing re-renders.
//
// It is called in the background, after the browser has already applied the
// change locally and written its own cookie. Nothing waits on the response,
// and a failure changes nothing the person can see.
//
// Deliberately not in isProtectedRoute: it has no session to protect beyond
// the one it checks itself, and a redirect to sign-in is not a useful answer
// to a background fetch. Signed out, it writes the cookie and stops -- there
// is no account to remember anything on, and nothing here can be used to
// read or change one.
export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }

  const currency = body?.currency;
  // Validated against the registry, never a regex: the only acceptable values
  // are currencies this deployment actually supports.
  if (!isSupported(currency)) {
    return Response.json({ error: "Unsupported currency" }, { status: 400 });
  }
  const code = String(currency).toUpperCase();

  // Written here as well as in the browser so the two cannot drift, and so a
  // client with cookies blocked still gets the preference onto the next
  // request.
  const store = await cookies();
  store.set(CURRENCY_COOKIE, encodePreference(code, CURRENCY_SOURCE.MANUAL), {
    maxAge: PREFERENCE_MAX_AGE,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  const result = await saveDisplayCurrency(code);
  return Response.json({ currency: code, ...result });
}
