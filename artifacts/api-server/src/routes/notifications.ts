import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, pushTokensTable, userSyncTable } from "@workspace/db";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";
import {
  runNotificationJobs,
  sendTestToUser,
  DEFAULT_PREFS,
  type Prefs,
} from "../lib/notifyJobs";

const router: IRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 60, name: "notifications" });

function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

const PREF_KEYS = Object.keys(DEFAULT_PREFS) as Array<keyof Prefs>;

async function readPrefs(userId: string): Promise<Prefs> {
  const rows = await db
    .select()
    .from(userSyncTable)
    .where(
      and(
        eq(userSyncTable.userId, userId),
        eq(userSyncTable.namespace, "notifPrefs"),
      ),
    )
    .limit(1);
  const stored = (rows[0]?.data as Partial<Prefs> | undefined) ?? {};
  return { ...DEFAULT_PREFS, ...stored };
}

// Register (or refresh) a device's Expo push token for the signed-in user.
router.post("/notifications/register", limiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  const token = String(req.body?.token ?? "").trim();
  // Expo tokens look like ExponentPushToken[...] (or ExpoPushToken[...]).
  if (!/^Expo(nent)?PushToken\[/.test(token)) {
    res.status(400).json({ error: "invalid push token" });
    return;
  }
  const platform =
    typeof req.body?.platform === "string"
      ? req.body.platform.slice(0, 20)
      : null;
  try {
    const now = new Date();
    await db
      .insert(pushTokensTable)
      .values({ token, userId, platform, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: pushTokensTable.token,
        set: { userId, platform, updatedAt: now },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "push token register failed");
    res.status(500).json({ error: "register failed" });
  }
});

// Drop a device token (e.g. on sign-out).
router.post("/notifications/unregister", limiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  const token = String(req.body?.token ?? "").trim();
  try {
    if (token) {
      await db
        .delete(pushTokensTable)
        .where(
          and(
            eq(pushTokensTable.token, token),
            eq(pushTokensTable.userId, userId),
          ),
        );
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "push token unregister failed");
    res.status(500).json({ error: "unregister failed" });
  }
});

router.get("/notifications/prefs", limiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  try {
    res.json({ prefs: await readPrefs(userId) });
  } catch (err) {
    logger.error({ err }, "prefs read failed");
    res.status(500).json({ error: "prefs read failed" });
  }
});

router.put("/notifications/prefs", limiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  const body = req.body?.prefs;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "missing prefs" });
    return;
  }
  // Only accept known boolean keys; ignore anything else the client sends.
  const clean: Partial<Prefs> = {};
  for (const k of PREF_KEYS) {
    if (typeof body[k] === "boolean") clean[k] = body[k] as boolean;
  }
  try {
    const existing = await readPrefs(userId);
    const merged: Prefs = { ...existing, ...clean };
    const now = new Date();
    await db
      .insert(userSyncTable)
      .values({ userId, namespace: "notifPrefs", data: merged, updatedAt: now })
      .onConflictDoUpdate({
        target: [userSyncTable.userId, userSyncTable.namespace],
        set: { data: merged, updatedAt: now },
      });
    res.json({ prefs: merged });
  } catch (err) {
    logger.error({ err }, "prefs write failed");
    res.status(500).json({ error: "prefs write failed" });
  }
});

// Fire a test push to the caller's own devices (proves the pipeline).
router.post("/notifications/test", limiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  try {
    const sent = await sendTestToUser(userId);
    res.json({ ok: true, sent });
  } catch (err) {
    logger.error({ err }, "test push failed");
    res.status(500).json({ error: "test push failed" });
  }
});

// Cron entry point. NOT Clerk-protected — guarded by a shared secret header so
// only the Scheduled Deployment (which knows NOTIFY_CRON_KEY) can trigger it.
router.post("/notifications/cron", async (req, res) => {
  const key = process.env.NOTIFY_CRON_KEY;
  if (!key) {
    res.status(503).json({ error: "cron not configured" });
    return;
  }
  if (req.get("x-cron-key") !== key) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const result = await runNotificationJobs();
    logger.info({ summary: result.summary }, "notification cron run");
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "notification cron failed");
    res.status(500).json({ error: "cron failed" });
  }
});

export default router;
