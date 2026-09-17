import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  promoCodesTable,
  promoRedemptionsTable,
  type PromoCodeRow,
} from "@workspace/db";
import { rateLimit } from "../lib/sports";
import { logger } from "../lib/logger";
import {
  DEFAULT_PROMO_SEED,
  computePromoUnlock,
  isPromoKind,
  isUnlockActive,
  normalizePromoCode,
  promoFailMessage,
  type PromoCodeDef,
  type PromoFailReason,
  type PromoUnlock,
} from "../lib/promoRedeem";

const redeemLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  name: "promo-redeem",
});

const validateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  name: "promo-validate",
});

const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  name: "promo-admin",
});

function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

function promoIdentityKey(userId: string | null, deviceId: string | null): string | null {
  if (userId) return `user:${userId}`;
  if (deviceId) return `device:${deviceId}`;
  return null;
}

function rowToDef(row: PromoCodeRow): PromoCodeDef {
  return {
    code: row.code,
    kind: isPromoKind(row.kind) ? row.kind : "days",
    days: row.days,
    unlockUntilMs: row.unlockUntil ? row.unlockUntil.getTime() : null,
    redeemFromMs: row.redeemFrom ? row.redeemFrom.getTime() : null,
    redeemUntilMs: row.redeemUntil ? row.redeemUntil.getTime() : null,
    maxRedemptions: row.maxRedemptions,
    label: row.label,
    active: row.active,
  };
}

let seedPromise: Promise<void> | null = null;

/** Upsert the default catalog once per process if the table is empty. */
async function ensurePromoSeed(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existing = await db.select({ code: promoCodesTable.code }).from(promoCodesTable).limit(1);
        if (existing.length > 0) return;
        const now = new Date();
        for (const seed of DEFAULT_PROMO_SEED) {
          await db
            .insert(promoCodesTable)
            .values({
              code: seed.code,
              kind: seed.kind,
              days: seed.days ?? null,
              unlockUntil: seed.unlockUntilMs != null ? new Date(seed.unlockUntilMs) : null,
              redeemFrom: seed.redeemFromMs != null ? new Date(seed.redeemFromMs) : null,
              redeemUntil: seed.redeemUntilMs != null ? new Date(seed.redeemUntilMs) : null,
              maxRedemptions: seed.maxRedemptions ?? null,
              label: seed.label,
              active: seed.active,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();
        }
        logger.info({ count: DEFAULT_PROMO_SEED.length }, "promo catalog seeded");
      } catch (err) {
        // Allow retry on next request if push hasn't landed yet.
        seedPromise = null;
        throw err;
      }
    })();
  }
  await seedPromise;
}

function adminAuthorized(req: Request): boolean {
  const key = process.env["PROMO_ADMIN_KEY"];
  if (!key) return false;
  const header = req.get("x-promo-admin-key") ?? "";
  return header === key;
}

function unlockPayload(unlock: PromoUnlock, nowMs: number) {
  return {
    code: unlock.code,
    label: unlock.label,
    lifetime: unlock.lifetime,
    expiresAt: unlock.expiresAtMs != null ? new Date(unlock.expiresAtMs).toISOString() : null,
    active: isUnlockActive(unlock, nowMs),
  };
}

const router: IRouter = Router();

/** Validate a code without redeeming (public, rate-limited). */
router.post("/promo/validate", validateLimiter, async (req, res) => {
  try {
    await ensurePromoSeed();
  } catch (err) {
    logger.error({ err }, "promo seed failed");
    res.status(503).json({ ok: false, error: "promo service unavailable" });
    return;
  }

  const code = normalizePromoCode(String(req.body?.code ?? ""));
  if (!code) {
    res.status(400).json({ ok: false, error: promoFailMessage("invalid") });
    return;
  }

  const rows = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
  const row = rows[0];
  if (!row) {
    res.json({ ok: false, reason: "invalid" as PromoFailReason, error: promoFailMessage("invalid") });
    return;
  }

  const nowMs = Date.now();
  const computed = computePromoUnlock(rowToDef(row), nowMs);
  if (!computed.ok) {
    res.json({ ok: false, reason: computed.reason, error: promoFailMessage(computed.reason) });
    return;
  }

  let redeemedCount = 0;
  try {
    const [agg] = await db
      .select({ n: count() })
      .from(promoRedemptionsTable)
      .where(eq(promoRedemptionsTable.code, code));
    redeemedCount = Number(agg?.n ?? 0);
  } catch {
    redeemedCount = 0;
  }

  const max = row.maxRedemptions;
  if (max != null && redeemedCount >= max) {
    res.json({
      ok: false,
      reason: "limit_reached" as PromoFailReason,
      error: promoFailMessage("limit_reached"),
    });
    return;
  }

  res.json({
    ok: true,
    unlock: unlockPayload(computed.unlock, nowMs),
    remaining:
      max == null ? null : Math.max(0, max - redeemedCount),
  });
});

/**
 * Redeem a promo for the signed-in user and/or device.
 * Body: { code: string, deviceId?: string }
 */
router.post("/promo/redeem", redeemLimiter, async (req, res) => {
  try {
    await ensurePromoSeed();
  } catch (err) {
    logger.error({ err }, "promo seed failed");
    res.status(503).json({ ok: false, error: "promo service unavailable" });
    return;
  }

  const code = normalizePromoCode(String(req.body?.code ?? ""));
  const deviceIdRaw = String(req.body?.deviceId ?? "").trim();
  const deviceId = deviceIdRaw.length >= 8 ? deviceIdRaw.slice(0, 128) : null;
  const userId = clerkUserId(req);
  const identityKey = promoIdentityKey(userId, deviceId);

  if (!code) {
    res.status(400).json({ ok: false, error: promoFailMessage("invalid") });
    return;
  }
  if (!identityKey) {
    res.status(400).json({
      ok: false,
      error: "Sign in or provide a deviceId to redeem a promo.",
    });
    return;
  }

  const rows = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
  const row = rows[0];
  if (!row) {
    res.json({ ok: false, reason: "invalid" as PromoFailReason, error: promoFailMessage("invalid") });
    return;
  }

  const nowMs = Date.now();
  const computed = computePromoUnlock(rowToDef(row), nowMs);
  if (!computed.ok) {
    res.json({ ok: false, reason: computed.reason, error: promoFailMessage(computed.reason) });
    return;
  }

  // Already redeemed by this identity — return current unlock (idempotent).
  const prior = await db
    .select()
    .from(promoRedemptionsTable)
    .where(
      and(
        eq(promoRedemptionsTable.code, code),
        eq(promoRedemptionsTable.identityKey, identityKey),
      ),
    )
    .limit(1);
  if (prior[0]) {
    const p = prior[0];
    const unlock: PromoUnlock = {
      code,
      label: row.label,
      lifetime: p.unlockLifetime,
      expiresAtMs: p.unlockExpiresAt ? p.unlockExpiresAt.getTime() : null,
    };
    res.json({
      ok: true,
      alreadyRedeemed: true,
      unlock: unlockPayload(unlock, nowMs),
    });
    return;
  }

  if (row.maxRedemptions != null) {
    const [agg] = await db
      .select({ n: count() })
      .from(promoRedemptionsTable)
      .where(eq(promoRedemptionsTable.code, code));
    if (Number(agg?.n ?? 0) >= row.maxRedemptions) {
      res.json({
        ok: false,
        reason: "limit_reached" as PromoFailReason,
        error: promoFailMessage("limit_reached"),
      });
      return;
    }
  }

  try {
    await db.insert(promoRedemptionsTable).values({
      code,
      identityKey,
      userId,
      deviceId,
      unlockExpiresAt:
        computed.unlock.expiresAtMs != null ? new Date(computed.unlock.expiresAtMs) : null,
      unlockLifetime: computed.unlock.lifetime,
    });
  } catch (err) {
    // Race: another request redeemed first — treat as already redeemed.
    logger.warn({ err, code, identityKey }, "promo redeem insert conflict");
    res.json({
      ok: true,
      alreadyRedeemed: true,
      unlock: unlockPayload(computed.unlock, nowMs),
    });
    return;
  }

  res.json({
    ok: true,
    alreadyRedeemed: false,
    unlock: unlockPayload(computed.unlock, nowMs),
  });
});

/**
 * Best active unlock for this user/device (signed-in preferred).
 * Query: ?deviceId=
 */
router.get("/promo/entitlement", validateLimiter, async (req, res) => {
  try {
    await ensurePromoSeed();
  } catch (err) {
    logger.error({ err }, "promo seed failed");
    res.status(503).json({ ok: false, error: "promo service unavailable" });
    return;
  }

  const userId = clerkUserId(req);
  const deviceIdRaw = String(req.query.deviceId ?? "").trim();
  const deviceId = deviceIdRaw.length >= 8 ? deviceIdRaw.slice(0, 128) : null;
  const keys = [promoIdentityKey(userId, null), promoIdentityKey(null, deviceId)].filter(
    (k): k is string => !!k,
  );
  if (keys.length === 0) {
    res.status(400).json({ ok: false, error: "Sign in or provide a deviceId." });
    return;
  }

  const nowMs = Date.now();
  const redemptions = await db
    .select()
    .from(promoRedemptionsTable)
    .where(inArray(promoRedemptionsTable.identityKey, keys))
    .orderBy(desc(promoRedemptionsTable.redeemedAt))
    .limit(20);

  let best: PromoUnlock | null = null;
  for (const r of redemptions) {
    const unlock: PromoUnlock = {
      code: r.code,
      label: r.code,
      lifetime: r.unlockLifetime,
      expiresAtMs: r.unlockExpiresAt ? r.unlockExpiresAt.getTime() : null,
    };
    if (!isUnlockActive(unlock, nowMs)) continue;
    const codeRows = await db
      .select()
      .from(promoCodesTable)
      .where(eq(promoCodesTable.code, r.code))
      .limit(1);
    unlock.label = codeRows[0]?.label ?? r.code;
    if (
      !best ||
      unlock.lifetime ||
      (unlock.expiresAtMs ?? 0) > (best.expiresAtMs ?? 0)
    ) {
      best = unlock;
      if (unlock.lifetime) break;
    }
  }

  res.json({
    ok: true,
    unlock: best ? unlockPayload(best, nowMs) : null,
  });
});

/** Admin upsert — requires header x-promo-admin-key: $PROMO_ADMIN_KEY */
router.post("/promo/admin/upsert", adminLimiter, async (req, res) => {
  if (!adminAuthorized(req)) {
    res.status(401).json({ error: "admin key required" });
    return;
  }
  try {
    await ensurePromoSeed();
  } catch (err) {
    logger.error({ err }, "promo seed failed");
    res.status(503).json({ error: "promo service unavailable" });
    return;
  }

  const code = normalizePromoCode(String(req.body?.code ?? ""));
  const kind = String(req.body?.kind ?? "");
  const label = String(req.body?.label ?? "").trim();
  if (!code || !isPromoKind(kind) || !label) {
    res.status(400).json({ error: "code, kind (lifetime|days|until), and label required" });
    return;
  }

  const now = new Date();
  const values = {
    code,
    kind,
    days: typeof req.body?.days === "number" ? req.body.days : null,
    unlockUntil: req.body?.unlockUntil ? new Date(String(req.body.unlockUntil)) : null,
    redeemFrom: req.body?.redeemFrom ? new Date(String(req.body.redeemFrom)) : null,
    redeemUntil: req.body?.redeemUntil ? new Date(String(req.body.redeemUntil)) : null,
    maxRedemptions:
      typeof req.body?.maxRedemptions === "number" ? req.body.maxRedemptions : null,
    label,
    active: req.body?.active === false ? false : true,
    updatedAt: now,
  };

  await db
    .insert(promoCodesTable)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({
      target: promoCodesTable.code,
      set: values,
    });

  res.json({ ok: true, code });
});

/** Admin list codes + redemption counts */
router.get("/promo/admin/list", adminLimiter, async (req, res) => {
  if (!adminAuthorized(req)) {
    res.status(401).json({ error: "admin key required" });
    return;
  }
  try {
    await ensurePromoSeed();
  } catch (err) {
    logger.error({ err }, "promo seed failed");
    res.status(503).json({ error: "promo service unavailable" });
    return;
  }

  const codes = await db.select().from(promoCodesTable).orderBy(promoCodesTable.code);
  const counts = await db
    .select({
      code: promoRedemptionsTable.code,
      n: count(),
    })
    .from(promoRedemptionsTable)
    .groupBy(promoRedemptionsTable.code);
  const byCode = new Map(counts.map((c) => [c.code, Number(c.n)]));

  res.json({
    ok: true,
    codes: codes.map((c) => ({
      ...c,
      redemptionCount: byCode.get(c.code) ?? 0,
    })),
  });
});

export default router;
