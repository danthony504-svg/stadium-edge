// Shared prop simulation fallback — when server Monte Carlo is empty, ground Sim
// Hit %, Likely Line, and Sim Confidence from real ESPN game logs (never fabricated).
// Used by the Game Simulator, Coach prop enrichment, and progressive sim loading.
import type { PropSimulationResult, RealPropEntry } from "./api";
import { computeAmbiguous, gameValueForMarket } from "./propStats";

export type SimHistorySlice = {
  labels?: string[];
  recent?: { stats?: Record<string, string> }[];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function simKey(
  player: string,
  market: string,
  line: number | null | undefined,
  side: string,
): string | null {
  if (line == null || !Number.isFinite(line)) return null;
  const s = side === "Under" ? "Under" : side === "Over" ? "Over" : null;
  if (!s) return null;
  return `${player}|${market}|${line}|${s}`;
}

function preferredPropSide(rp: RealPropEntry): "Over" | "Under" | null {
  if (rp.evSide === "Over" || rp.evSide === "Under") return rp.evSide;
  if (rp.over != null && rp.under == null) return "Over";
  if (rp.under != null && rp.over == null) return "Under";
  if (rp.over != null && rp.under != null) {
    return (rp.over ?? 0) >= (rp.under ?? 0) ? "Over" : "Under";
  }
  return null;
}

function sampleStd(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

export function coachHistoryToSimSlice(entry: unknown): SimHistorySlice | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { recent?: { stats?: Record<string, unknown> }[]; labels?: string[] };
  const recent = Array.isArray(e.recent)
    ? e.recent.map((g) => ({
        stats: (g.stats ?? {}) as Record<string, string>,
      }))
    : [];
  if (!recent.length) return null;
  return { labels: e.labels, recent };
}

export function findPlayerHistorySlice(
  player: string,
  athleteId: string | null | undefined,
  histories: Record<string, unknown>,
): SimHistorySlice | null {
  if (athleteId) {
    const direct = histories[`${player}#${athleteId}`];
    const slice = coachHistoryToSimSlice(direct);
    if (slice) return slice;
    const byId = Object.entries(histories).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    const fromId = coachHistoryToSimSlice(byId);
    if (fromId) return fromId;
  }
  const byName = Object.entries(histories).find(([k]) => k.startsWith(`${player}#`))?.[1];
  return coachHistoryToSimSlice(byName);
}

export type LocalSimResult = {
  hitProbability: number | null;
  sampleGames: number;
  mostLikelyLine: number | null;
  medianProjection: number | null;
  meanProjection: number | null;
  confidenceScore: number | null;
};

export function localPropSimulation(
  history: SimHistorySlice | null | undefined,
  args: {
    player: string;
    market: string;
    line: number;
    side: "Over" | "Under";
  },
): LocalSimResult | null {
  const recent = history?.recent ?? [];
  if (!recent.length) return null;
  const ambiguous = computeAmbiguous(history?.labels);
  const vals = recent
    .map((g) => gameValueForMarket(args.market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
  if (vals.length < 3) {
    return {
      hitProbability: null,
      sampleGames: vals.length,
      mostLikelyLine: null,
      medianProjection: null,
      meanProjection: null,
      confidenceScore: null,
    };
  }
  const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
  const hitProbability = hits / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = sampleStd(vals);

  let confidence = 50;
  if (vals.length >= 8) confidence += 14;
  else if (vals.length >= 5) confidence += 8;
  else confidence -= 6;
  const cv = mean > 0 ? std / mean : 1;
  if (cv < 0.22) confidence += 10;
  else if (cv < 0.38) confidence += 4;
  else confidence -= 4;
  confidence += Math.abs(hitProbability - 0.5) * 40;

  return {
    hitProbability,
    sampleGames: vals.length,
    mostLikelyLine: median,
    medianProjection: median,
    meanProjection: Math.round(mean * 100) / 100,
    confidenceScore: clamp(Math.round(confidence), 5, 95),
  };
}

function isServerSim(row: PropSimulationResult): boolean {
  return row.hitProbability != null && row.sampleGames >= 3 && row.simulations > 0;
}

function applyLocalToRow(
  r: PropSimulationResult,
  histories: Record<string, SimHistorySlice>,
): PropSimulationResult {
  if (isServerSim(r)) return r;
  const slice =
    Object.entries(histories).find(([k]) => k.startsWith(`${r.player}#`))?.[1] ??
    histories[r.player];
  const local = localPropSimulation(slice, {
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
    meanProjection: r.meanProjection ?? local.meanProjection,
    confidenceScore: r.confidenceScore ?? local.confidenceScore,
    simulations: r.simulations > 0 ? r.simulations : 0,
    tier: r.tier ?? "quick",
  };
}

/** Prefer server Monte Carlo rows; fill gaps from ESPN game logs. */
export function enrichPropSimResults(
  rows: PropSimulationResult[],
  histories: Record<string, SimHistorySlice>,
): PropSimulationResult[] {
  return rows.map((r) => applyLocalToRow(r, histories));
}

/** Merge server sim map with ESPN log fallback for coach / parlay selection. */
export function enrichSimMapWithLocalFallback(
  sims: Map<string, { hitProbability: number | null; confidenceScore?: number | null }>,
  props: Array<{
    player: string;
    market: string;
    line: number | null;
    side: "Over" | "Under";
    athleteId?: string | null;
  }>,
  playerHistory: Record<string, unknown>,
): Map<string, { hitProbability: number | null; confidenceScore?: number | null }> {
  const out = new Map(sims);
  for (const p of props) {
    if (p.line == null) continue;
    const key = simKey(p.player, p.market, p.line, p.side);
    if (!key) continue;
    const existing = out.get(key);
    if (existing?.hitProbability != null) continue;
    const slice = findPlayerHistorySlice(p.player, p.athleteId, playerHistory);
    const local = localPropSimulation(slice, {
      player: p.player,
      market: p.market,
      line: p.line,
      side: p.side,
    });
    if (local?.hitProbability != null) {
      out.set(key, {
        hitProbability: local.hitProbability,
        confidenceScore: local.confidenceScore,
      });
    }
  }
  return out;
}

export function realPropHasSimSupport(
  rp: RealPropEntry,
  sims: Map<string, { hitProbability: number | null }>,
): boolean {
  const side = preferredPropSide(rp);
  if (!side || rp.line == null) return false;
  const key = simKey(rp.player, rp.market, rp.line, side);
  if (!key) return false;
  const hit = sims.get(key)?.hitProbability;
  return hit != null && Number.isFinite(hit);
}

/** Parlay pool: keep only props with server OR game-log simulation backing. */
export function filterRealPropsWithSimSupport(
  realProps: RealPropEntry[],
  sims: Map<string, { hitProbability: number | null }>,
): RealPropEntry[] {
  return realProps.filter((rp) => realPropHasSimSupport(rp, sims));
}

/** When server returns real Monte Carlo, prefer it over prior game-log fallback. */
export function mergeServerOverLocal(
  localRows: PropSimulationResult[],
  serverRows: PropSimulationResult[],
): PropSimulationResult[] {
  const byKey = new Map(serverRows.map((r) => [r.key, r]));
  return localRows.map((r) => {
    const server = byKey.get(r.key);
    if (server && isServerSim(server)) return server;
    if (server?.hitProbability != null && r.hitProbability == null) return server;
    return r;
  });
}
