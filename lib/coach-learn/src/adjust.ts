import {
  COACH_LEARNING_MIN_SAMPLE_SIZE,
  type CoachLearningState,
  type CoachQualifiedLeg,
  type CoachRankAdjustment,
  type CoachSportIdOrCustom,
} from "@workspace/coach-types";

export const DEFAULT_RANK_MULTIPLIER = 1;
export const DEFAULT_CONFIDENCE_ADJUSTMENT_PCT = 0;

export type ResolvedLearningAdjustment = {
  rankWeightMultiplier: number;
  confidenceAdjustmentPct: number;
  sampleSize: number;
  active: boolean;
};

export type LearningNudge = {
  rankWeightMultiplier: number;
  confidenceAdjustmentPct: number;
  effectiveConfidencePct: number;
};

export function normalizeLearningKey(sport: CoachSportIdOrCustom, marketKey: string): string {
  return `${String(sport).toLowerCase()}:${marketKey}`;
}

export function lookupLearningAdjustment(
  state: CoachLearningState | null | undefined,
  sport: CoachSportIdOrCustom,
  marketKey: string,
): ResolvedLearningAdjustment {
  if (!state) {
    return {
      rankWeightMultiplier: DEFAULT_RANK_MULTIPLIER,
      confidenceAdjustmentPct: DEFAULT_CONFIDENCE_ADJUSTMENT_PCT,
      sampleSize: 0,
      active: false,
    };
  }

  const key = normalizeLearningKey(sport, marketKey);
  const match =
    state.adjustments.find((adj) => normalizeLearningKey(adj.sport, adj.marketKey) === key) ??
    null;

  if (!match) {
    return {
      rankWeightMultiplier: DEFAULT_RANK_MULTIPLIER,
      confidenceAdjustmentPct: DEFAULT_CONFIDENCE_ADJUSTMENT_PCT,
      sampleSize: 0,
      active: false,
    };
  }

  const active = match.sampleSize >= COACH_LEARNING_MIN_SAMPLE_SIZE;
  return {
    rankWeightMultiplier: active ? match.rankWeightMultiplier : DEFAULT_RANK_MULTIPLIER,
    confidenceAdjustmentPct: active ? match.confidenceAdjustmentPct : DEFAULT_CONFIDENCE_ADJUSTMENT_PCT,
    sampleSize: match.sampleSize,
    active,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Apply learning nudges to rank/confidence only — never bypasses gates or changes edge.
 */
export function applyLearningNudge(
  leg: Pick<CoachQualifiedLeg, "sport" | "marketKey" | "confidencePct">,
  state: CoachLearningState | null | undefined,
): LearningNudge {
  const adj = lookupLearningAdjustment(state, leg.sport, leg.marketKey);
  return {
    rankWeightMultiplier: adj.rankWeightMultiplier,
    confidenceAdjustmentPct: adj.confidenceAdjustmentPct,
    effectiveConfidencePct: clamp(
      Math.round(leg.confidencePct + adj.confidenceAdjustmentPct),
      5,
      95,
    ),
  };
}

export function emptyLearningState(): CoachLearningState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    adjustments: [],
  };
}

export function mergeLearningAdjustments(
  base: CoachLearningState,
  incoming: CoachRankAdjustment[],
): CoachLearningState {
  const map = new Map<string, CoachRankAdjustment>();
  for (const adj of base.adjustments) {
    map.set(normalizeLearningKey(adj.sport, adj.marketKey), adj);
  }
  for (const adj of incoming) {
    map.set(normalizeLearningKey(adj.sport, adj.marketKey), adj);
  }
  return {
    version: base.version + 1,
    updatedAt: new Date().toISOString(),
    adjustments: [...map.values()],
  };
}
