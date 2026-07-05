// Client-side prop hit-rate fallback when the simulate API can't ground Monte Carlo
// (stale deploy, missing athleteId, etc.). Uses the same real ESPN game-log mapping
// as propGrade — never fabricates numbers.
import type { PropSimulationResult } from "./api";
import { computeAmbiguous, gameValueForMarket } from "./propStats";

export type LocalHistorySlice = {
  labels?: string[];
  recent?: { stats?: Record<string, string> }[];
};

export function localPropSimulation(
  history: LocalHistorySlice | null | undefined,
  args: {
    player: string;
    market: string;
    line: number;
    side: "Over" | "Under";
  },
): Pick<PropSimulationResult, "hitProbability" | "sampleGames" | "mostLikelyLine" | "medianProjection"> | null {
  const recent = history?.recent ?? [];
  if (!recent.length) return null;
  const ambiguous = computeAmbiguous(history?.labels);
  const vals = recent
    .map((g) => gameValueForMarket(args.market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
  if (vals.length < 3) {
    return { hitProbability: null, sampleGames: vals.length, mostLikelyLine: null, medianProjection: null };
  }
  const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? null;
  return {
    hitProbability: hits / vals.length,
    sampleGames: vals.length,
    mostLikelyLine: median,
    medianProjection: median,
  };
}

export function enrichPropSimResults(
  rows: PropSimulationResult[],
  histories: Record<string, LocalHistorySlice>,
): PropSimulationResult[] {
  return rows.map((r) => {
    if (r.hitProbability != null && r.sampleGames >= 3) return r;
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
      tier: r.tier ?? "quick",
    };
  });
}
