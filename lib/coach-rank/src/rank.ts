import {
  COACH_GAME_LINE_EDGE_OVERRIDE_PCT,
  type CoachLearningState,
  type CoachQualifiedLeg,
  type CoachQualifiedLegPool,
} from "@workspace/coach-types";
import { applyLearningNudge } from "@workspace/coach-learn";

export type CoachRankedLeg = CoachQualifiedLeg & {
  rankScore: number;
  rankPosition: number;
  learningMultiplier: number;
  confidenceAdjustmentPct: number;
  effectiveConfidencePct: number;
};

export type CoachRankedPool = {
  props: CoachRankedLeg[];
  /** Game lines that cleared the prop-first edge margin. */
  gameLines: CoachRankedLeg[];
  /** Game lines blocked by prop-first policy (edge not 3%+ above best prop). */
  excludedGameLines: CoachRankedLeg[];
  bestPropEdgePct: number | null;
  gameLineEdgeFloorPct: number | null;
};

export type RankQualifiedPoolOptions = {
  learning?: CoachLearningState | null;
  gameLineEdgeOverridePct?: number;
};

/** Base rank score before learning multiplier — higher is better. */
export function computeBaseRankScore(leg: CoachQualifiedLeg): number {
  return (
    leg.compositeScore * 0.55 +
    leg.edgePct * 4 +
    (leg.confidencePct - 50) * 0.15 +
    leg.evPct * 0.5
  );
}

export function bestPropEdge(props: CoachQualifiedLeg[]): number | null {
  if (props.length === 0) return null;
  return Math.max(...props.map((p) => p.edgePct));
}

export function passesPropFirstGameLineMargin(
  gameLine: CoachQualifiedLeg,
  bestPropEdgePct: number | null,
  overridePct = COACH_GAME_LINE_EDGE_OVERRIDE_PCT,
): boolean {
  if (bestPropEdgePct == null) return true;
  return gameLine.edgePct >= bestPropEdgePct + overridePct;
}

function rankLegs(
  legs: CoachQualifiedLeg[],
  learning: CoachLearningState | null | undefined,
): CoachRankedLeg[] {
  const scored = legs.map((leg) => {
    const nudge = applyLearningNudge(leg, learning);
    const base = computeBaseRankScore(leg);
    const rankScore = Math.round(base * nudge.rankWeightMultiplier * 100) / 100;
    return {
      ...leg,
      confidencePct: leg.confidencePct,
      rankScore,
      rankPosition: 0,
      learningMultiplier: nudge.rankWeightMultiplier,
      confidenceAdjustmentPct: nudge.confidenceAdjustmentPct,
      effectiveConfidencePct: nudge.effectiveConfidencePct,
    };
  });

  scored.sort((a, b) => b.rankScore - a.rankScore || b.edgePct - a.edgePct);
  return scored.map((leg, index) => ({ ...leg, rankPosition: index + 1 }));
}

/**
 * Rank a qualified pool — props first by score; game lines only when they beat
 * the best prop edge by the configured margin (default 3%).
 */
export function rankQualifiedPool(
  pool: CoachQualifiedLegPool,
  opts?: RankQualifiedPoolOptions,
): CoachRankedPool {
  const overridePct = opts?.gameLineEdgeOverridePct ?? COACH_GAME_LINE_EDGE_OVERRIDE_PCT;
  const learning = opts?.learning ?? null;

  const props = rankLegs(pool.props, learning);
  const topPropEdge = bestPropEdge(pool.props);
  const floor = topPropEdge == null ? null : topPropEdge + overridePct;

  const eligibleGameLines: CoachQualifiedLeg[] = [];
  const excludedGameLines: CoachQualifiedLeg[] = [];
  for (const gl of pool.gameLines) {
    if (passesPropFirstGameLineMargin(gl, topPropEdge, overridePct)) {
      eligibleGameLines.push(gl);
    } else {
      excludedGameLines.push(gl);
    }
  }

  return {
    props,
    gameLines: rankLegs(eligibleGameLines, learning),
    excludedGameLines: rankLegs(excludedGameLines, learning),
    bestPropEdgePct: topPropEdge,
    gameLineEdgeFloorPct: floor,
  };
}

/** Flat list in ticket-priority order: all props, then eligible game lines. */
export function rankedLegsInTicketOrder(pool: CoachRankedPool): CoachRankedLeg[] {
  return [...pool.props, ...pool.gameLines];
}
