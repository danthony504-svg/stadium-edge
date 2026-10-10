/**
 * Coach premium visibility — verified entitlement only.
 *
 * Public/non-subscribed: teams, players, matchups, sport, kickoff stay visible.
 * Pick side/line/odds, AI Grade/Confidence/Edge/EV/sim, and breakdowns stay locked.
 *
 * Unlock requires signed-in + (Apple StoreKit Go|Pro with storeKitActive) or admin.
 * APP_REVIEW_MODE / local planId / purchase-screen booleans never unlock Coach premium.
 */

import {
  isAdminEmail,
  planById,
  type EntitlementAccessOpts,
  type SubscriptionPersistedState,
} from "./entitlements.ts";

export const COACH_PREMIUM_FEATURE_LABEL = "Unlock AI Picks";

/** Mask shown instead of pick text / odds when locked. */
export const PREMIUM_VALUE_MASK = "••••••";

export type CoachPremiumAccessOpts = EntitlementAccessOpts & {
  /** Clerk (or equivalent) signed-in flag — required for consumer unlock. */
  signedIn?: boolean;
};

/**
 * True when Apple/RevenueCat reports an active paid Go or Pro plan.
 * Ignores app-review mode and unverified local planId.
 */
export function hasVerifiedStoreKitPaidPlan(
  state: Pick<SubscriptionPersistedState, "planId" | "storeKitActive">,
): boolean {
  return state.storeKitActive === true && planById(state.planId).paid;
}

/**
 * Verified entitlement for Coach premium content (no review-mode bypass).
 * Admin allowlist still unlocks for signed-in allowlisted accounts.
 */
export function hasVerifiedCoachEntitlement(
  state: SubscriptionPersistedState,
  _nowMs: number,
  opts: CoachPremiumAccessOpts = {},
): boolean {
  if (isAdminEmail(opts.email, opts.adminEmails ?? [])) return true;
  return hasVerifiedStoreKitPaidPlan(state);
}

/**
 * Full Coach premium gate: authentication + verified entitlement.
 * Logged-out and signed-in free users stay locked.
 */
export function hasCoachPremiumAccess(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: CoachPremiumAccessOpts = {},
): boolean {
  if (!opts.signedIn) return false;
  return hasVerifiedCoachEntitlement(state, nowMs, opts);
}

/** Soft-lock helper: true → blur/lock premium Coach fields. */
export function isCoachPremiumLocked(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: CoachPremiumAccessOpts & { hydrated?: boolean } = {},
): boolean {
  if (opts.hydrated === false) return true;
  return !hasCoachPremiumAccess(state, nowMs, opts);
}

export type PublicPickSurface = {
  game: string;
  market: string;
  sport?: string;
  player?: string;
  startsAt?: string | null;
  isProp?: boolean;
  teamAbbr?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
};

/** Labels safe to show when premium is locked (no side/line/odds). */
export function publicCoachPickSummary(pick: PublicPickSurface): {
  title: string;
  subtitle: string;
} {
  const player = (pick.player ?? "").trim();
  const market = (pick.market ?? "").trim() || "Market";
  if (player) {
    return { title: player, subtitle: market };
  }
  return { title: market, subtitle: "AI pick locked" };
}

type RedactablePick = {
  pick: string;
  odds: number;
  edge?: string;
  propLine?: number | null;
  propSide?: string;
  scores?: unknown;
  finalAiScore?: unknown;
  altOptions?: unknown;
  simAltLines?: unknown;
  liveCoach?: {
    score?: string;
    period?: number | null;
    periodLabel?: string | null;
    clock?: string | null;
    line?: number | null;
    price?: number;
    edgePct?: number;
    confidencePct?: number;
    ageMs?: number | null;
    freshness?: string;
    [k: string]: unknown;
  } | null;
  highRiskValuePlay?: boolean;
  coachFillTier?: unknown;
  ticketRole?: unknown;
  [k: string]: unknown;
};

/**
 * Strip premium fields from a pick for API / non-subscriber clients.
 * Keeps matchup, player, sport, market type, and start time.
 */
export function redactPremiumPickFields<T extends RedactablePick>(pick: T): T {
  const live = pick.liveCoach;
  const redactedLive = live
    ? {
        ...live,
        line: null,
        price: 0,
        edgePct: 0,
        confidencePct: 0,
      }
    : live;
  return {
    ...pick,
    pick: PREMIUM_VALUE_MASK,
    odds: 0,
    edge: undefined,
    propLine: null,
    propSide: undefined,
    scores: undefined,
    finalAiScore: undefined,
    altOptions: undefined,
    simAltLines: undefined,
    liveCoach: redactedLive,
    highRiskValuePlay: undefined,
    coachFillTier: undefined,
    ticketRole: undefined,
  };
}

export function redactPremiumBoardScanPicks<T extends { picks?: RedactablePick[] | null }>(
  scan: T | null | undefined,
): T | null {
  if (!scan) return null;
  const picks = Array.isArray(scan.picks)
    ? scan.picks.map((p) => redactPremiumPickFields(p))
    : scan.picks;
  return { ...scan, picks };
}
