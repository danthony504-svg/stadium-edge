/**
 * Pure promo redeem rules — Node-testable, no DB / Express imports.
 */

export type PromoKind = "lifetime" | "days" | "until";

export type PromoCodeDef = {
  code: string;
  kind: PromoKind;
  days?: number | null;
  unlockUntilMs?: number | null;
  redeemFromMs?: number | null;
  redeemUntilMs?: number | null;
  maxRedemptions?: number | null;
  label: string;
  active: boolean;
};

export type PromoFailReason =
  | "invalid"
  | "inactive"
  | "not_yet"
  | "redeem_expired"
  | "unlock_ended"
  | "limit_reached"
  | "already_redeemed";

export type PromoUnlock = {
  code: string;
  label: string;
  lifetime: boolean;
  expiresAtMs: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizePromoCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isPromoKind(value: unknown): value is PromoKind {
  return value === "lifetime" || value === "days" || value === "until";
}

export function promoFailMessage(reason: PromoFailReason): string {
  switch (reason) {
    case "inactive":
      return "That promo code is no longer active.";
    case "not_yet":
      return "That promo isn’t active yet.";
    case "redeem_expired":
      return "That promo code has expired.";
    case "unlock_ended":
      return "That promo’s access window has ended.";
    case "limit_reached":
      return "That promo has reached its redemption limit.";
    case "already_redeemed":
      return "That promo was already redeemed on this account or device.";
    case "invalid":
    default:
      return "That promo code isn’t valid.";
  }
}

/** Can this code be entered right now? */
export function checkPromoRedeemWindow(
  def: PromoCodeDef,
  nowMs: number,
): PromoFailReason | null {
  if (!def.active) return "inactive";
  if (def.redeemFromMs != null && nowMs < def.redeemFromMs) return "not_yet";
  if (def.redeemUntilMs != null && nowMs >= def.redeemUntilMs) return "redeem_expired";
  if (def.kind === "until" && def.unlockUntilMs != null && nowMs >= def.unlockUntilMs) {
    return "unlock_ended";
  }
  return null;
}

export function computePromoUnlock(
  def: PromoCodeDef,
  nowMs: number,
): { ok: true; unlock: PromoUnlock } | { ok: false; reason: PromoFailReason } {
  const windowFail = checkPromoRedeemWindow(def, nowMs);
  if (windowFail) return { ok: false, reason: windowFail };

  if (def.kind === "lifetime") {
    return {
      ok: true,
      unlock: {
        code: def.code,
        label: def.label,
        lifetime: true,
        expiresAtMs: null,
      },
    };
  }

  if (def.kind === "until") {
    const until = def.unlockUntilMs;
    if (until == null || until <= nowMs) return { ok: false, reason: "unlock_ended" };
    return {
      ok: true,
      unlock: {
        code: def.code,
        label: def.label,
        lifetime: false,
        expiresAtMs: until,
      },
    };
  }

  const days = def.days ?? 7;
  return {
    ok: true,
    unlock: {
      code: def.code,
      label: def.label,
      lifetime: false,
      expiresAtMs: nowMs + days * MS_PER_DAY,
    },
  };
}

export function isUnlockActive(
  unlock: Pick<PromoUnlock, "lifetime" | "expiresAtMs">,
  nowMs: number,
): boolean {
  if (unlock.lifetime) return true;
  if (unlock.expiresAtMs == null) return false;
  return unlock.expiresAtMs > nowMs;
}

/** Default seed catalog — same opaque codes as the mobile preview layer. */
export const DEFAULT_PROMO_SEED: readonly PromoCodeDef[] = [
  {
    code: "7VXHVPOR",
    kind: "lifetime",
    label: "VIP — lifetime Pro unlock",
    active: true,
    maxRedemptions: null,
  },
  {
    code: "KFXD4X2B",
    kind: "days",
    days: 7,
    label: "7 days of Pro",
    active: true,
    maxRedemptions: null,
  },
  {
    code: "KK48IZSN",
    kind: "days",
    days: 30,
    label: "30 days of Pro",
    active: true,
    maxRedemptions: null,
  },
  {
    code: "8VZV43WK",
    kind: "until",
    unlockUntilMs: Date.parse("2027-01-01T00:00:00.000Z"),
    label: "Pro through end of 2026",
    active: true,
    maxRedemptions: null,
  },
  {
    code: "6EUSDWFI",
    kind: "days",
    days: 7,
    redeemFromMs: Date.parse("2026-09-17T00:00:00.000Z"),
    redeemUntilMs: Date.parse("2026-10-18T00:00:00.000Z"),
    maxRedemptions: 500,
    label: "Flash — 7 days Pro (redeem by Oct 17)",
    active: true,
  },
] as const;
