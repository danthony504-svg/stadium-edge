/**
 * Soft subscription entitlements for stadium-mobile.
 *
 * Design rules (App Store + OTA-safe):
 * - Guest browsing and Coach stay fully usable — never hard-wall core surfaces.
 * - Soft paywall only prompts (Account / Plans / optional CTAs); dismissible.
 * - No StoreKit / RevenueCat / native IAP packages here — those need a native
 *   rebuild + runtimeVersion bump and must not ride an OTA.
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

/** Mirrors the web DEMO catalog in ParlayBuilder (preview pricing only). */
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
] as const;

export type SoftProFeatureLabel = (typeof SOFT_PRO_FEATURE_LABELS)[number] | string;

export type SubscriptionPersistedState = {
  planId: PlanId;
  /** Epoch ms when the device-local trial started. Null = not started yet. */
  trialStartedAtMs: number | null;
};

export type EntitlementView = {
  planId: PlanId;
  plan: PlanDefinition;
  trialActive: boolean;
  trialDaysLeft: number;
  /** Paid plan OR active trial — soft Pro access for optional CTAs. */
  isPro: boolean;
  statusLabel: string;
  statusDetail: string;
};

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

/**
 * Soft Pro access: paid catalog plan OR an active local trial.
 * Free + expired trial → not Pro (app remains fully browsable).
 */
export function hasProAccess(
  planId: PlanId,
  trialStartedAtMs: number | null,
  nowMs: number,
  trialLengthDays: number = TRIAL_LENGTH_DAYS,
): boolean {
  if (planById(planId).paid) return true;
  return isTrialActive(trialStartedAtMs, nowMs, trialLengthDays);
}

export function buildEntitlementView(
  state: SubscriptionPersistedState,
  nowMs: number,
): EntitlementView {
  const planId = isPlanId(state.planId) ? state.planId : "free";
  const plan = planById(planId);
  const trialDaysLeft = trialDaysRemaining(state.trialStartedAtMs, nowMs);
  const trialActive = trialDaysLeft > 0;
  const isPro = hasProAccess(planId, state.trialStartedAtMs, nowMs);

  let statusLabel: string;
  let statusDetail: string;
  if (plan.paid) {
    statusLabel = plan.name;
    statusDetail = `${plan.priceLabel} ${plan.periodLabel} · preview entitlement`;
  } else if (trialActive) {
    statusLabel = "Free trial";
    statusDetail =
      trialDaysLeft === 1
        ? "1 day left · everything unlocked for this preview"
        : `${trialDaysLeft} days left · everything unlocked for this preview`;
  } else {
    statusLabel = "Free";
    statusDetail = "Browse + Coach stay open · upgrade anytime";
  }

  return {
    planId,
    plan,
    trialActive,
    trialDaysLeft,
    isPro,
    statusLabel,
    statusDetail,
  };
}

/** Sanitize AsyncStorage JSON into a safe persisted shape. */
export function sanitizeSubscriptionState(raw: unknown): SubscriptionPersistedState {
  if (!raw || typeof raw !== "object") {
    return { planId: "free", trialStartedAtMs: null };
  }
  const obj = raw as Record<string, unknown>;
  const planId = isPlanId(obj.planId) ? obj.planId : "free";
  const trialRaw = obj.trialStartedAtMs;
  const trialStartedAtMs =
    typeof trialRaw === "number" && Number.isFinite(trialRaw) && trialRaw > 0
      ? trialRaw
      : null;
  return { planId, trialStartedAtMs };
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
