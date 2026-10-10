/**
 * Coach premium visibility — verified entitlement only.
 *
 * Non-subscribed parlay view:
 *   - Show AI Grade, Confidence, Edge %, and qualifying pick counts
 *   - Blur team/player names, event times, sportsbook odds, exact lines
 *   - Lock detailed AI breakdowns
 *
 * Non-parlay Coach Q&A requires signed-in + verified Go/Pro (or admin /
 * designated App Review account). APP_REVIEW_MODE / local planId never unlock.
 */

import {
  isAdminEmail,
  isAppReviewAccountEmail,
  planById,
  type EntitlementAccessOpts,
  type SubscriptionPersistedState,
} from "./entitlements.ts";

export const COACH_PREMIUM_FEATURE_LABEL = "Sign In / Subscribe to Reveal Picks";
export const COACH_QA_SIGN_IN_MESSAGE = "Sign in to ask AI Coach questions.";
export const COACH_QA_SUBSCRIBE_MESSAGE = "Subscribe to unlock AI Coach answers.";

/** Mask shown instead of identity / line / odds when locked. */
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
 * Verified entitlement for Coach premium identity + Q&A.
 * Global APP_REVIEW_MODE never unlocks. Admin / designated review account
 * allowlists unlock only for the matching signed-in email.
 */
export function hasVerifiedCoachEntitlement(
  state: SubscriptionPersistedState,
  _nowMs: number,
  opts: CoachPremiumAccessOpts = {},
): boolean {
  void opts.appReviewMode; // ignored — no global review bypass
  if (isAdminEmail(opts.email, opts.adminEmails ?? [])) return true;
  if (isAppReviewAccountEmail(opts.email, opts.appReviewAccountEmails ?? [])) {
    return true;
  }
  return hasVerifiedStoreKitPaidPlan(state);
}

/**
 * Full Coach premium gate: authentication + verified entitlement.
 * Logged-out and signed-in free users stay locked for identity/Q&A.
 */
export function hasCoachPremiumAccess(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: CoachPremiumAccessOpts = {},
): boolean {
  if (!opts.signedIn) return false;
  return hasVerifiedCoachEntitlement(state, nowMs, opts);
}

/** Soft-lock helper: true → blur identity / lock breakdowns / gate Q&A. */
export function isCoachPremiumLocked(
  state: SubscriptionPersistedState,
  nowMs: number,
  opts: CoachPremiumAccessOpts & { hydrated?: boolean } = {},
): boolean {
  if (opts.hydrated === false) return true;
  return !hasCoachPremiumAccess(state, nowMs, opts);
}

export type CoachAskAccess =
  | { allowed: true }
  | { allowed: false; reason: "sign_in" | "subscribe"; message: string };

/**
 * Non-parlay Coach questions require auth + active subscription.
 * Parlay / leg-build asks are always allowed to run (identity blurred in UI).
 */
export function resolveCoachAskAccess(opts: {
  askText: string;
  isParlayBuild: boolean;
  signedIn: boolean;
  premiumUnlocked: boolean;
}): CoachAskAccess {
  if (opts.isParlayBuild) return { allowed: true };
  if (!opts.signedIn) {
    return { allowed: false, reason: "sign_in", message: COACH_QA_SIGN_IN_MESSAGE };
  }
  if (!opts.premiumUnlocked) {
    return { allowed: false, reason: "subscribe", message: COACH_QA_SUBSCRIBE_MESSAGE };
  }
  return { allowed: true };
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

/** Labels safe when identity is locked — market type only, no names/lines. */
export function publicCoachPickSummary(pick: PublicPickSurface): {
  title: string;
  subtitle: string;
} {
  const market = (pick.market ?? "").trim() || "Market";
  const sport = (pick.sport ?? "").trim().toUpperCase();
  return {
    title: sport ? `${sport} · ${market}` : market,
    subtitle: "Identity locked",
  };
}

type GradeKeep = {
  composite?: number | null;
  grade?: string | null;
  confidencePct?: number | null;
  edgePct?: number | null;
  simHit?: number | null;
  [k: string]: unknown;
};

type RedactablePick = {
  pick: string;
  odds: number;
  game: string;
  market: string;
  edge?: string;
  sport?: string;
  player?: string;
  startsAt?: string | null;
  propLine?: number | null;
  propSide?: string;
  headshot?: string | null;
  teamLogo?: string | null;
  teamAbbr?: string | null;
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  scores?: GradeKeep | null;
  finalAiScore?: GradeKeep | null;
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
  athleteId?: string | null;
  [k: string]: unknown;
};

function keepGradeSlice(src: GradeKeep | null | undefined): GradeKeep | undefined {
  if (!src || typeof src !== "object") return undefined;
  return {
    composite: src.composite ?? null,
    grade: src.grade ?? null,
    confidencePct: src.confidencePct ?? null,
    edgePct: src.edgePct ?? null,
    simHit: src.simHit ?? null,
  };
}

/**
 * Strip identity / line / odds for non-subscribers while keeping grade metrics.
 * Used for API responses and client-side fail-closed rendering.
 */
export function redactPremiumPickFields<T extends RedactablePick>(pick: T): T {
  const live = pick.liveCoach;
  const redactedLive = live
    ? {
        score: PREMIUM_VALUE_MASK,
        period: live.period ?? null,
        periodLabel: live.periodLabel ?? null,
        clock: null,
        line: null,
        price: 0,
        edgePct: typeof live.edgePct === "number" ? live.edgePct : 0,
        confidencePct: typeof live.confidencePct === "number" ? live.confidencePct : 0,
        ageMs: null,
        freshness: live.freshness,
      }
    : live;
  return {
    ...pick,
    game: PREMIUM_VALUE_MASK,
    pick: PREMIUM_VALUE_MASK,
    odds: 0,
    player: undefined,
    startsAt: null,
    edge: undefined,
    propLine: null,
    propSide: undefined,
    headshot: null,
    teamLogo: null,
    teamAbbr: null,
    awayLogo: null,
    homeLogo: null,
    awayAbbr: null,
    homeAbbr: null,
    athleteId: null,
    altOptions: undefined,
    simAltLines: undefined,
    liveCoach: redactedLive,
    highRiskValuePlay: undefined,
    coachFillTier: undefined,
    ticketRole: undefined,
    propMarketKey: undefined,
    propIsAlt: undefined,
    // Keep grade / confidence / edge for the teaser strip.
    scores: keepGradeSlice(pick.scores as GradeKeep | null) as T["scores"],
    finalAiScore: keepGradeSlice(pick.finalAiScore as GradeKeep | null) as T["finalAiScore"],
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
