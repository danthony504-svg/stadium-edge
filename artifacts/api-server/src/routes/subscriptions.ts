import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  subscriptionEntitlementsTable,
  subscriptionEventsTable,
} from "@workspace/db";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";

/**
 * Apple / RevenueCat subscription sync.
 *
 * - POST /subscriptions/sync — signed-in client pushes StoreKit snapshot
 * - GET  /subscriptions/entitlement — signed-in client reads server copy
 * - POST /subscriptions/webhooks/revenuecat — RevenueCat server notifications
 *   (Authorization: Bearer $REVENUECAT_WEBHOOK_SECRET)
 *
 * Appearance under iOS Settings → Subscriptions is owned by Apple StoreKit
 * auto-renewables; this route only mirrors entitlement state for the backend.
 */

const syncLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  name: "subscriptions-sync",
});

const entitlementLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  name: "subscriptions-entitlement",
});

const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  name: "subscriptions-webhook",
});

function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

function isPlanId(value: unknown): value is "free" | "go" | "pro" {
  return value === "free" || value === "go" || value === "pro";
}

/** Map RevenueCat product identifiers → plan. */
function planFromProductId(productId: string | null | undefined): "go" | "pro" | null {
  if (!productId) return null;
  if (productId === "com.stadiumedge.app.pro.monthly") return "pro";
  if (productId === "com.stadiumedge.app.go.weekly") return "go";
  // Loose fallbacks for RC sandbox aliases
  const lower = productId.toLowerCase();
  if (lower.includes("pro.monthly") || lower.endsWith(".pro.monthly")) return "pro";
  if (lower.includes("go.weekly") || lower.endsWith(".go.weekly")) return "go";
  return null;
}

function planFromEntitlementIds(ids: unknown): "go" | "pro" | null {
  if (!Array.isArray(ids)) return null;
  const lower = ids.map((id) => String(id).toLowerCase());
  if (lower.includes("pro")) return "pro";
  if (lower.includes("go")) return "go";
  return null;
}

function webhookAuthorized(req: Request): boolean {
  const secret = (process.env.REVENUECAT_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return false;
  const auth = req.header("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const alt = req.header("x-revenuecat-secret") ?? "";
  return alt === secret;
}

async function upsertEntitlement(input: {
  userId: string;
  planId: "free" | "go" | "pro";
  productId: string | null;
  status: string;
  expiresAt: Date | null;
  managementUrl: string | null;
  originalAppUserId: string | null;
  source: string;
  storeKitActive: boolean;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(subscriptionEntitlementsTable)
    .values({
      userId: input.userId,
      planId: input.planId,
      productId: input.productId,
      status: input.status,
      expiresAt: input.expiresAt,
      managementUrl: input.managementUrl,
      originalAppUserId: input.originalAppUserId,
      source: input.source,
      storeKitActive: input.storeKitActive,
      updatedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptionEntitlementsTable.userId,
      set: {
        planId: input.planId,
        productId: input.productId,
        status: input.status,
        expiresAt: input.expiresAt,
        managementUrl: input.managementUrl,
        originalAppUserId: input.originalAppUserId,
        source: input.source,
        storeKitActive: input.storeKitActive,
        updatedAt: now,
      },
    });
}

async function recordEvent(input: {
  eventKey: string;
  userId: string | null;
  eventType: string;
  payload: string;
}): Promise<boolean> {
  try {
    await db.insert(subscriptionEventsTable).values({
      eventKey: input.eventKey,
      userId: input.userId,
      eventType: input.eventType,
      payload: input.payload,
    });
    return true;
  } catch (err) {
    // Unique violation = already processed
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) return false;
    throw err;
  }
}

const router: IRouter = Router();

router.post("/subscriptions/sync", syncLimiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  try {
    const body = req.body ?? {};
    const fromEntitlements = planFromEntitlementIds(body.entitlementIds);
    const productIds: string[] = Array.isArray(body.productIds)
      ? body.productIds.map(String)
      : [];
    const fromProducts =
      productIds.map(planFromProductId).find((p) => p != null) ?? null;
    let planId: "free" | "go" | "pro" = "free";
    if (isPlanId(body.planId) && body.planId !== "free") {
      planId = body.planId;
    } else if (fromEntitlements) {
      planId = fromEntitlements;
    } else if (fromProducts) {
      planId = fromProducts;
    }
    const productId = productIds[0] ?? null;
    const storeKitActive = planId !== "free";
    await upsertEntitlement({
      userId,
      planId,
      productId,
      status: storeKitActive ? "active" : "expired",
      expiresAt: null,
      managementUrl:
        typeof body.managementUrl === "string" ? body.managementUrl : null,
      originalAppUserId:
        typeof body.originalAppUserId === "string" ? body.originalAppUserId : null,
      source: "client_sync",
      storeKitActive,
    });
    await recordEvent({
      eventKey: `client_sync:${userId}:${Date.now()}`,
      userId,
      eventType: "CLIENT_SYNC",
      payload: JSON.stringify({ planId, productIds }).slice(0, 4000),
    });
    res.json({ ok: true, planId, storeKitActive });
  } catch (err) {
    logger.error({ err }, "subscription sync failed");
    res.status(500).json({ error: "sync failed" });
  }
});

router.get("/subscriptions/entitlement", entitlementLimiter, async (req, res) => {
  const userId = clerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(subscriptionEntitlementsTable)
      .where(eq(subscriptionEntitlementsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.json({ ok: true, entitlement: null });
      return;
    }
    res.json({
      ok: true,
      entitlement: {
        planId: row.planId === "go" || row.planId === "pro" ? row.planId : null,
        productId: row.productId,
        status: row.status,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        managementUrl: row.managementUrl,
        source: row.source,
      },
    });
  } catch (err) {
    logger.error({ err }, "subscription entitlement read failed");
    res.status(500).json({ error: "entitlement read failed" });
  }
});

/**
 * RevenueCat webhook — configure Authorization header = Bearer <secret>.
 * Docs: https://www.revenuecat.com/docs/webhooks
 */
router.post(
  "/subscriptions/webhooks/revenuecat",
  webhookLimiter,
  async (req, res) => {
    if (!webhookAuthorized(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const body = req.body ?? {};
      const event = body.event ?? body;
      const eventId =
        typeof event.id === "string"
          ? event.id
          : typeof body.id === "string"
            ? body.id
            : `rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const eventType = String(event.type ?? body.type ?? "UNKNOWN");
      const appUserId = String(
        event.app_user_id ?? event.appUserId ?? body.app_user_id ?? "",
      ).trim();
      // Clerk user ids are used as RevenueCat appUserID when signed in.
      const userId = appUserId && !appUserId.startsWith("$RCAnonymousID")
        ? appUserId
        : null;

      const firstInsert = await recordEvent({
        eventKey: `rc:${eventId}`,
        userId,
        eventType,
        payload: JSON.stringify(body).slice(0, 8000),
      });
      if (!firstInsert) {
        res.json({ ok: true, duplicate: true });
        return;
      }

      if (!userId) {
        res.json({ ok: true, skipped: "no_clerk_user" });
        return;
      }

      const productId = String(
        event.product_id ?? event.productId ?? event.new_product_id ?? "",
      ).trim() || null;
      const entitlementIds: string[] = Array.isArray(event.entitlement_ids)
        ? event.entitlement_ids.map(String)
        : Array.isArray(event.entitlementIds)
          ? event.entitlementIds.map(String)
          : [];

      const expiredTypes = new Set([
        "EXPIRATION",
        "CANCELLATION",
        "SUBSCRIPTION_PAUSED",
      ]);
      const activeTypes = new Set([
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "PRODUCT_CHANGE",
        "NON_RENEWING_PURCHASE",
      ]);

      let planId: "free" | "go" | "pro" = "free";
      let storeKitActive = false;
      let status = "unknown";

      if (expiredTypes.has(eventType)) {
        planId = "free";
        storeKitActive = false;
        status = eventType === "CANCELLATION" ? "cancelled" : "expired";
      } else if (activeTypes.has(eventType) || eventType === "TRANSFER") {
        planId =
          planFromEntitlementIds(entitlementIds) ??
          planFromProductId(productId) ??
          "pro";
        storeKitActive = planId !== "free";
        status = "active";
      } else if (eventType === "BILLING_ISSUE") {
        status = "billing_issue";
        planId =
          planFromEntitlementIds(entitlementIds) ??
          planFromProductId(productId) ??
          "free";
        storeKitActive = planId !== "free";
      }

      const expirationMs =
        typeof event.expiration_at_ms === "number"
          ? event.expiration_at_ms
          : typeof event.expirationAtMs === "number"
            ? event.expirationAtMs
            : null;

      await upsertEntitlement({
        userId,
        planId,
        productId,
        status,
        expiresAt: expirationMs != null ? new Date(expirationMs) : null,
        managementUrl: null,
        originalAppUserId: appUserId || null,
        source: "revenuecat",
        storeKitActive,
      });

      res.json({ ok: true, planId, status });
    } catch (err) {
      logger.error({ err }, "revenuecat webhook failed");
      res.status(500).json({ error: "webhook failed" });
    }
  },
);

export default router;
