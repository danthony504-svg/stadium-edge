// Sim-driven alternate-line recommendations for AI Coach pick cards.
// Every posted alt rung is scored against the same 10k draw; only lines that
// pass quality filters (positive EV, edge, confidence floor) are surfaced.

import type { ParsedPick, SimAltLine, SimAltTierLabel } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry } from "./api.ts";
import { impliedProb } from "./format.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  evaluateGameLines,
  evalLinesForGame,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  deriveGameSimLineMetrics,
  simEdgeFromHit,
  simEvPct,
  type GameSimLineMetrics,
} from "./gameSimQualityGates.ts";
import {
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { MatchupHistoryEntry } from "./api.ts";
import type { PropSimulationResult } from "./api.ts";

export type AltRungMetrics = {
  side: string;
  line: number;
  odds: number;
  pick: string;
  market?: string;
  winProb: number;
  edgePct: number;
  evPct: number;
  confidencePct: number;
  grade: string;
  composite?: number | null;
};

export const DEEP_SIM_COUNT = 10_000;

export type SimAltRecommendations = {
  safest: AltRungMetrics | null;
  bestValue: AltRungMetrics | null;
  highestConfidence: AltRungMetrics | null;
  bestOverall: AltRungMetrics | null;
};

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

function isAltGameMarket(market: string): boolean {
  return /\balt\b/i.test(market);
}

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  return nick(a).length > 2 && nick(a) === nick(b);
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function sameSideAsPick(entry: RealOddsEntry, pick: ParsedPick): boolean {
  const ep = entry.pick;
  const pp = pick.pick;
  if (/\bover\b/i.test(pp)) return /\bover\b/i.test(ep);
  if (/\bunder\b/i.test(pp)) return /\bunder\b/i.test(ep);
  const pt = pickTeamName(pp);
  const et = pickTeamName(ep);
  if (pt && et) return teamsMatch(pt, et);
  return norm(ep) === norm(pp);
}

function qualifiesAltMetrics(m: GameSimLineMetrics): boolean {
  if (m.evPct <= 0) return false;
  if (m.edgePct <= 0) return false;
  if (m.confidencePct < COACH_SIM_MIN_CONFIDENCE) return false;
  if (gradeRank(m.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  const implied = impliedProb(m.bookOdds);
  if (m.simHit <= implied) return false;
  return true;
}

function findPropSimResult(
  pick: ParsedPick,
  sims: Map<string, PropSimulationResult> | undefined,
): PropSimulationResult | undefined {
  if (!sims?.size || !pick.player || pick.propLine == null) return undefined;
  const side = pick.propSide === "Under" ? "Under" : "Over";
  for (const sim of sims.values()) {
    if (sim.player !== pick.player || sim.line !== pick.propLine || sim.side !== side) continue;
    if (pick.propMarketKey && sim.market !== pick.propMarketKey) continue;
    return sim;
  }
  return undefined;
}

function propMetricsFromSim(
  hit: number,
  odds: number,
  confidence: number,
  grade: string | null,
): GameSimLineMetrics | null {
  const edgePct = simEdgeFromHit(hit, odds);
  const evPct = simEvPct(hit, odds);
  if (edgePct == null || evPct == null || !grade) return null;
  return {
    simHit: hit,
    fairOdds: 0,
    bookOdds: odds,
    evPct,
    edgePct,
    grade,
    confidencePct: confidence,
  };
}

function evaluatedToAltRung(row: EvaluatedGameLine): AltRungMetrics | null {
  const m = deriveGameSimLineMetrics(row);
  if (!m || !qualifiesAltMetrics(m)) return null;
  const lineMatch = row.entry.pick.match(/[+-]?\d+(?:\.\d+)?/);
  return {
    side: row.entry.pick,
    line: lineMatch ? parseFloat(lineMatch[0]) : 0,
    odds: row.entry.odds,
    pick: row.entry.pick,
    market: row.entry.market,
    winProb: m.simHit,
    edgePct: m.edgePct,
    evPct: m.evPct,
    confidencePct: m.confidencePct,
    grade: m.grade,
    composite: row.finalAiScore.composite ?? null,
  };
}

function overallScore(r: AltRungMetrics): number {
  if (r.composite != null && Number.isFinite(r.composite)) return r.composite;
  return r.winProb * 35 + r.edgePct * 2.5 + r.confidencePct * 0.25;
}

function pickTiers(rows: AltRungMetrics[]): SimAltRecommendations {
  if (!rows.length) {
    return { safest: null, bestValue: null, highestConfidence: null, bestOverall: null };
  }
  const safest = [...rows].sort((a, b) => b.winProb - a.winProb)[0]!;
  const bestValue = [...rows].sort((a, b) => b.evPct - a.evPct)[0]!;
  const highestConfidence = [...rows].sort((a, b) => b.confidencePct - a.confidencePct)[0]!;
  const bestOverall = [...rows].sort((a, b) => overallScore(b) - overallScore(a))[0]!;
  return { safest, bestValue, highestConfidence, bestOverall };
}

const TIER_ORDER: SimAltTierLabel[] = [
  "Best Overall",
  "Safest",
  "Best Value",
  "High Confidence",
];

function buildLabeledSimAltLines(tiers: SimAltRecommendations): SimAltLine[] {
  const entries: Array<{ label: SimAltTierLabel; rung: AltRungMetrics | null }> = [
    { label: "Best Overall", rung: tiers.bestOverall },
    { label: "Safest", rung: tiers.safest },
    { label: "Best Value", rung: tiers.bestValue },
    { label: "High Confidence", rung: tiers.highestConfidence },
  ];
  const seen = new Set<string>();
  const lines: SimAltLine[] = [];
  for (const { label, rung } of entries) {
    if (!rung) continue;
    const key = `${rung.market ?? ""}|${rung.pick}|${rung.odds}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      side: rung.side,
      line: rung.line,
      odds: rung.odds,
      pick: rung.pick,
      market: rung.market,
      tierLabel: label,
      simMetrics: {
        winProb: rung.winProb,
        edgePct: rung.edgePct,
        evPct: rung.evPct,
        confidencePct: rung.confidencePct,
        grade: rung.grade,
      },
    });
  }
  return lines.sort(
    (a, b) => TIER_ORDER.indexOf(a.tierLabel) - TIER_ORDER.indexOf(b.tierLabel),
  );
}

/** Rank alt game-line rungs from a 10k-evaluated ladder. */
export function recommendGameAltTiers(
  pick: ParsedPick,
  evalLines: RealOddsEntry[],
  sim: CoachGameSimEntry | null | undefined,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
  },
): SimAltRecommendations {
  if (!isGameLinePick(pick) || pick.isProp || !sim) {
    return { safest: null, bestValue: null, highestConfidence: null, bestOverall: null };
  }

  const pool = evalLines.filter(
    (e) =>
      e.game === pick.game &&
      isAltGameMarket(e.market) &&
      sameSideAsPick(e, pick) &&
      !(e.market === pick.market && e.pick === pick.pick && e.odds === pick.odds),
  );
  if (!pool.length) return { safest: null, bestValue: null, highestConfidence: null, bestOverall: null };

  const ranked = evaluateGameLines({
    lines: pool,
    gameSim: sim,
    realOdds: opts.realOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
  });

  const qualified = ranked
    .map(evaluatedToAltRung)
    .filter((r): r is AltRungMetrics => r != null);

  return pickTiers(qualified);
}

/** Rank alt prop rungs using lineHitRates from a 10k prop sim. */
export function recommendPropAltTiers(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
  sim: PropSimulationResult | null | undefined,
  finalAi?: FinalAiScore | null,
): SimAltRecommendations {
  if (!pick.isProp || !pick.player || !pick.propSide || sim?.lineHitRates == null) {
    return { safest: null, bestValue: null, highestConfidence: null, bestOverall: null };
  }
  if ((sim.simulations ?? 0) < DEEP_SIM_COUNT) {
    return { safest: null, bestValue: null, highestConfidence: null, bestOverall: null };
  }

  const side = pick.propSide === "Under" ? "Under" : "Over";
  const marketKey = pick.propMarketKey;
  const grade = finalAi?.grade ?? pick.finalAiScore?.grade ?? pick.scores?.grade ?? null;
  const baseConf = sim.confidenceScore ?? finalAi?.confidencePct ?? pick.scores?.confidencePct ?? 50;

  const rows: AltRungMetrics[] = [];
  for (const [lineStr, hit] of Object.entries(sim.lineHitRates)) {
    const line = parseFloat(lineStr);
    if (!Number.isFinite(line) || hit == null || !Number.isFinite(hit)) continue;
    const poolEntry = propPool.find(
      (e) =>
        e.player === pick.player &&
        e.side === side &&
        e.line === line &&
        (marketKey ? e.marketKey === marketKey : true) &&
        (pick.game ? e.game === pick.game : true),
    );
    if (!poolEntry || poolEntry.odds == null) continue;
    const metrics = propMetricsFromSim(hit, poolEntry.odds, baseConf, grade);
    if (!metrics || !qualifiesAltMetrics(metrics)) continue;
    rows.push({
      side,
      line,
      odds: poolEntry.odds,
      pick: `${pick.player} ${side} ${line}`,
      market: poolEntry.marketLabel,
      winProb: hit,
      edgePct: metrics.edgePct,
      evPct: metrics.evPct,
      confidencePct: metrics.confidencePct,
      grade: metrics.grade,
      composite: overallScore({
        side,
        line,
        odds: poolEntry.odds,
        pick: `${pick.player} ${side} ${line}`,
        winProb: hit,
        edgePct: metrics.edgePct,
        evPct: metrics.evPct,
        confidencePct: metrics.confidencePct,
        grade: metrics.grade,
      }),
    });
  }

  return pickTiers(rows);
}

/** Replace heuristic alts with 10k-sim labeled alt lines on each pick card. */
export function attachSimAltOptionsToPicks(
  picks: ParsedPick[],
  opts: {
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    realOdds: RealOddsEntry[];
    propPool: PropPoolEntry[];
    propSimulations?: Map<string, PropSimulationResult>;
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    /** When true, prop alts require a completed 10k sim (deep tier). */
    requireDeepPropSim?: boolean;
  },
): ParsedPick[] {
  return picks.map((pick) => {
    let tiers: SimAltRecommendations = {
      safest: null,
      bestValue: null,
      highestConfidence: null,
      bestOverall: null,
    };

    if (isGameLinePick(pick) && !pick.isProp) {
      const evalLines = evalLinesForGame(pick.game, opts.evalLinesByGame);
      let sim = opts.gameSimulations.get(pick.game);
      if (!sim) {
        for (const [k, v] of opts.gameSimulations) {
          if (norm(k) === norm(pick.game)) {
            sim = v;
            break;
          }
        }
      }
      if ((sim?.simulations ?? DEEP_SIM_COUNT) >= DEEP_SIM_COUNT) {
        tiers = recommendGameAltTiers(pick, evalLines, sim, {
          realOdds: opts.realOdds,
          matchupHistory: opts.matchupHistory,
          matchupInjuries: opts.matchupInjuries,
        });
      }
    } else if (pick.isProp && pick.player && pick.propLine != null) {
      if (!opts.requireDeepPropSim) {
        return pick;
      }
      const sim = findPropSimResult(pick, opts.propSimulations);
      tiers = recommendPropAltTiers(pick, opts.propPool, sim, pick.finalAiScore);
    }

    const simAltLines = buildLabeledSimAltLines(tiers);
    if (!simAltLines.length) {
      return pick;
    }

    return { ...pick, simAltLines, altOptions: undefined };
  });
}

/** Collect alt prop line numbers for a 10k sim batch request. */
export function altLinesForPropPick(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
): number[] {
  if (!pick.isProp || !pick.player || pick.propLine == null) return [];
  const side = pick.propSide === "Under" ? "Under" : "Over";
  const lines = new Set<number>();
  for (const e of propPool) {
    if (e.player !== pick.player || e.side !== side) continue;
    if (pick.propMarketKey && e.marketKey !== pick.propMarketKey) continue;
    if (pick.game && e.game !== pick.game) continue;
    if (e.line == null || e.line === pick.propLine || !e.alt) continue;
    lines.add(e.line);
  }
  return [...lines].sort((a, b) => a - b);
}
