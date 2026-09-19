/**
 * Soft subscription entitlements for stadium-mobile.
 *
 * Design rules (App Store + OTA-safe):
 * - Guest browsing + Coach stay freely usable (App Store 5.1.1(v)).
 * - Secondary tools may soft-gate after trial (Edge Lock, Steals, Simulator, Report).
 * - Admin emails + promo codes/links unlock everything without StoreKit.
 * - Apple StoreKit (via RevenueCat) unlocks paid Go/Pro and appears in
 *   iOS Settings → Subscriptions after a native rebuild + runtimeVersion bump.
 * - Pure helpers stay Node-testable (no React / AsyncStorage / Purchases imports).
 */

export type PlanId = "free" | "go" | "pro";

export type PlanDefinition = {
  id: PlanId;
  name: string;
  priceLabel: string;
  periodLabel: string;
  note: string;
  /** Paid catalog entry (Go / Pro). Free is the post-trial default. */
  paid: boolean;
};

/** Catalog — Go/Pro bill through Apple StoreKit on native builds. */
export const SUBSCRIPTION_PLANS: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "Free trial",
    priceLabel: "$0",
    periodLabel: "for 7 days",
    note: "Everything unlocked for 7 days. Browse + Coach stay open after.",
    paid: false,
  },
  {
    id: "go",
    name: "Stadium Edge Go",
    priceLabel: "$9.99",
    periodLabel: "a week",
    note: "Weekly auto-renewable via Apple. Manage in Settings → Subscriptions.",
    paid: true,
  },
  {
    id: "pro",
    name: "Stadium Edge Pro",
    priceLabel: "$29.99",
    periodLabel: "per month",
    note: "Monthly auto-renewable via Apple. Manage in Settings → Subscriptions.",
    paid: true,
  },
] as const;

export const TRIAL_LENGTH_DAYS = 7;

export const SUBSCRIPTION_STORAGE_KEY = "stadium-edge:subscription:v1";

/** Features that may trigger a soft upgrade sheet — never Coach/OTA/core browse. */
export const SOFT_PRO_FEATURE_LABELS = [
  "Upgrade",
  "Plans",
  "Ticket image download",
  "Cloud sync extras",
  "Edge Lock",
  "+500 Steals",
  "Simulator",
  "Model Report",
  "AI Grade & Edge",
] as const;

export type SoftProFeatureLabel = (typeof SOFT_PRO_FEATURE_LABELS)[number] | string;

/**
 * Premium secondary surfaces — soft-gated after trial unless subscribed / admin / promo.
 * Discover, Coach, Props, Slip, Weather, Fantasy stay free for guests.
 */
export type PremiumFeatureId =
  | "edge_lock"
  | "steals"
  | "simulator"
  | "model_report"
  | "coach_ai_metrics";

export const PREMIUM_FEATURES: Record<
  PremiumFeatureId,
  { label: SoftProFeatureLabel; routes: readonly string[] }
> = {
  edge_lock: { label: "Edge Lock", routes: ["/arbitrage"] },
  steals: { label: "+500 Steals", routes: ["/steals"] },
  simulator: { label: "Simulator", routes: ["/simulator"] },
  model_report: { label: "Model Report", routes: ["/report"] },
  // No dedicated route — soft-locked tiles on Coach / pick cards.
  coach_ai_metrics: { label: "AI Grade & Edge", routes: [] },
};

export function premiumFeatureForRoute(route: string): PremiumFeatureId | null {
  const path = route.split("?")[0] ?? route;
  for (const [id, meta] of Object.entries(PREMIUM_FEATURES) as [
    PremiumFeatureId,
    (typeof PREMIUM_FEATURES)[PremiumFeatureId],
  ][]) {
    if (meta.routes.some((r) => path === r || path.startsWith(`${r}/`))) return id;
  }
  return null;
}

export type PromoKind = "lifetime" | "days" | "until";

export type PromoDefinition = {
  code: string;
  kind: PromoKind;
  /** For kind "days" — unlock length after redeem. */
  days?: number;
  /** For kind "until" — hard calendar end of access (epoch ms). */
  unlockUntilMs?: number;
  label: string;
  /** Earliest time this code can be redeemed (inclusive). Omit = anytime. */
  redeemFromMs?: number;
  /** Latest time this code can be redeemed (exclusive). Omit = no deadline. */
  redeemUntilMs?: number;
  /**
   * Max successful redeems on this device. Default 1.
   * Global multi-user caps need a server — not enforceable in an OTA-only catalog.
   */
  maxRedeemsPerDevice?: number;
};

/**
 * Local promo catalog (OTA-updatable). Codes are case-insensitive.
 * Share as `https://<domain>/plans?promo=CODE` or redeem on Plans/Account.
 *
 * Timing knobs per code:
 * - redeemFromMs / redeemUntilMs → when the code may be entered
 * - kind "days" → access length after redeem
 * - kind "until" → access ends on a fixed calendar date
 * - kind "lifetime" → never expires after redeem
 */
export const PROMO_CATALOG: readonly PromoDefinition[] = [
  {
    code: "7VXHVPOR",
    kind: "lifetime",
    label: "VIP — lifetime Pro unlock",
  },
  {
    code: "KFXD4X2B",
    kind: "days",
    days: 7,
    label: "7 days of Pro",
  },
  {
    code: "KK48IZSN",
    kind: "days",
    days: 30,
    label: "30 days of Pro",
  },
  {
    // Unlock ends on a fixed calendar date (end of 2026 season).
    code: "8VZV43WK",
    kind: "until",
    unlockUntilMs: 1_798_761_600_000, // 2027-01-01 UTC
    label: "Pro through end of 2026",
  },
  {
    // Flash: only redeemable Sep 17 – Oct 17 2026 UTC; then 7 days of access.
    code: "6EUSDWFI",
    kind: "days",
    days: 7,
    redeemFromMs: 1_789_603_200_000, // 2026-09-17 UTC
    redeemUntilMs: 1_792_281_600_000, // 2026-10-18 UTC
    maxRedeemsPerDevice: 1,
    label: "Flash — 7 days Pro (redeem by Oct 17)",
  },
] as const;

export type SubscriptionPersistedState = {
  planId: PlanId;
  /** Epoch ms when the device-local trial started. Null = not started yet. */
  trialStartedAtMs: number | null;
  /** Last successfully redeemed promo (normalized uppercase). */
  redeemedPromoCode: string | null;
  /** When a timed promo ends. Null with a code usually means lifetime. */
  promoExpiresAtMs: number | null;
  /** True when redeemed promo never expires. */
  promoLifetime: boolean;
  /** Per-device successful redeem counts keyed by normalized code. */
  promoRedeemCounts: Record<string, number>;
  /**
   * True when planId was granted by an active Apple StoreKit / RevenueCat
   * subscription (shows under iOS Settings → Subscriptions).
   */
  storeKitActive: boolean;
  /** Last known App Store product id (e.g. com.stadiumedge.app.go.weekly). */
  storeKitProductId: string | null;
  /** Apple / RevenueCat subscription management URL when available. */
  storeKitManagementUrl: string | null;
};

export type UnlockSource = "storekit" | "paid" | "trial" | "promo" | "admin" | "none";

export type EntitlementView = {
  planId: PlanId;
  plan: PlanDefinition;
  trialActive: boolean;
  trialDaysLeft: number;
  /** Paid / trial / promo / admin — soft Pro for gated secondary features. */
  isPro: boolean;
  unlockSource: UnlockSource;
  isAdmin: boolean;
  redeemedPromoCode: string | null;
  statusLabel: string;
  statusDetail: string;
};

export type RedeemPromoFailReason =
  | "invalid"
  | "not_yet"
  | "redeem_expired"
  | "limit_reached"
  | "unlock_ended";

export type RedeemPromoResult =
  | { ok: true; definition: PromoDefinition; state: SubscriptionPersistedState }
  | { ok: false; reason: RedeemPromoFailReason };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isPlanId(value: unknown): value is PlanId {
  return value === "free" || value === "go" || value === "pro";
}

export function planById(id: PlanId): PlanDefinition {
  const found = SUBSCRIPTION_PLANS.find((p) => p.id === id);
  return found ?? SUBSCRIPTION_PLANS[0]!;
}

/** Whole days remaining in the trial window (0 when expired / missing). */
export function trialDaysRemaining(
  trialStartedAtMs: number | null,
  nowMs: number,
  trialLengthDays: number = TRIAL_LENGTH_DAYS,
): number {
  if (trialStartedAtMs == null || !Number.isFinite(trialStartedAtMs)) return 0;
  if (!Number.isFinite(nowMs) || nowMs < trialStartedAtMs) return 0;
  const elapsed = nowMs - trialStartedAtMs;
  const left = trialLengthDays - elapsed / MS_PER_DAY;
  if (left <= 0) return 0;
  return Math.ceil(left);
}

export function isTrialActive(
  trialStartedAtMs: number | null,
  nowMs: number,
  trialLengthDays: number = TRIAL_LENGTH_DAYS,
): boolean {
  return trialDaysRemaining(trialStartedAtMs, nowMs, trialLengthDays) > 0;
}

export function normalizePromoCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function findPromoDefinition(code: string): PromoDefinition | null {
  const normalized = normalizePromoCode(code);
  if (!normalized) return null;
  return PROMO_CATALOG.find((p) => p.code === normalized) ?? null;
}

export function isPromoRedeemWindowOpen(
  definition: PromoDefinition,
  nowMs: number,
): RedeemPromoFailReason | null {
  if (definition.redeemFromMs != null && nowMs < definition.redeemFromMs) {
    return "not_yet";
  }
  if (definition.redeemUntilMs != null && nowMs >= definition.redeemUntilMs) {
    return "redeem_expired";
  }
  if (
    definition.kind === "until" &&
    definition.unlockUntilMs != null &&
    nowMs >= definition.unlockUntilMs
  ) {
    return "unlock_ended";
  }
  return null;
}

export function deviceRedeemCount(
  state: Pick<SubscriptionPersistedState, "promoRedeemCounts">,
  code: string,
): number {
  const key = normalizePromoCode(code);
  if (!key) return 0;
  const n = state.promoRedeemCounts?.[key];
  return typeof n === "number" && n > 0 ? n : 0;
}

export function isPromoUnlockActive(
  state: Pick<SubscriptionPersistedState, "redeemedPromoCode" | "promoExpiresAtMs" | "promoLifetime">,
  nowMs: number,
): boolean {
  if (!state.redeemedPromoCode) return false;
  if (state.promoLifetime) return true;
  if (state.promoExpiresAtMs == null) return false;
  return state.promoExpiresAtMs > nowMs;
}

export function redeemPromoFailureMessage(reason: RedeemPromoFailReason): string {
  switch (reason) {
    case "not_yet":
      return "That promo isn’t active yet.";
    case "redeem_expired":
      return "That promo code has expired.";
    case "limit_reached":
      return "That promo was already used on this device.";
    case "unlock_ended":
      return "That promo’s access window has ended.";
    case "invalid":
    default:
      return "That promo code isn’t valid.";
  }
}

/**
 * Parse EXPO_PUBLIC_ADMIN_EMAILS (comma/space separated).
 * Example: "you@stadiumedge.com,owner@gmail.com"
 */
export function parseAdminEmails(envValue: string | null | undefined): string[] {
  if (!envValue || typeof envValue !== "string") return [];
  return envValue
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function isAdminEmail(
  email: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || allowlist.length === 0) return false;
  return allowlist.includes(normalized);
}

export function hasPromoOrPlanAccess(
  state: SubscriptionPersistedState,
  nowMs: number,
  trialLengthDays: number = TRIAL_LENGTH_DAYS,
): boolean {
  if (state.storeKitActive && planById(state.planId).paid) return true;
  if (planById(state.planId).paid) return true;
  if (isPromoUnlockActive(state, nowMs)) return true;
  return isTrialActive(state.trialStartedAtMs, nowMs, trialLengthDays);
}

/**
 * Soft Pro access: paid plan, active trial, active promo, or admin email.
 * Free + expired trial → not Pro (core browse/Coach still open).
 */
export function hasProAccess(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: { email?: string | null; adminEmails?: readonly string[] } = {},
  trialLengthDays: number = TRIAL_LENGTH_DAYS,
): boolean {
  if (isAdminEmail(opts.email, opts.adminEmails ?? [])) return true;
  return hasPromoOrPlanAccess(state, nowMs, trialLengthDays);
}

export function resolveUnlockSource(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: { email?: string | null; adminEmails?: readonly string[] } = {},
): UnlockSource {
  if (isAdminEmail(opts.email, opts.adminEmails ?? [])) return "admin";
  if (state.storeKitActive && planById(state.planId).paid) return "storekit";
  if (planById(state.planId).paid) return "paid";
  if (isPromoUnlockActive(state, nowMs)) return "promo";
  if (isTrialActive(state.trialStartedAtMs, nowMs)) return "trial";
  return "none";
}

/**
 * Apply a StoreKit / RevenueCat customer snapshot onto persisted state.
 * Clears the paid plan when Apple reports no active subscription.
 */
export function applyStoreKitSnapshot(
  state: SubscriptionPersistedState,
  snapshot: {
    planId: PlanId | null;
    activeProductIds?: readonly string[];
    managementUrl?: string | null;
  },
): SubscriptionPersistedState {
  if (snapshot.planId && planById(snapshot.planId).paid) {
    const productId =
      snapshot.activeProductIds?.find((id) => id.length > 0) ??
      state.storeKitProductId;
    return {
      ...state,
      planId: snapshot.planId,
      storeKitActive: true,
      storeKitProductId: productId ?? null,
      storeKitManagementUrl: snapshot.managementUrl ?? state.storeKitManagementUrl,
    };
  }
  // Apple says inactive — drop StoreKit-backed paid plan, keep promo/trial.
  if (state.storeKitActive) {
    return {
      ...state,
      planId: "free",
      storeKitActive: false,
      storeKitProductId: null,
      storeKitManagementUrl: snapshot.managementUrl ?? null,
    };
  }
  return {
    ...state,
    storeKitManagementUrl: snapshot.managementUrl ?? state.storeKitManagementUrl,
  };
}

/** Whether a premium secondary feature is allowed. */
export function canAccessPremiumFeature(
  _featureId: PremiumFeatureId,
  isPro: boolean,
): boolean {
  return isPro;
}

export function buildEntitlementView(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: { email?: string | null; adminEmails?: readonly string[] } = {},
): EntitlementView {
  const planId = isPlanId(state.planId) ? state.planId : "free";
  const plan = planById(planId);
  const trialDaysLeft = trialDaysRemaining(state.trialStartedAtMs, nowMs);
  const trialActive = trialDaysLeft > 0;
  const isAdmin = isAdminEmail(opts.email, opts.adminEmails ?? []);
  const unlockSource = resolveUnlockSource(state, nowMs, opts);
  const isPro = unlockSource !== "none";

  let statusLabel: string;
  let statusDetail: string;
  if (isAdmin) {
    statusLabel = "Admin";
    statusDetail = "Full access · admin account";
  } else if (unlockSource === "storekit") {
    statusLabel = plan.name;
    statusDetail = `${plan.priceLabel} ${plan.periodLabel} · Apple subscription`;
  } else if (unlockSource === "paid") {
    statusLabel = plan.name;
    statusDetail = `${plan.priceLabel} ${plan.periodLabel} · local entitlement`;
  } else if (unlockSource === "promo") {
    const def = findPromoDefinition(state.redeemedPromoCode ?? "");
    statusLabel = def?.label ?? "Promo unlock";
    if (state.promoLifetime) {
      statusDetail = `Code ${state.redeemedPromoCode} · lifetime`;
    } else if (state.promoExpiresAtMs != null) {
      const days = Math.max(1, Math.ceil((state.promoExpiresAtMs - nowMs) / MS_PER_DAY));
      statusDetail = `Code ${state.redeemedPromoCode} · ${days} day${days === 1 ? "" : "s"} left`;
    } else {
      statusDetail = `Code ${state.redeemedPromoCode}`;
    }
  } else if (trialActive) {
    statusLabel = "Free trial";
    statusDetail =
      trialDaysLeft === 1
        ? "1 day left · everything unlocked for this preview"
        : `${trialDaysLeft} days left · everything unlocked for this preview`;
  } else {
    statusLabel = "Free";
    statusDetail =
      "Browse + Coach stay open · Edge Lock, Steals, Simulator & Report need a plan";
  }

  return {
    planId,
    plan,
    trialActive,
    trialDaysLeft,
    isPro,
    unlockSource,
    isAdmin,
    redeemedPromoCode: state.redeemedPromoCode,
    statusLabel,
    statusDetail,
  };
}

export function redeemPromoCode(
  state: SubscriptionPersistedState,
  code: string,
  nowMs: number,
): RedeemPromoResult {
  const definition = findPromoDefinition(code);
  if (!definition) return { ok: false, reason: "invalid" };

  const windowFail = isPromoRedeemWindowOpen(definition, nowMs);
  if (windowFail) return { ok: false, reason: windowFail };

  const max = definition.maxRedeemsPerDevice ?? 1;
  const used = deviceRedeemCount(state, definition.code);
  // Re-applying the same still-active unlock is a no-op success (doesn't burn another use).
  const sameActive =
    state.redeemedPromoCode === definition.code && isPromoUnlockActive(state, nowMs);
  if (!sameActive && used >= max) {
    return { ok: false, reason: "limit_reached" };
  }

  const counts = { ...(state.promoRedeemCounts ?? {}) };
  if (!sameActive) {
    counts[definition.code] = used + 1;
  }

  if (definition.kind === "lifetime") {
    return {
      ok: true,
      definition,
      state: {
        ...state,
        redeemedPromoCode: definition.code,
        promoLifetime: true,
        promoExpiresAtMs: null,
        promoRedeemCounts: counts,
      },
    };
  }

  if (definition.kind === "until") {
    const until = definition.unlockUntilMs;
    if (until == null || until <= nowMs) {
      return { ok: false, reason: "unlock_ended" };
    }
    return {
      ok: true,
      definition,
      state: {
        ...state,
        redeemedPromoCode: definition.code,
        promoLifetime: false,
        promoExpiresAtMs: until,
        promoRedeemCounts: counts,
      },
    };
  }

  const days = definition.days ?? 7;
  const base =
    state.promoExpiresAtMs != null && state.promoExpiresAtMs > nowMs
      ? state.promoExpiresAtMs
      : nowMs;
  return {
    ok: true,
    definition,
    state: {
      ...state,
      redeemedPromoCode: definition.code,
      promoLifetime: false,
      promoExpiresAtMs: base + days * MS_PER_DAY,
      promoRedeemCounts: counts,
    },
  };
}

/** Shareable promo link — same host pattern as referral links. */
export function buildPromoLink(
  code: string,
  domain: string | null | undefined,
): string | null {
  const normalized = normalizePromoCode(code);
  if (!findPromoDefinition(normalized)) return null;
  const host = (domain ?? "").trim();
  if (!host) return null;
  const base = /^https?:\/\//i.test(host)
    ? host.replace(/\/+$/, "")
    : `https://${host.replace(/\/+$/, "")}`;
  return `${base}/plans?promo=${encodeURIComponent(normalized)}`;
}

export function extractPromoFromQuery(
  params: Record<string, string | string[] | undefined> | null | undefined,
): string | null {
  if (!params) return null;
  const raw = params.promo ?? params.code;
  if (Array.isArray(raw)) return normalizePromoCode(raw[0] ?? "") || null;
  return normalizePromoCode(raw ?? "") || null;
}

/** Sanitize AsyncStorage JSON into a safe persisted shape. */
export function sanitizeSubscriptionState(raw: unknown): SubscriptionPersistedState {
  if (!raw || typeof raw !== "object") {
    return {
      planId: "free",
      trialStartedAtMs: null,
      redeemedPromoCode: null,
      promoExpiresAtMs: null,
      promoLifetime: false,
      promoRedeemCounts: {},
      storeKitActive: false,
      storeKitProductId: null,
      storeKitManagementUrl: null,
    };
  }
  const obj = raw as Record<string, unknown>;
  const planId = isPlanId(obj.planId) ? obj.planId : "free";
  const trialRaw = obj.trialStartedAtMs;
  const trialStartedAtMs =
    typeof trialRaw === "number" && Number.isFinite(trialRaw) && trialRaw > 0
      ? trialRaw
      : null;
  const redeemedPromoCode =
    typeof obj.redeemedPromoCode === "string" && obj.redeemedPromoCode.trim()
      ? normalizePromoCode(obj.redeemedPromoCode)
      : null;
  const promoExpiresRaw = obj.promoExpiresAtMs;
  const promoExpiresAtMs =
    typeof promoExpiresRaw === "number" && Number.isFinite(promoExpiresRaw) && promoExpiresRaw > 0
      ? promoExpiresRaw
      : null;
  const promoLifetime = obj.promoLifetime === true;
  const promoRedeemCounts: Record<string, number> = {};
  if (obj.promoRedeemCounts && typeof obj.promoRedeemCounts === "object") {
    for (const [k, v] of Object.entries(obj.promoRedeemCounts as Record<string, unknown>)) {
      const code = normalizePromoCode(k);
      if (code && typeof v === "number" && Number.isFinite(v) && v > 0) {
        promoRedeemCounts[code] = Math.floor(v);
      }
    }
  }
  const storeKitActive = obj.storeKitActive === true;
  const storeKitProductId =
    typeof obj.storeKitProductId === "string" && obj.storeKitProductId.trim()
      ? obj.storeKitProductId.trim()
      : null;
  const storeKitManagementUrl =
    typeof obj.storeKitManagementUrl === "string" && obj.storeKitManagementUrl.trim()
      ? obj.storeKitManagementUrl.trim()
      : null;
  return {
    planId,
    trialStartedAtMs,
    redeemedPromoCode,
    promoExpiresAtMs,
    promoLifetime,
    promoRedeemCounts,
    storeKitActive,
    storeKitProductId,
    storeKitManagementUrl,
  };
}

/**
 * First launch: start the trial clock. Later launches keep the stored start.
 * Never auto-selects a paid plan.
 */
export function ensureTrialStarted(
  state: SubscriptionPersistedState,
  nowMs: number,
): SubscriptionPersistedState {
  if (state.trialStartedAtMs != null) return state;
  return { ...state, trialStartedAtMs: nowMs };
}

/**
 * Soft gate helper: true when allowed; false means "show soft paywall".
 * Callers MUST keep core browse/Coach working when this returns false.
 */
export function softRequirePro(isPro: boolean): boolean {
  return isPro;
}
