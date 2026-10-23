// Client-side prop hit-rate fallback when the simulate API can't ground Monte Carlo
// (stale deploy, missing athleteId, etc.). Uses the same real ESPN game-log mapping
// as propGrade — never fabricates numbers.
import type { PropSimulationResult } from "./api.ts";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
import { PROPS_ONLY_MIN_SAMPLE } from "./coachFootballPropsOnlyGrade.ts";
import {
  isRareCountPropMarket,
  rareCountHitFromValues,
} from "./rareCountPropModel.ts";
import {
  anytimeTdHitFromValues,
  isAnytimeTdPropMarket,
} from "./anytimeTdPropModel.ts";

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
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? null;

  let hitProb: number | null;
  let tdReliability: number | null = null;
  if (/^player_(?:double|triple)_double(?:_alternate)?$/.test(args.market)) {
    // Match the server's evidence policy; local fallback must not recreate a prior.
    if (vals.length < 10 || vals.some(v => v !== 0 && v !== 1) || !vals.includes(0) || !vals.includes(1)) return { hitProbability:null, sampleGames:vals.length, mostLikelyLine:null, medianProjection:null, confidenceScore:null };
    const rate = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const yes = 0.4 * rate(vals.slice(0, 5)) + 0.3 * rate(vals.slice(0, 10)) + 0.3 * rate(vals);
    hitProb = args.side === "Under" ? 1 - yes : yes;
  } else if (isRareCountPropMarket(args.market)) {
    // Threshold-aware Poisson — 0/N does not become a fake 2% floor.
    hitProb = rareCountHitFromValues(vals, args.line, args.side);
  } else if (isAnytimeTdPropMarket(args.market)) {
    // P(at least one TD) via binary scoring frequency + shrinkage — no 2% floor.
    const td = anytimeTdHitFromValues(vals, args.side);
    hitProb = td.hit;
    tdReliability = td.reliability;
  } else {
    const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
    const hitProbRaw = hits / vals.length;
    // Soft-clip exact 0/1 so other binary markets remain gradeable after sanitize.
    hitProb = hitProbRaw <= 0 ? 0.02 : hitProbRaw >= 1 ? 0.98 : hitProbRaw;
  }

  let confidence = 50;
  if (vals.length >= 8) confidence += 14;
  else if (vals.length >= 5) confidence += 8;
  else confidence -= 6;
  if (tdReliability != null) {
    // Thin TD logs must not mint high confidence from a shrunk prior alone.
    confidence = Math.round(40 + tdReliability * 45);
  } else if (hitProb != null) {
    confidence += Math.abs(hitProb - 0.5) * 40;
  } else {
    confidence -= 20;
  }
  const confidenceScore = Math.max(5, Math.min(95, Math.round(confidence)));
  return {
    hitProbability: hitProb,
    sampleGames: vals.length,
    mostLikelyLine: median,
    medianProjection: median,
    confidenceScore,
  };
}

function withheldServer(server: PropSimulationResult): PropSimulationResult {
  return { ...server, simulations:0, cached:false, hitProbability:null, mostLikelyLine:null, meanProjection:null, medianProjection:null, confidenceScore:null, stdDev:null, percentiles:null, nullReason:server.nullReason || "insufficient_sample" };
}
/** Merge server MC with local history fallback (prop detail + simulator). */
export function mergePropSimWithLocal(
  server: PropSimulationResult | null | undefined,
  local: ReturnType<typeof localPropSimulation>,
): PropSimulationResult | null {
  if (!server && !local) return null;
  const milestone = /^player_(?:double|triple)_double(?:_alternate)?$/.test(server?.market ?? "");
  if (!local || local.hitProbability == null) {
    if (server && milestone && server.sampleGames < 10) return withheldServer(server);
    return server ? (server.hitProbability == null ? withheldServer(server) : server) : null;
  }
  if (!server) {
    return {
      key: "local-history-fallback",
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
  if (server.hitProbability != null && server.sampleGames >= (milestone ? 10 : LOCAL_PROP_SIM_MIN_SAMPLE)) {
    return server;
  }
  return {
    ...server,
    simulations: 0,
    tier: "quick",
    cached: false,
    hitProbability: local.hitProbability,
    sampleGames: local.sampleGames,
    mostLikelyLine: local.mostLikelyLine,
    medianProjection: local.medianProjection,
    meanProjection: local.medianProjection,
    confidenceScore: local.confidenceScore,
    stdDev: null,
    percentiles: null,
    nullReason: server.hitProbability != null ? server.nullReason : null,
  };
}

export function enrichPropSimResults(
  rows: PropSimulationResult[],
  histories: Record<string, LocalHistorySlice>,
): PropSimulationResult[] {
  return rows.map(r => {
    const hist = Object.entries(histories).find(([k]) => k.startsWith(`${r.player}#`))?.[1] ?? histories[r.player];
    return mergePropSimWithLocal(r, localPropSimulation(hist, { player:r.player, market:r.market, line:r.line, side:r.side })) ?? r;
  });
}
