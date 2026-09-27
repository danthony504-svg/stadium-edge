// Client-side prop hit-rate fallback when the simulate API can't ground Monte Carlo
// (stale deploy, missing athleteId, etc.). Uses the same real ESPN game-log mapping
// as propGrade — never fabricates numbers.
import type { PropSimulationResult } from "./api";
import { computeAmbiguous, gameValueForMarket } from "./propStats";
import { PROPS_ONLY_MIN_SAMPLE } from "./coachFootballPropsOnlyGrade.ts";

export type LocalHistorySlice = {
  labels?: string[];
  recent?: { stats?: Record<string, string> }[];
};

/** Align with props-only grading — early-season 2-game logs must still fill the prop card. */
export const LOCAL_PROP_SIM_MIN_SAMPLE = PROPS_ONLY_MIN_SAMPLE;

export function localPropSimulation(
  history: LocalHistorySlice | null | undefined,
  args: {
    player: string;
    market: string;
    line: number;
    side: "Over" | "Under";
  },
): Pick<
  PropSimulationResult,
  "hitProbability" | "sampleGames" | "mostLikelyLine" | "medianProjection" | "confidenceScore"
> | null {
  const recent = history?.recent ?? [];
  if (!recent.length) return null;
  const ambiguous = computeAmbiguous(history?.labels);
  const vals = recent
    .map((g) => gameValueForMarket(args.market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
  // Phone: Pat Bryant SAMPLE=2 left SIM HIT / PROJECTED STAT / SIM CONF as "—"
  // because this gate used to require 3 while Coach props-only grades at 2.
  if (vals.length < LOCAL_PROP_SIM_MIN_SAMPLE) {
    return {
      hitProbability: null,
      sampleGames: vals.length,
      mostLikelyLine: null,
      medianProjection: null,
      confidenceScore: null,
    };
  }
  const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? null;
  const hitProbRaw = hits / vals.length;
  // Soft-clip exact 0/1 so binary markets (Anytime TD) remain gradeable after
  // sanitizeSimHitForGrade — short samples of "never scored" used to wipe every TD.
  const hitProb = hitProbRaw <= 0 ? 0.02 : hitProbRaw >= 1 ? 0.98 : hitProbRaw;
  let confidence = 50;
  if (vals.length >= 8) confidence += 14;
  else if (vals.length >= 5) confidence += 8;
  else confidence -= 6;
  confidence += Math.abs(hitProb - 0.5) * 40;
  const confidenceScore = Math.max(5, Math.min(95, Math.round(confidence)));
  return {
    hitProbability: hitProb,
    sampleGames: vals.length,
    mostLikelyLine: median,
    medianProjection: median,
    confidenceScore,
  };
}

/** Merge server MC with local history fallback (prop detail + simulator). */
export function mergePropSimWithLocal(
  server: PropSimulationResult | null | undefined,
  local: ReturnType<typeof localPropSimulation>,
): PropSimulationResult | null {
  if (!server && !local) return null;
  if (!local || local.hitProbability == null) return server ?? null;
  if (!server) {
    return {
      player: "",
      market: "",
      line: 0,
      side: "Over",
      simulations: 0,
      hitProbability: local.hitProbability,
      mostLikelyLine: local.mostLikelyLine,
      meanProjection: local.medianProjection,
      medianProjection: local.medianProjection,
      confidenceScore: local.confidenceScore,
      stdDev: null,
      sampleGames: local.sampleGames,
      percentiles: null,
      nullReason: null,
      tier: "quick",
    };
  }
  if (server.hitProbability != null && server.sampleGames >= LOCAL_PROP_SIM_MIN_SAMPLE) {
    return {
      ...server,
      mostLikelyLine: server.mostLikelyLine ?? local.mostLikelyLine,
      medianProjection: server.medianProjection ?? local.medianProjection,
      confidenceScore: server.confidenceScore ?? local.confidenceScore,
    };
  }
  return {
    ...server,
    hitProbability: server.hitProbability ?? local.hitProbability,
    sampleGames: Math.max(server.sampleGames, local.sampleGames),
    mostLikelyLine: server.mostLikelyLine ?? local.mostLikelyLine,
    medianProjection: server.medianProjection ?? local.medianProjection,
    meanProjection: server.meanProjection ?? local.medianProjection,
    confidenceScore: server.confidenceScore ?? local.confidenceScore,
    nullReason: server.hitProbability != null ? server.nullReason : null,
  };
}

export function enrichPropSimResults(
  rows: PropSimulationResult[],
  histories: Record<string, LocalHistorySlice>,
): PropSimulationResult[] {
  return rows.map((r) => {
    if (r.hitProbability != null && r.sampleGames >= LOCAL_PROP_SIM_MIN_SAMPLE) return r;
    const hist =
      Object.entries(histories).find(([k]) => k.startsWith(`${r.player}#`))?.[1] ??
      histories[r.player];
    const local = localPropSimulation(hist, {
      player: r.player,
      market: r.market,
      line: r.line,
      side: r.side,
    });
    if (!local || local.hitProbability == null) return r;
    return {
      ...r,
      hitProbability: local.hitProbability,
      sampleGames: Math.max(r.sampleGames, local.sampleGames),
      mostLikelyLine: r.mostLikelyLine ?? local.mostLikelyLine,
      medianProjection: r.medianProjection ?? local.medianProjection,
      confidenceScore: r.confidenceScore ?? local.confidenceScore,
      tier: r.tier ?? "quick",
    };
  });
}
