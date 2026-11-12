import arcjet, { createMiddleware, detectBot, shield } from "@arcjet/next";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every route under app/(main). Listed one by one rather than relying on
// "/account(.*)" to also cover "/accounts": a new page that does not match an
// existing prefix would otherwise be reachable signed out.
// Budgets, Goals and Analytics are listed before they exist on purpose: they
// are already in the sidebar, and adding the page later without remembering
// this file is exactly how one ends up reachable signed out.
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/account(.*)",
  "/accounts(.*)",
  // Internal transfers. The page reads the person's accounts and the server
  // action refuses an anonymous caller on its own; listed here as well so an
  // unauthenticated request never reaches either.
  "/transfer(.*)",
  "/api/export(.*)",
  // The WHOS chat endpoint. Listed here as well as checking the session
  // itself: the route refuses an unauthenticated request on its own, and this
  // means one never reaches it.
  "/api/ai(.*)",
  // Billing: checkout, verification, plan state and cancellation. Each one
  // refuses an anonymous request on its own; listed here as well so one never
  // reaches them.
  //
  // The Razorpay WEBHOOK is deliberately not here and must not be: it is
  // /api/webhooks/razorpay, which has no session to protect, verifies its own
  // signature, and is excluded from this middleware entirely by the matcher
  // below -- Arcjet's detectBot runs LIVE in production and does not allow
  // Razorpay, so a matched webhook path has every delivery blocked.
  "/api/billing(.*)",
  // The billing confirmation page.
  "/billing(.*)",
  "/cards(.*)",
  "/transaction(.*)",
  "/transactions(.*)",
  // The consent step. Protected like the rest: it acts on the signed-in
  // session, and it is where the WHealthOS account is created.
  "/welcome(.*)",
  "/budgets(.*)",
  "/goals(.*)",
  "/analytics(.*)",
  "/settings(.*)",
]);

const aj = arcjet({
  key: process.env.ARCJET_KEY,
  rules: [
    shield({
      mode: "LIVE",
    }),
    detectBot({
      // LIVE only in production so local tooling is not blocked while developing.
      mode: process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN",
      allow: ["CATEGORY:SEARCH_ENGINE", "GO_HTTP"],
    }),
  ],
});

const clerk = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  if(!userId && isProtectedRoute(req)) {
    const { redirectToSignIn } = await auth();

    return redirectToSignIn();
  }
});

export default createMiddleware(aj, clerk);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search
    // params -- and skip the machine endpoints, for the reason below.
    //
    // The exclusions have to be repeated in BOTH patterns. Next runs the
    // middleware when ANY matcher matches, so listing "not webhooks" only in
    // the second one achieved nothing: this pattern matched
    // /api/webhooks/razorpay anyway and Arcjet refused every delivery with a
    // 403. That was invisible in development, where detectBot runs in
    // DRY_RUN, and in production it silently killed every inbound
    // integration -- Razorpay's subscription events, Clerk's user sync, and
    // Inngest, whose crons stopped dead the day this shipped.
    '/((?!_next|api/webhooks/|api/inngest|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes -- except the webhooks and Inngest. detectBot
    // runs LIVE in production and allows neither, so a matched path has every
    // delivery blocked. None of them has a session to protect and each
    // authenticates itself more strongly than bot detection could: the
    // webhooks verify a signature over the raw body, and Inngest verifies
    // INNGEST_SIGNING_KEY.
    '/api/((?!webhooks/|inngest).*)',
    '/trpc(.*)',
  ],
};