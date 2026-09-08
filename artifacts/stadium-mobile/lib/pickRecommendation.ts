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
import { filterBettablePicks, enrichPicksWithStartsAt, preferBettableQualifiedPicks } from "./slate.ts";
import { isAltBoardPick, isAltPropPick, isMainBoardPick } from "./altLinePool.ts";
import { isFillerBackfillPick } from "./coachScanPolicy.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  PROP_HOLISTIC_MIN_GRADE,
  propQualifiesForTicketFill,
} from "./propHolisticRecommendation.ts";

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

function normalizeBoardScanPickScore<
  T extends RecommendablePick & {
    odds?: number | null;
    finalAiScore?: FinalAiScore | null;
    edge?: string;
  },
>(pick: T): T {
  const score = pick.finalAiScore;
  if (!score || score.simHit == null) return pick;

  if (pick.isProp && score.propHolistic) {
    const holistic = score.propHolistic;
    // Holistic gate reads holistic.recommends — not the sim-only recommends flag.
    const holisticPassed = propHolisticGatePassed(pick, {
      ...score,
      recommends: holistic.recommends ?? score.recommends,
    });
    return {
      ...pick,
      finalAiScore: {
        ...score,
        // Keep sim grade/confidence for staging delivery when holistic context is thin.
        ...(holisticPassed
          ? {
              composite: holistic.composite ?? score.composite,
              grade: holistic.grade ?? score.grade,
              confidencePct: holistic.confidencePct ?? score.confidencePct,
            }
          : {}),
        recommends: holisticPassed,
        propHolistic: { ...holistic, recommends: holistic.recommends ?? false },
      },
    };
  }

  const simHit = score.simHit!;
  const implied = pick.odds != null ? impliedProb(pick.odds) : null;
  const simAligned = score.simAligned ?? (implied != null ? simHit > implied : simHit >= 0.52);
  const edgeFromOdds =
    typeof (pick as { edgeNum?: number }).edgeNum === "number"
      ? (pick as { edgeNum?: number }).edgeNum!
      : null;
  const edgePct =
    score.edgePct ??
    edgeFromOdds ??
    (implied != null ? Math.round((simHit - implied) * 1000) / 10 : null);
  const confidencePct = score.confidencePct ?? Math.round(simHit * 100);
  const grade = score.grade ?? (simHit >= 0.58 ? "B" : simHit >= 0.54 ? "B-" : "C+");
  const recommends =
    score.recommends ??
    (simAligned &&
      (edgePct ?? 0) > 0 &&
      pickHasSimGrade(pick, simHit) &&
      gradeRank(grade) >= gradeRank(COACH_SIM_MIN_GRADE));
  return {
    ...pick,
    finalAiScore: {
      ...score,
      grade,
      simAligned,
      recommends,
      confidencePct,
      edgePct: edgePct ?? score.edgePct,
      highRiskValuePlay: score.highRiskValuePlay ?? false,
      factors: score.factors ?? [],
      rubric: score.rubric ?? {
        composite: score.composite ?? 0,
        grade,
        confidencePct,
        edgePct: edgePct ?? 0,
        scores: {} as never,
      },
    },
  };
}

function normalizeBoardScanPicks<
  T extends RecommendablePick & {
    odds?: number | null;
    finalAiScore?: FinalAiScore | null;
  },
>(picks: T[]): T[] {
  return picks.map((p) => normalizeBoardScanPickScore(p));
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
/** Short label for narrow coach card grade tiles (avoids awkward line breaks). */
export const NOT_AI_RECOMMENDED_COMPACT = "Not Rec.";

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

/** Confidence floor from a grounded sim hit when holistic coverage is thin. */
function propSimConfidenceFloor(simHit: number | null | undefined): number {
  if (simHit == null || !Number.isFinite(simHit)) return 0;
  return Math.max(5, Math.min(95, Math.round(50 + Math.abs(simHit - 0.5) * 40)));
}

function effectivePropConfidence(score: FinalAiScore): number {
  return Math.max(score.confidencePct ?? 0, propSimConfidenceFloor(score.simHit));
}

function legacyPropStagingQualifies(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score || !pick.isProp || score.propHolistic) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (!score.simAligned) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (effectivePropConfidence(score) < COACH_SIM_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const implied = impliedProb(pick.odds);
    if (score.simHit <= implied) return false;
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return score.recommends || gradeRank(score.grade) >= gradeRank(COACH_SIM_MIN_GRADE);
}

function propUsesHolisticGate(pick: RecommendablePick): boolean {
  return !!pick.isProp;
}

function propHolisticGatePassed(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score || !pick.isProp) return false;
  const holistic = score.propHolistic;
  if (!holistic) return legacyPropStagingQualifies(pick, score);
  if (!score.recommends) return false;
  if (gradeRank(holistic.grade ?? score.grade) < gradeRank(PROP_HOLISTIC_MIN_GRADE)) return false;
  if ((holistic.confidencePct ?? score.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return true;
}

/** Sim + edge staging bar for filling fixed-leg tickets when holistic context is thin. */
export function propSimEdgeStagingQualifies(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score || !pick.isProp) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (effectivePropConfidence(score) < COACH_SIM_MIN_CONFIDENCE) return false;
  if (score.simHit != null && pick.odds != null) {
    const implied = impliedProb(pick.odds);
    if (score.simHit <= implied) return false;
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return true;
}

/** Same role gate as board staging pools — keeps delivery aligned with scan qualification. */
export function pickQualifiesForBoardDelivery(
  pick: RecommendablePick & {
    ticketRole?: "main" | "alt";
    odds?: number | null;
    propIsAlt?: boolean;
  },
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (isMainBoardPick(pick as { market?: string; pick?: string; isProp?: boolean; propIsAlt?: boolean })) {
    if (pickIsAiRecommended(pick, score)) return true;
    return !!(pick.isProp && propSimEdgeStagingQualifies(pick, score));
  }
  if (isAltBoardPick(pick as { market?: string; pick?: string; isProp?: boolean })) {
    return qualifiesAltPick(pick, score);
  }
  if (pickIsAiRecommended(pick, score)) return true;
  if (qualifiesAltPick(pick, score)) return true;
  if (
    pick.isProp &&
    score.propHolistic &&
    propQualifiesForTicketFill(pick, score.propHolistic, {
      edgePct: score.edgePct,
      simHit: score.simHit,
      odds: pick.odds,
    })
  ) {
    return true;
  }
  if (pick.isProp && qualifiesAltPick(pick, score)) return true;
  if (propSimEdgeStagingQualifies(pick, score)) return true;
  return false;
}

/** Board-built legs that cleared staging — same bar as ticket delivery. */
export function boardScanStagedLegQualifies(
  pick: RecommendablePick & {
    ticketRole?: "main" | "alt";
    odds?: number | null;
    propIsAlt?: boolean;
    coachFillTier?: "A+" | "A" | "A-" | "B+" | "B" | "B-";
  },
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score || score.highRiskValuePlay) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  if (pick.coachFillTier) {
    return gradeRank(score.grade) >= gradeRank(pick.coachFillTier);
  }
  return pickQualifiesForBoardDelivery(pick, score);
}

/** True when a pick passes all AI recommendation thresholds (sim must agree). */
export function pickIsAiRecommended(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (propUsesHolisticGate(pick)) {
    return propHolisticGatePassed(pick, score);
  }
  if (!score.simAligned) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (effectivePropConfidence(score) < COACH_SIM_MIN_CONFIDENCE) return false;
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
  if (propUsesHolisticGate(pick)) {
    if (propHolisticGatePassed(pick, score)) return true;
    const holistic = score.propHolistic;
    if (!holistic) return legacyPropStagingQualifies(pick, score);
    return propQualifiesForTicketFill(
      pick as import("../components/PickCard.tsx").ParsedPick,
      holistic,
      { edgePct: score.edgePct, simHit: score.simHit, odds: pick.odds },
    );
  }
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
  if (pickPassesTicketGate(pick, score ?? undefined)) {
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
    return pick.isProp
      ? "Passes holistic form, matchup, value, and simulation thresholds"
      : "Passes sim, edge, EV, and confidence thresholds";
  }
  if (qualifiesAltPick(pick, score ?? undefined)) {
    return "Alternate pick — positive EV, edge, and sim grade";
  }
  if (propSimEdgeStagingQualifies(pick, score ?? undefined)) {
    return pick.isProp
      ? "Sim + edge cleared — matchup and form still loading"
      : "Sim-aligned with positive edge";
  }
  return "Did not pass AI recommendation thresholds";
}

/** Main legs use the strict gate; staged alt legs use the alt ladder gate (same grade/confidence bar). */
export function pickPassesTicketGate(
  pick: RecommendablePick & { ticketRole?: "main" | "alt" },
  score: FinalAiScore | null | undefined,
): boolean {
  if (propSimEdgeStagingQualifies(pick, score)) return true;
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

/** Hard delivery filter — positive edge, sim grade, and ticket gate. No Not Rec / negative EV legs. */
export function filterCoachDeliveredPicks<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    startsAt?: string | null;
    sport?: string;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
    odds?: number | null;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  if (!picks.length) return [];
  const enriched = enrichCoachPicksForGate(picks, enrich).map(stripHrvpFromPick);
  return enriched.filter((p) => {
    const score = p.finalAiScore;
    if (!score || score.highRiskValuePlay) return false;
    if (!pickHasSimGrade(p, score.simHit)) return false;
    const edge = score.edgePct;
    if (edge == null || edge <= 0) return false;
    if (score.simHit != null && p.odds != null) {
      const ev = simEvPct(score.simHit, p.odds);
      if (ev != null && ev <= 0) return false;
    }
    const fillTier = (p as { coachFillTier?: "A+" | "A" | "A-" | "B+" | "B" | "B-" }).coachFillTier;
    if (fillTier) {
      return boardScanStagedLegQualifies(
        { ...p, coachFillTier: fillTier },
        score,
      );
    }
    return pickQualifiesForBoardDelivery(p, score);
  });
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
  const noFiller = picks.filter((p) => !isFillerBackfillPick(p));
  const enriched = enrichCoachPicksForGate(noFiller, enrich);
  const gated = filterTicketPicks(enriched);
  const kept = gated.length > 0 ? gated : enriched.filter((p) => qualifiesAltPick(p, p.finalAiScore));
  return preferBettableQualifiedPicks(kept.map(stripHrvpFromPick));
}

export function stripCoachTicketHrvp<
  T extends { highRiskValuePlay?: boolean; finalAiScore?: FinalAiScore | null },
>(p: T): T {
  return stripHrvpFromPick(p);
}

/** In-flight board scan — show ranked legs with real odds before strict gates / startsAt resolve. */
export function coachFlashBoardScanPreviewPicks<
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
    odds?: number | null;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  if (!picks.length) return [];
  const normalized = normalizeBoardScanPicks(picks);
  const enriched = enrichCoachPicksForGate(normalized, enrich).map(stripHrvpFromPick);
  const previewQualified = enriched.filter((p) => {
    if (p.odds == null || !Number.isFinite(p.odds)) return false;
    const score = p.finalAiScore;
    if (!score) return false;
    if (!pickHasSimGrade(p, score.simHit)) return false;
    const edge = score.edgePct;
    return edge != null && edge > 0;
  });
  if (previewQualified.length > 0) return previewQualified;
  // Sim still landing — flash odds-backed legs only when no grade exists yet.
  const awaitingSim = enriched.filter(
    (p) => p.odds != null && Number.isFinite(p.odds) && !p.finalAiScore,
  );
  if (awaitingSim.length > 0) return awaitingSim;
  return normalized.filter((p) => p.odds != null && Number.isFinite(p.odds) && !p.finalAiScore);
}

/** Deliver board-scan legs that already cleared staging — don't re-zero on stricter holistic gate. */
export function coachPreserveStagedBoardPicks<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    startsAt?: string | null;
    sport?: string;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(picks: T[], enrich?: CoachPickEnrichSources): T[] {
  if (!picks.length) return [];
  const normalized = normalizeBoardScanPicks(picks);
  const enriched = enrichCoachPicksForGate(normalized, enrich).map(stripHrvpFromPick);
  const qualified = enriched.filter((p) => boardScanStagedLegQualifies(p, p.finalAiScore));
  if (qualified.length > 0) return preferBettableQualifiedPicks(qualified);
  return [];
}

/** Board-scan → ticket: strict AI gates first, then flash/finalize salvage (no filler). */
export function coachDeliverBoardScanPicks<
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
  const noFiller = picks.filter((p) => !isFillerBackfillPick(p));
  const normalized = normalizeBoardScanPicks(noFiller);
  const board = prepareBoardScanDelivery(normalized, enrich);
  if (board.length > 0) return board;
  const flash = coachFlashTicketPicks(normalized, enrich);
  if (flash.length > 0) return flash;
  return finalizeCoachTicketPicks(normalized, enrich).picks;
}

/** Deliver board-scan legs — only AI Recommended / qualifying alt picks; never filler. */
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
  const preserved = coachPreserveStagedBoardPicks(picks, enrich);
  if (preserved.length > 0) return preserved;
  const gated = coachBoardScanTicketPicks(picks, enrich);
  if (gated.length > 0) return gated;
  return filterTicketPicks(enrichCoachPicksForGate(picks, enrich).map(stripHrvpFromPick));
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
  const normalized = normalizeBoardScanPicks(picks);
  const enriched = enrichCoachPicksForGate(normalized, enrich).map(stripHrvpFromPick);
  const qualified = enriched.filter((p) => {
    const score = p.finalAiScore;
    if (score?.highRiskValuePlay) return false;
    if (!score?.simAligned) return false;
    const edge = score.edgePct;
    if (edge == null || edge <= 0) return false;
    if (!pickHasSimGrade(p, score.simHit)) return false;
    return pickPassesTicketGate(p, score) || qualifiesAltPick(p, score);
  });
  if (qualified.length > 0) return preferBettableQualifiedPicks(qualified);
  return [];
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
  const preserved = preferBettableQualifiedPicks(
    filterTicketPicksPreservingTicket(enriched).map(stripHrvpFromPick),
  );
  if (preserved.length > 0) return preserved;
  return coachBoardScanTicketPicks(enriched, enrich);
}

/** Finalize a board-built ticket — enrich metadata, keep staged sim+edge legs, top up to target. */
export function finalizeBoardBuiltCoachTicket<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    startsAt?: string | null;
    sport?: string;
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
  const noFiller = picks.filter((p) => !isFillerBackfillPick(p));
  const enriched = enrichCoachPicksForGate(noFiller, enrich).map(stripHrvpFromPick);
  const kept = enriched.filter((p) => boardScanStagedLegQualifies(p, p.finalAiScore));
  if (kept.length > 0) {
    const delivered = preferBettableQualifiedPicks(kept);
    return {
      picks: delivered,
      removed: noFiller.length - delivered.length,
      usedRescoringFallback: delivered.length < noFiller.length,
    };
  }
  return finalizeCoachTicketPicks(picks, enrich);
}

/** Pull additional staged board legs onto a short fixed-leg ticket. */
export function topUpBoardBuiltTicket<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    startsAt?: string | null;
    sport?: string;
    game?: string;
    market?: string;
    pick?: string;
    isProp?: boolean;
    player?: string;
  },
>(current: T[], target: number, pool: T[], enrich?: CoachPickEnrichSources): T[] {
  if (current.length >= target || !pool.length) return current.slice(0, target);
  const enriched = enrichCoachPicksForGate(pool, enrich).map(stripHrvpFromPick);
  const seen = new Set(current.map((p) => pickLegFingerprint(p)));
  const out: T[] = [...current];
  for (const leg of enriched) {
    if (out.length >= target) break;
    const fp = pickLegFingerprint(leg);
    if (seen.has(fp)) continue;
    if (!boardScanStagedLegQualifies(leg, leg.finalAiScore)) continue;
    out.push(leg);
    seen.add(fp);
  }
  return preferBettableQualifiedPicks(out).slice(0, target);
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
  const noFiller = picks.filter((p) => !isFillerBackfillPick(p));
  const staged = coachPreserveStagedBoardPicks(noFiller, enrich);
  if (staged.length > 0) {
    const delivered = filterCoachDeliveredPicks(staged, enrich);
    return {
      picks: delivered,
      removed: noFiller.length - delivered.length,
      usedRescoringFallback: delivered.length < noFiller.length,
    };
  }
  const strict = sanitizeCoachTicketPicks(noFiller, enrich);
  if (strict.length > 0) {
    const delivered = filterCoachDeliveredPicks(strict, enrich);
    return {
      picks: delivered,
      removed: noFiller.length - delivered.length,
      usedRescoringFallback: false,
    };
  }
  const enriched = enrichCoachPicksForGate(noFiller, enrich);
  const preserved = preferBettableQualifiedPicks(
    filterTicketPicksPreservingTicket(enriched).map(stripHrvpFromPick),
  );
  if (preserved.length > 0) {
    const delivered = filterCoachDeliveredPicks(preserved, enrich);
    return {
      picks: delivered,
      removed: noFiller.length - delivered.length,
      usedRescoringFallback: delivered.length > 0,
    };
  }
  const flash = coachFlashTicketPicks(enriched, enrich);
  const board = flash.length > 0 ? flash : prepareBoardScanDelivery(enriched, enrich);
  const delivered = filterCoachDeliveredPicks(board, enrich);
  return {
    picks: delivered,
    removed: noFiller.length - delivered.length,
    usedRescoringFallback: delivered.length > 0,
  };
}
