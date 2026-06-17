import { Router, type IRouter, type Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  userSyncTable,
  pushTokensTable,
  notifLogTable,
} from "@workspace/db";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";

// Permanent account deletion (App Store / Play Store compliance: a signed-in
// user must be able to delete their account and all associated data from inside
// the app). Works for EVERY sign-in method — email/password, Google and Apple —
// because deleting the Clerk user also removes all of its linked external
// (OAuth) accounts. There is no separate per-provider path.

const deleteLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  name: "account-delete",
});

// Resolve the signed-in Clerk user id, or null. getAuth throws if
// clerkMiddleware didn't run for the request, so guard it.
function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

const router: IRouter = Router();

router.delete("/account", deleteLimiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  try {
    // 1. Remove every piece of per-user data we store: saved slips, pick
    //    tracker, graded results, notification preferences and background coach
    //    stashes (all in user_sync), plus device push tokens and the
    //    notification dedupe log. Do this BEFORE deleting the auth user so a
    //    failure here leaves the account intact and retryable rather than
    //    orphaning records under a deleted id. All deletes are idempotent.
    await db.delete(userSyncTable).where(eq(userSyncTable.userId, userId));
    await db.delete(pushTokensTable).where(eq(pushTokensTable.userId, userId));
    await db.delete(notifLogTable).where(eq(notifLogTable.userId, userId));

    // 2. Delete the user from the authentication system. This also removes any
    //    linked Google / Apple / password identities, so it covers all sign-in
    //    methods.
    await clerkClient.users.deleteUser(userId);

    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err }, "account deletion failed");
    res.status(500).json({ error: "account deletion failed" });
  }
});

export default router;
