import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, userSyncTable } from "@workspace/db";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";

// Per-user cloud sync. A signed-in user's saved slips / pick history are stored
// here so they follow the account across devices. Anonymous requests are
// rejected (clients fall back to local-only storage). `data` is an opaque JSON
// blob the client owns; the server only persists and returns it.

// Namespaces a signed-in client may READ. "coachBuild" is written server-side
// by the /chat route (a parlay the user walked away from, finished in the
// background) and only READ by the client on return.
const READABLE_NAMESPACES = new Set(["savedSlips", "tracker", "results", "coachBuild"]);
// Namespaces a client may WRITE. "coachBuild" is intentionally EXCLUDED so the
// stashed finished ticket stays server-authored — a client can never overwrite
// it with fabricated picks (honesty: replayed builds are exactly what the model
// produced server-side).
const WRITABLE_NAMESPACES = new Set(["savedSlips", "tracker", "results"]);

const syncLimiter = rateLimit({ windowMs: 60_000, max: 120, name: "sync" });

// Resolve the signed-in Clerk user id, or null. getAuth throws if
// clerkMiddleware didn't run for the request, so guard it.
function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

// Express 5 types a route param as string | string[]; normalize to a string.
function paramStr(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const router: IRouter = Router();

router.get("/sync/:namespace", syncLimiter, async (req, res) => {
  const ns = paramStr(req.params.namespace);
  if (!READABLE_NAMESPACES.has(ns)) {
    res.status(400).json({ error: "unknown namespace" });
    return;
  }
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(userSyncTable)
      .where(
        and(eq(userSyncTable.userId, userId), eq(userSyncTable.namespace, ns)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.json({ data: null, updatedAt: null });
      return;
    }
    res.json({ data: row.data, updatedAt: row.updatedAt });
  } catch (err) {
    logger.error({ err }, "sync read failed");
    res.status(500).json({ error: "sync read failed" });
  }
});

router.put("/sync/:namespace", syncLimiter, async (req, res) => {
  const ns = paramStr(req.params.namespace);
  if (!WRITABLE_NAMESPACES.has(ns)) {
    res.status(400).json({ error: "unknown namespace" });
    return;
  }
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  const data = req.body?.data;
  if (data === undefined) {
    res.status(400).json({ error: "missing data" });
    return;
  }
  try {
    const now = new Date();
    await db
      .insert(userSyncTable)
      .values({ userId, namespace: ns, data, updatedAt: now })
      .onConflictDoUpdate({
        target: [userSyncTable.userId, userSyncTable.namespace],
        set: { data, updatedAt: now },
      });
    res.json({ updatedAt: now });
  } catch (err) {
    logger.error({ err }, "sync write failed");
    res.status(500).json({ error: "sync write failed" });
  }
});

export default router;
