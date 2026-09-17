/**
 * Soft subscription entitlements for stadium-mobile.
 *
 * Design rules (App Store + OTA-safe):
 * - Guest browsing + Coach stay freely usable (App Store 5.1.1(v)).
 * - Secondary tools may soft-gate after trial (Edge Lock, Steals, Simulator, Report).
 * - Admin emails + promo codes/links unlock everything without StoreKit.
 * - No StoreKit / RevenueCat here — native rebuild + runtimeVersion for real IAP.
 * - Pure helpers stay Node-testable (no React / AsyncStorage imports).
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

/** Preview catalog — display prices only until StoreKit ships. */
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
    note: "Weekly plan (preview — billing ships with a native StoreKit build).",
    paid: true,
  },
  {
    id: "pro",
    name: "Stadium Edge Pro",
    priceLabel: "$29.99",
    periodLabel: "per month",
    note: "Monthly plan (preview — billing ships with a native StoreKit build).",
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
  | "model_report";

export const PREMIUM_FEATURES: Record<
  PremiumFeatureId,
  { label: SoftProFeatureLabel; routes: readonly string[] }
> = {
  edge_lock: { label: "Edge Lock", routes: ["/arbitrage"] },
  steals: { label: "+500 Steals", routes: ["/steals"] },
  simulator: { label: "Simulator", routes: ["/simulator"] },
  model_report: { label: "Model Report", routes: ["/report"] },
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

export type PromoKind = "lifetime" | "days";

export type PromoDefinition = {
  code: string;
  kind: PromoKind;
  days?: number;
  label: string;
};

/**
 * Local promo catalog (OTA-updatable). Codes are case-insensitive.
 * Share as `https://<domain>/plans?promo=CODE` or redeem on Plans/Account.
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
    code: "8VZV43WK",
    kind: "days",
    days: 30,
    label: "Free month of Pro",
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
};

export type UnlockSource = "paid" | "trial" | "promo" | "admin" | "none";

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

export type RedeemPromoResult =
  | { ok: true; definition: PromoDefinition; state: SubscriptionPersistedState }
  | { ok: false; reason: "invalid" | "expired_noop" };

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

export function isPromoUnlockActive(
  state: Pick<SubscriptionPersistedState, "redeemedPromoCode" | "promoExpiresAtMs" | "promoLifetime">,
  nowMs: number,
): boolean {
  if (!state.redeemedPromoCode) return false;
  if (state.promoLifetime) return true;
  if (state.promoExpiresAtMs == null) return false;
  return state.promoExpiresAtMs > nowMs;
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
  if (planById(state.planId).paid) return "paid";
  if (isPromoUnlockActive(state, nowMs)) return "promo";
  if (isTrialActive(state.trialStartedAtMs, nowMs)) return "trial";
  return "none";
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
  } else if (unlockSource === "paid") {
    statusLabel = plan.name;
    statusDetail = `${plan.priceLabel} ${plan.periodLabel} · preview entitlement`;
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

  if (definition.kind === "lifetime") {
    return {
      ok: true,
      definition,
      state: {
        ...state,
        redeemedPromoCode: definition.code,
        promoLifetime: true,
        promoExpiresAtMs: null,
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
  return {
    planId,
    trialStartedAtMs,
    redeemedPromoCode,
    promoExpiresAtMs,
    promoLifetime,
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
