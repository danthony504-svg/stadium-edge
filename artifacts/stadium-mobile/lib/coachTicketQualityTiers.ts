// Tiered quality fallback for Coach fixed-leg tickets — fill to N before shortfall.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FinalAiScore } from "./finalAiScore.ts";
import { COACH_SIM_MIN_CONFIDENCE, simEvPct } from "./gameSimQualityGates.ts";
import { gradeFromComposite } from "./propHolisticRecommendation.ts";
import { impliedProb } from "./format.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import {
  pickIsAiRecommended,
  pickQualifiesForBoardDelivery,
  propSimEdgeStagingQualifies,
  qualifiesAltPick,
} from "./pickRecommendation.ts";
import { isAltBoardPick, isAltPropPick } from "./altLinePool.ts";
import { coachCandidateIsQualified } from "./coach/qualifyCoachCandidate.ts";

/** User-facing ticket styles — controls how far quality gates relax when filling legs. */
export type CoachTicketStyle = "safe" | "balanced" | "value" | "longshot";

/** Ordered fallback grades — try strict tiers first, then relax toward the style floor. */
export const QUALITY_TIER_GRADES = ["A+", "A", "A-", "B+", "B"] as const;
export type QualityTierGrade = (typeof QUALITY_TIER_GRADES)[number];

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type CoachTicketStyleConfig = {
  /** Ordered min-grade steps used when filling toward the requested leg count. */
  tiers: readonly QualityTierGrade[];
  /** Hard floor — never stage below this grade for the style. */
  absoluteFloor: QualityTierGrade;
};

export const TICKET_STYLE_CONFIG: Record<CoachTicketStyle, CoachTicketStyleConfig> = {
  safe: {
    tiers: ["A+", "A", "A-", "B+"],
    absoluteFloor: "B+",
  },
  balanced: {
    tiers: ["A+", "A", "A-", "B+", "B"],
    absoluteFloor: "B",
  },
  value: {
    tiers: ["A+", "A", "A-", "B+", "B"],
    absoluteFloor: "B",
  },
  longshot: {
    tiers: ["A+", "A", "A-", "B+", "B"],
    absoluteFloor: "B",
  },
};

/** Infer ticket style from the user's Coach ask. */
export function detectCoachTicketStyle(text: string): CoachTicketStyle {
  const t = text.toLowerCase();
  if (/\b(?:safe|low[\s-]?risk|lock(?:\s+parlay)?|chalk)\b/.test(t)) return "safe";
  if (/\b(?:long\s?shots?|longshots?|lottery|boom)\b/.test(t)) return "longshot";
  if (/\b(?:value|plus[\s-]?money|underdogs?|upside)\b/.test(t)) return "value";
  return "balanced";
}

const TICKET_STYLES: ReadonlySet<string> = new Set([
  "safe",
  "balanced",
  "value",
  "longshot",
]);

/**
 * Prefer an explicit Home/deep-link mode over ask-text inference.
 * Explicit modes must drive selection — text alone is a fallback for free-typed asks.
 */
export function resolveCoachTicketStyle(
  explicit: string | null | undefined,
  askText?: string | null,
): CoachTicketStyle {
  const raw = String(explicit ?? "").trim().toLowerCase();
  if (TICKET_STYLES.has(raw)) return raw as CoachTicketStyle;
  return detectCoachTicketStyle(askText ?? "");
}

/**
 * Best Value seats only shared-qualified legs with positive EV/edge.
 * Does not weaken gates — it narrows the already-qualified pool.
 */
export function legHasPositiveEvForValueStyle(leg: {
  evPct?: number | null;
  edgePct?: number | null;
}): boolean {
  const ev = leg.evPct;
  if (ev != null && Number.isFinite(ev) && ev > 0) return true;
  const edge = leg.edgePct;
  return edge != null && Number.isFinite(edge) && edge > 0;
}

/**
 * Lottery / Longshots floor — plus-money (or better) among already-qualified
 * legs. Compares **American odds** (e.g. −215), never the handicap/line
 * (e.g. Penguins +2.5). Heavy chalk must not seat a lottery ticket.
 * Does not weaken sim/qualify/correlation; honest shortfall if short.
 */
export const LONGSHOT_MIN_AMERICAN_ODDS = 100;

export function legQualifiesForLongshotStyle(leg: {
  pick?: { odds?: number | null } | null;
  odds?: number | null;
}): boolean {
  // American price only — pick label handicaps (+2.5) are irrelevant here.
  const odds = leg.pick?.odds ?? leg.odds;
  return odds != null && Number.isFinite(odds) && odds >= LONGSHOT_MIN_AMERICAN_ODDS;
}

/**
 * Style-specific seating narrow for already-qualified legs.
 * Used by primary pools, backfill/replacement, post-staging top-up / lean
 * swaps / multi-sport inject, and the terminal delivered-odds belt so
 * minus-money chalk cannot re-enter a longshot ticket after substitution.
 */
export function legAllowedForTicketStyle(
  leg: {
    evPct?: number | null;
    edgePct?: number | null;
    pick?: { odds?: number | null } | null;
    odds?: number | null;
  },
  ticketStyle?: string | null,
): boolean {
  if (ticketStyle === "value") return legHasPositiveEvForValueStyle(leg);
  if (ticketStyle === "longshot") return legQualifiesForLongshotStyle(leg);
  return true;
}

/** Narrow a scored pool by style using each leg's final American odds. */
export function filterScoredLegsForTicketStyle<
  T extends {
    evPct?: number | null;
    edgePct?: number | null;
    pick?: { odds?: number | null } | null;
    odds?: number | null;
  },
>(scored: readonly T[], ticketStyle?: string | null): T[] {
  if (ticketStyle !== "value" && ticketStyle !== "longshot") return [...scored];
  return scored.filter((leg) => legAllowedForTicketStyle(leg, ticketStyle));
}

/**
 * Terminal belt — drop any delivered pick whose **final** American odds fail
 * the active style (after lean / top-up / inject / reserved fills).
 * Honest shortfall preferred over chalk lottery padding.
 */
export function filterPicksForTicketStyle<T extends { odds?: number | null }>(
  picks: readonly T[],
  ticketStyle?: string | null,
): T[] {
  if (ticketStyle !== "value" && ticketStyle !== "longshot") return [...picks];
  return picks.filter((pick) => legAllowedForTicketStyle(pick, ticketStyle));
}

export function qualityTiersForStyle(style: CoachTicketStyle): readonly QualityTierGrade[] {
  return TICKET_STYLE_CONFIG[style].tiers;
}

export function absoluteFloorForStyle(style: CoachTicketStyle): QualityTierGrade {
  return TICKET_STYLE_CONFIG[style].absoluteFloor;
}

/**
 * Style-tier ranking helper among candidates that already cleared shared
 * qualification. Must never resurrect a shared rejection or decide terminal
 * eligibility on its own.
 */
export function legQualifiesAtMinGrade(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
  minGrade: QualityTierGrade,
): boolean {
  if (!score || score.highRiskValuePlay) return false;
  // Terminal shared status — rejected can never be promoted by tier rules.
  const status = (pick as { qualificationStatus?: "qualified" | "rejected" }).qualificationStatus;
  if (status === "rejected") return false;
  if (
    status !== "qualified" &&
    !coachCandidateIsQualified(
      {
        market: pick.market,
        sport: pick.sport,
        isProp: !!pick.isProp,
        odds: pick.odds,
        propsOnlyTicket: pick.propsOnlyTicket,
        coachRequestStyle: (pick as { coachRequestStyle?: "normal" | "props_only" | "longshot" })
          .coachRequestStyle,
        qualificationStatus: status,
        finalAiScore: score,
      },
      {
        requestStyle: pick.propsOnlyTicket
          ? "props_only"
          : (pick as { coachRequestStyle?: "normal" | "props_only" | "longshot" }).coachRequestStyle ??
            "normal",
        isProp: !!pick.isProp,
      },
    )
  ) {
    return false;
  }
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if ((score.edgePct ?? 0) <= 0) return false;

  const grade = score.grade ?? gradeFromComposite(score.composite);
  if (gradeRank(grade) < gradeRank(minGrade)) return false;

  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }

  // Among shared-qualified legs, tier by delivery/role helpers (ranking only).
  if (pickQualifiesForBoardDelivery(pick, score)) return true;

  if (!pick.isProp) {
    if (score.simAligned) return true;
    if (score.simHit != null && pick.odds != null && score.simHit > impliedProb(pick.odds)) {
      return true;
    }
    return false;
  }

  if (pickIsAiRecommended(pick, score)) return true;
  if (qualifiesAltPick(pick, score)) return true;
  if (propSimEdgeStagingQualifies(pick, score)) return true;
  if ((score.confidencePct ?? 0) >= COACH_SIM_MIN_CONFIDENCE && score.simAligned) return true;

  return false;
}

/** Role label among shared-qualified + tier-eligible legs (not a terminal gate). */
export function poolRoleAtMinGrade(
  pick: ParsedPick,
  score: FinalAiScore | null | undefined,
  minGrade: QualityTierGrade,
): "main" | "alt" | null {
  if (!legQualifiesAtMinGrade(pick, score, minGrade)) return null;
  if (pickQualifiesForBoardDelivery(pick, score)) {
    if (isAltBoardPick(pick) || isAltPropPick(pick) || pick.propIsAlt) return "alt";
    return "main";
  }
  if (pick.propIsAlt || pick.ticketRole === "alt") return "alt";
  return "main";
}
