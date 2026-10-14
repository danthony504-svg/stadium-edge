import {
  COACH_DEEP_SIM_ITERATIONS,
  COACH_QUICK_SIM_ITERATIONS,
  type CoachCandidateLeg,
  type CoachSimResult,
  type CoachSimTier,
} from "@workspace/coach-types";
import { americanToDecimal, impliedProbabilityFromAmerican } from "@workspace/coach-data";

/** Mirrors api-server SimPropRequest — built fresh for coach v2. */
export type PropSimRequest = {
  sport: string;
  player: string;
  market: string;
  line: number;
  side: "Over" | "Under";
  odds: number;
  athleteId?: string | null;
  additionalLines?: number[];
};

/** Mirrors POST /sports/simulate/props row shape. */
export type PropSimApiRow = {
  simulations: number;
  hitProbability: number | null;
  confidenceScore?: number | null;
  meanProjection?: number | null;
  tier?: CoachSimTier;
  cached?: boolean;
};

export type PropSimApiResponse = {
  props: PropSimApiRow[];
  deepPending?: boolean;
};

export function iterationsForTier(tier: CoachSimTier): number {
  return tier === "deep" ? COACH_DEEP_SIM_ITERATIONS : COACH_QUICK_SIM_ITERATIONS;
}

export function computeEvPct(hitProbability: number, americanOdds: number): number {
  const decimal = americanToDecimal(americanOdds);
  return hitProbability * decimal - 1;
}

export function computeEdgePct(hitProbability: number, americanOdds: number): number {
  const implied = impliedProbabilityFromAmerican(americanOdds);
  return (hitProbability - implied) * 100;
}

export function buildPropSimRequest(candidate: CoachCandidateLeg): PropSimRequest | null {
  if (candidate.kind !== "player_prop" || candidate.propSide == null || candidate.line == null) {
    return null;
  }
  return {
    sport: String(candidate.sport),
    player: candidate.playerName ?? candidate.pick,
    market: candidate.marketKey,
    line: candidate.line,
    side: candidate.propSide,
    odds: candidate.odds,
    athleteId: candidate.playerId ?? null,
  };
}

export function normalizePropSimRow(
  legFingerprint: string,
  tier: CoachSimTier,
  row: PropSimApiRow,
  americanOdds: number,
): CoachSimResult | null {
  if (row.hitProbability == null || !Number.isFinite(row.hitProbability)) return null;
  const hit = row.hitProbability;
  const iterations = row.simulations ?? iterationsForTier(tier);
  return {
    legFingerprint,
    tier,
    iterations,
    hitProbability: hit,
    evPct: computeEvPct(hit, americanOdds) * 100,
    edgePct: computeEdgePct(hit, americanOdds),
    distributionSummary: {
      meanProjection: row.meanProjection ?? null,
      confidenceScore: row.confidenceScore ?? null,
    },
    computedAt: new Date().toISOString(),
  };
}

export function isDeepSimComplete(result: CoachSimResult): boolean {
  return result.tier === "deep" && result.iterations >= COACH_DEEP_SIM_ITERATIONS;
}
