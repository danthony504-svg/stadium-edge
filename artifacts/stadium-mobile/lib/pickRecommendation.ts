// AI recommendation gate — only markets that pass simulation + edge + EV + confidence.

import type { FinalAiScore } from "./finalAiScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  simEvPct,
} from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "./simMarketSupport.ts";
import { enrichPicksWithSport } from "./chatContextPriority.ts";
import { filterBettablePicks, enrichPicksWithStartsAt } from "./slate.ts";

export type CoachPickEnrichSources = Parameters<typeof enrichPicksWithStartsAt>[1] & {
  propPool?: Array<{ game: string; player?: string; sport?: string; startsAt?: string | null }>;
  gameMeta?: Array<{ game: string; sport: string; startsAt?: string | null }>;
};

function stripHrvpFromPick<
  T extends { highRiskValuePlay?: boolean; finalAiScore?: FinalAiScore | null },
>(p: T): T {
  return {
    ...p,
    highRiskValuePlay: false,
    finalAiScore: p.finalAiScore
      ? { ...p.finalAiScore, highRiskValuePlay: false }
      : p.finalAiScore,
  };
}

function enrichCoachPicksForGate<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
    startsAt?: string | null;
    sport?: string;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  if (!enrich) return picks;
  const withSport = enrichPicksWithSport(
    picks,
    enrich.propPool ?? [],
    enrich.realOdds ?? [],
    enrich.gameMeta,
  );
  return enrichPicksWithStartsAt(withSport, enrich);
}

/** Alt ladder legs use the same confidence floor as main picks — never lowered to fill a ticket. */
export const ALT_PICK_MIN_CONFIDENCE = COACH_SIM_MIN_CONFIDENCE;

export const NOT_AI_RECOMMENDED = "Not AI Recommended";

export type RecommendablePick = {
  market?: string;
  isProp?: boolean;
  sport?: string;
  odds?: number | null;
  ticketRole?: "main" | "alt";
};

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

/** True when a pick passes all AI recommendation thresholds (sim must agree). */
export function pickIsAiRecommended(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (!score.simAligned) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const implied = impliedProb(pick.odds);
    if (score.simHit <= implied) return false;
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return score.recommends;
}

/** Letter grade for a sim-graded leg on a ticket (main or alt). */
export function pickQualifiesForTicketGrade(
  pick: RecommendablePick & { ticketRole?: "main" | "alt" },
  score: FinalAiScore | null | undefined,
): boolean {
  return pickIsAiRecommended(pick, score) || qualifiesAltPick(pick, score);
}

/** True when an alt rung passes grade/confidence/EV/edge gates (same bar as mains). */
export function qualifiesAltPick(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (!score.simAligned) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < ALT_PICK_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const implied = impliedProb(pick.odds);
    if (score.simHit <= implied) return false;
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return true;
}

function gradeFromPickScore(
  pick: RecommendablePick & { scores?: { grade?: string | null } | null },
  score: FinalAiScore | null | undefined,
): string | null {
  return score?.grade ?? pick.scores?.grade ?? null;
}

/** Display label for pick card grade tile. */
export function pickGradeDisplayLabel(
  pick: RecommendablePick & { scores?: { grade?: string | null } | null },
  score: FinalAiScore | null | undefined,
): string | null {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) return null;
  if (!pickHasSimGrade(pick, score?.simHit)) return null;
  if (pickQualifiesForTicketGrade(pick, score ?? undefined)) {
    return gradeFromPickScore(pick, score);
  }
  return NOT_AI_RECOMMENDED;
}

export function pickGradeDisplayCaption(
  pick: RecommendablePick & { simulationPending?: boolean; scores?: { grade?: string | null } | null },
  score: FinalAiScore | null | undefined,
): string {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) {
    return "Simulation not available for this market yet";
  }
  if (pick.simulationPending) {
    return "Running 10k simulation…";
  }
  if (!pickHasSimGrade(pick, score?.simHit)) {
    return "Waiting for simulation result…";
  }
  if (pickIsAiRecommended(pick, score ?? undefined)) {
    return "Passes sim, edge, EV, and confidence thresholds";
  }
  if (qualifiesAltPick(pick, score ?? undefined)) {
    return "Alternate pick — positive EV, edge, and sim grade";
  }
  return "Did not pass AI recommendation thresholds";
}

/** Main legs use the strict gate; staged alt legs use the alt ladder gate (same grade/confidence bar). */
export function pickPassesTicketGate(
  pick: RecommendablePick & { ticketRole?: "main" | "alt" },
  score: FinalAiScore | null | undefined,
): boolean {
  if (pick.ticketRole === "alt") {
    return qualifiesAltPick(pick, score);
  }
  return pickIsAiRecommended(pick, score) || qualifiesAltPick(pick, score);
}

/** Keep only legs that pass every AI recommendation threshold. */
export function filterAiRecommendedPicks<T extends RecommendablePick & { finalAiScore?: FinalAiScore | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => pickIsAiRecommended(p, p.finalAiScore));
}

/** Keep main legs that pass the strict gate and alt legs that pass the alt gate. */
export function filterTicketPicks<
  T extends RecommendablePick & { finalAiScore?: FinalAiScore | null; ticketRole?: "main" | "alt" },
>(picks: T[]): T[] {
  return picks.filter((p) => {
    if (!pickPassesTicketGate(p, p.finalAiScore)) return false;
    const edge = p.finalAiScore?.edgePct;
    if (edge != null && edge <= 0) return false;
    return true;
  });
}

/** Never zero a grounded ticket — keep qualifying alts or strongest sim-graded edge. */
export function filterTicketPicksPreservingTicket<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
  },
>(picks: T[]): T[] {
  const filtered = filterTicketPicks(picks);
  if (filtered.length > 0 || picks.length === 0) return filtered;
  const altFallback = picks.filter((p) => qualifiesAltPick(p, p.finalAiScore));
  if (altFallback.length > 0) return altFallback;
  // Progressive rescoring can flip recommends off while edge + sim stay positive —
  // keep the strongest sim-graded legs rather than wiping a board-built ticket.
  const rescoringFallback = [...picks]
    .filter((p) => {
      if (!pickHasSimGrade(p, p.finalAiScore?.simHit)) return false;
      if (!p.finalAiScore?.simAligned) return false;
      const edge = p.finalAiScore?.edgePct;
      return edge != null && edge > 0;
    })
    .sort(
      (a, b) =>
        (b.finalAiScore?.composite ?? b.scores?.composite ?? 0) -
        (a.finalAiScore?.composite ?? a.scores?.composite ?? 0),
    );
  return rescoringFallback;
}

export function countAiRecommendedPicks(
  picks: Array<RecommendablePick & { finalAiScore?: FinalAiScore | null }>,
): number {
  return picks.filter((p) => pickIsAiRecommended(p, p.finalAiScore)).length;
}

export { enrichPicksWithStartsAt } from "./slate.ts";

/** Final coach ticket gate — sim-aligned legs within the bettable window only. */
export function sanitizeCoachTicketPicks<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
    startsAt?: string | null;
    sport?: string;
    highRiskValuePlay?: boolean;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  const enriched = enrichCoachPicksForGate(picks, enrich);
  const gated = filterTicketPicks(enriched);
  const kept = gated.length > 0 ? gated : enriched.filter((p) => qualifiesAltPick(p, p.finalAiScore));
  return filterBettablePicks(kept.map(stripHrvpFromPick));
}

export function stripCoachTicketHrvp<
  T extends { highRiskValuePlay?: boolean; finalAiScore?: FinalAiScore | null },
>(p: T): T {
  return stripHrvpFromPick(p);
}

/** Deliver board-scan legs — gate when possible, never return empty if scan produced qualifiers. */
export function prepareBoardScanDelivery<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
    startsAt?: string | null;
    sport?: string;
    highRiskValuePlay?: boolean;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  if (!picks.length) return [];
  const gated = coachBoardScanTicketPicks(picks, enrich);
  if (gated.length > 0) return gated;
  return enrichCoachPicksForGate(picks, enrich)
    .map(stripHrvpFromPick)
    .filter((p) => {
      const score = p.finalAiScore;
      if (score?.highRiskValuePlay) return false;
      if (score && !score.simAligned) return false;
      return true;
    });
}

/** Board-scan legs already cleared sim/edge gates — enrich metadata and deliver without re-zeroing. */
export function coachBoardScanTicketPicks<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
    startsAt?: string | null;
    sport?: string;
    highRiskValuePlay?: boolean;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  if (!picks.length) return [];
  const enriched = enrichCoachPicksForGate(picks, enrich).map(stripHrvpFromPick);
  const bettable = filterBettablePicks(enriched);
  if (bettable.length > 0) return bettable;
  return enriched.filter((p) => {
    const score = p.finalAiScore;
    if (score?.highRiskValuePlay) return false;
    if (!score?.simAligned) return false;
    const edge = score.edgePct;
    if (edge == null || edge <= 0) return false;
    if (!pickHasSimGrade(p, score.simHit)) return false;
    return pickPassesTicketGate(p, score) || qualifiesAltPick(p, score);
  });
}

/** Flash partial board scans — strict gate first, then sim-aligned legs with metadata filled in. */
export function coachFlashTicketPicks<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
    startsAt?: string | null;
    sport?: string;
    highRiskValuePlay?: boolean;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  const strict = sanitizeCoachTicketPicks(picks, enrich);
  if (strict.length > 0) return strict;
  const enriched = enrichCoachPicksForGate(picks, enrich);
  const preserved = filterBettablePicks(
    filterTicketPicksPreservingTicket(enriched).map(stripHrvpFromPick),
  );
  if (preserved.length > 0) return preserved;
  return coachBoardScanTicketPicks(enriched, enrich);
}

/** Final ticket gate — strict sanitize, then rescoring/flash salvage so board builds don't zero. */
export function finalizeCoachTicketPicks<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
    startsAt?: string | null;
    sport?: string;
    highRiskValuePlay?: boolean;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(
  picks: T[],
  enrich?: CoachPickEnrichSources,
): { picks: T[]; removed: number; usedRescoringFallback: boolean } {
  if (!picks.length) return { picks: [], removed: 0, usedRescoringFallback: false };
  const strict = sanitizeCoachTicketPicks(picks, enrich);
  if (strict.length > 0) {
    return { picks: strict, removed: picks.length - strict.length, usedRescoringFallback: false };
  }
  const enriched = enrichCoachPicksForGate(picks, enrich);
  const preserved = filterTicketPicksPreservingTicket(enriched).map(stripHrvpFromPick);
  const bettablePreserved = filterBettablePicks(preserved);
  if (bettablePreserved.length > 0) {
    return {
      picks: bettablePreserved,
      removed: picks.length - bettablePreserved.length,
      usedRescoringFallback: true,
    };
  }
  const flash = coachFlashTicketPicks(enriched, enrich);
  const board = flash.length > 0 ? flash : prepareBoardScanDelivery(enriched, enrich);
  return {
    picks: board,
    removed: picks.length - board.length,
    usedRescoringFallback: board.length > 0,
  };
}
