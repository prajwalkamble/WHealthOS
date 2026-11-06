import { auth } from "@clerk/nextjs/server";
import { ActionError } from "./action-error";

// The signed-in Clerk user id, for work that must happen before the tenant
// transaction opens (rate limiting). withCurrentTenant checks again inside.
export async function requireClerkUserId() {
  const { userId } = await auth();
  if (!userId) throw new ActionError("Unauthorized");
  return userId;
}

// The signed-in Clerk user id, or null.
//
// The non-throwing counterpart, for the few actions a signed-out visitor is
// allowed to take -- choosing a display currency is one: the guest dashboard
// would be pointless if picking a currency required an account. Anything that
// writes a user's data uses requireClerkUserId instead.
export async function currentClerkUserId() {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    return null;
  }
}
