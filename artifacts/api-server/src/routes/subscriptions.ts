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
import { isActivePaidEntitlement } from "../lib/subscriptionEntitlement";
import {
  planFromEntitlementIds,
  planFromProductId,
  resolveTrustedEntitlementForClientSync,
} from "../lib/subscriptionSync";
import {
  isRevenueCatServerVerifyConfigured,
  verifyRevenueCatSubscriber,
} from "../lib/revenueCatSubscriber";

/**
 * Apple / RevenueCat subscription sync.
 *
 * - POST /subscriptions/sync — signed-in client may refresh metadata; NEVER
 *   grants Go/Pro from client planId / storeKitActive / catalog claims.
 * - POST /subscriptions/restore-verify — server fetches RevenueCat subscriber
 *   with the secret API key and upserts a trusted DB entitlement (fail-closed).
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

const restoreVerifyLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  name: "subscriptions-restore-verify",
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
    const productIds: string[] = Array.isArray(body.productIds)
      ? body.productIds.map(String)
      : [];
    const existingRows = await db
      .select()
      .from(subscriptionEntitlementsTable)
      .where(eq(subscriptionEntitlementsTable.userId, userId))
      .limit(1);
    const existing = existingRows[0] ?? null;
    const trusted = resolveTrustedEntitlementForClientSync({
      existing: existing
        ? {
            planId: existing.planId,
            storeKitActive: existing.storeKitActive,
            status: existing.status,
            expiresAt: existing.expiresAt,
            productId: existing.productId,
            managementUrl: existing.managementUrl,
            originalAppUserId: existing.originalAppUserId,
            source: existing.source,
          }
        : null,
      body,
    });

    // Only persist when we already have a row, or when refreshing metadata for
    // an existing locked user. Never insert a forged paid grant from the client.
    if (existing || trusted.managementUrl || trusted.originalAppUserId) {
      await upsertEntitlement({
        userId,
        planId: trusted.planId,
        productId: trusted.productId,
        status: trusted.status,
        expiresAt: trusted.expiresAt,
        managementUrl: trusted.managementUrl,
        originalAppUserId: trusted.originalAppUserId,
        source: trusted.source,
        storeKitActive: trusted.storeKitActive,
      });
    }

    await recordEvent({
      eventKey: `client_sync:${userId}:${Date.now()}`,
      userId,
      eventType: "CLIENT_SYNC",
      payload: JSON.stringify({
        planId: trusted.planId,
        storeKitActive: trusted.storeKitActive,
        productIds,
        claimedPlanFromCatalog: trusted.claimedPlanFromCatalog,
        ignoredClientGrantFields: trusted.ignoredClientGrantFields,
        bodyPlanId: body.planId ?? null,
        bodyStoreKitActive: body.storeKitActive ?? null,
      }).slice(0, 4000),
    });

    const active = trusted.storeKitActive && isActivePaidEntitlement(trusted);
    res.json({
      ok: true,
      planId: active ? trusted.planId : "free",
      storeKitActive: active,
      source: trusted.source,
      ignoredClientGrantFields: trusted.ignoredClientGrantFields,
    });
  } catch (err) {
    logger.error({ err }, "subscription sync failed");
    res.status(500).json({ error: "sync failed" });
  }
});

/**
 * After client Restore Purchases: verify entitlement via RevenueCat REST
 * (secret key) and persist a trusted DB row for Coach Q&A. Ignores body planId.
 * Fail closed when RC secret missing, HTTP fails, or subscriber is inactive.
 */
router.post(
  "/subscriptions/restore-verify",
  restoreVerifyLimiter,
  async (req, res) => {
    const userId = clerkUserId(req);
    if (!userId) {
      res.status(401).json({ error: "auth required" });
      return;
    }
    try {
      // Never trust client grant fields — they are ignored for entitlement.
      const body = req.body ?? {};
      void body.planId;
      void body.storeKitActive;

      if (!isRevenueCatServerVerifyConfigured()) {
        // Fail closed: keep existing trusted row if any; do not grant from client.
        const rows = await db
          .select()
          .from(subscriptionEntitlementsTable)
          .where(eq(subscriptionEntitlementsTable.userId, userId))
          .limit(1);
        const row = rows[0];
        const active = isActivePaidEntitlement(row);
        res.status(503).json({
          ok: false,
          error: "revenuecat_verify_unavailable",
          planId: active && row ? row.planId : "free",
          storeKitActive: active,
        });
        return;
      }

      const verified = await verifyRevenueCatSubscriber(userId);
      if (!verified.ok) {
        // Inactive / error — clear paid access when RC says inactive; otherwise keep prior trusted row.
        if (verified.reason === "inactive") {
          await upsertEntitlement({
            userId,
            planId: "free",
            productId: null,
            status: "expired",
            expiresAt: null,
            managementUrl: null,
            originalAppUserId: userId,
            source: "revenuecat_api",
            storeKitActive: false,
          });
          await recordEvent({
            eventKey: `rc_restore_verify:${userId}:${Date.now()}`,
            userId,
            eventType: "RESTORE_VERIFY_INACTIVE",
            payload: JSON.stringify({ reason: verified.reason }).slice(0, 2000),
          });
          res.json({ ok: true, planId: "free", storeKitActive: false, source: "revenuecat_api" });
          return;
        }
        const rows = await db
          .select()
          .from(subscriptionEntitlementsTable)
          .where(eq(subscriptionEntitlementsTable.userId, userId))
          .limit(1);
        const row = rows[0];
        const active = isActivePaidEntitlement(row);
        res.status(502).json({
          ok: false,
          error: "revenuecat_verify_failed",
          reason: verified.reason,
          planId: active && row ? row.planId : "free",
          storeKitActive: active,
        });
        return;
      }

      await upsertEntitlement({
        userId,
        planId: verified.planId,
        productId: verified.productId,
        status: verified.status,
        expiresAt: verified.expiresAt,
        managementUrl: verified.managementUrl,
        originalAppUserId: userId,
        source: "revenuecat_api",
        storeKitActive: true,
      });
      await recordEvent({
        eventKey: `rc_restore_verify:${userId}:${Date.now()}`,
        userId,
        eventType: "RESTORE_VERIFY_ACTIVE",
        payload: JSON.stringify({
          planId: verified.planId,
          productId: verified.productId,
          entitlementIds: verified.entitlementIds,
        }).slice(0, 4000),
      });
      res.json({
        ok: true,
        planId: verified.planId,
        storeKitActive: true,
        source: "revenuecat_api",
        expiresAt: verified.expiresAt ? verified.expiresAt.toISOString() : null,
      });
    } catch (err) {
      logger.error({ err }, "subscription restore-verify failed");
      res.status(500).json({ error: "restore verify failed" });
    }
  },
);

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
    const active = isActivePaidEntitlement(row);
    res.json({
      ok: true,
      entitlement: {
        planId: active && (row.planId === "go" || row.planId === "pro") ? row.planId : null,
        productId: row.productId,
        status: row.status,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        managementUrl: row.managementUrl,
        source: row.source,
        storeKitActive: active,
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

      const revokeTypes = new Set(["EXPIRATION", "REFUND", "REVOKE", "REVOCATION"]);
      const pauseTypes = new Set(["SUBSCRIPTION_PAUSED"]);
      const activeTypes = new Set([
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "PRODUCT_CHANGE",
        "NON_RENEWING_PURCHASE",
        "TRANSFER",
        "TEMPORARY_ENTITLEMENT_GRANT",
      ]);

      const expirationMs =
        typeof event.expiration_at_ms === "number"
          ? event.expiration_at_ms
          : typeof event.expirationAtMs === "number"
            ? event.expirationAtMs
            : null;
      const expiresInFuture =
        expirationMs != null && Number.isFinite(expirationMs) && expirationMs > Date.now();

      let planId: "free" | "go" | "pro" = "free";
      let storeKitActive = false;
      let status = "unknown";

      if (revokeTypes.has(eventType)) {
        // Fully ended — refund / revoke / natural expiration remove access now.
        planId = "free";
        storeKitActive = false;
        status =
          eventType === "REFUND"
            ? "refunded"
            : eventType === "REVOKE" || eventType === "REVOCATION"
              ? "revoked"
              : "expired";
      } else if (pauseTypes.has(eventType)) {
        planId = "free";
        storeKitActive = false;
        status = "paused";
      } else if (eventType === "CANCELLATION") {
        // Auto-renew off; access continues until period end when expiration is future.
        const paid =
          planFromEntitlementIds(entitlementIds) ?? planFromProductId(productId);
        if (expiresInFuture && paid) {
          planId = paid;
          storeKitActive = true;
          status = "cancelled";
        } else {
          planId = "free";
          storeKitActive = false;
          status = "cancelled";
        }
      } else if (activeTypes.has(eventType)) {
        planId =
          planFromEntitlementIds(entitlementIds) ??
          planFromProductId(productId) ??
          "pro";
        storeKitActive = planId !== "free";
        status = "active";
      } else if (eventType === "BILLING_ISSUE") {
        // Grace / billing retry — keep access when RC still reports a paid plan.
        status = "billing_issue";
        planId =
          planFromEntitlementIds(entitlementIds) ??
          planFromProductId(productId) ??
          "free";
        storeKitActive = planId !== "free";
      }

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
