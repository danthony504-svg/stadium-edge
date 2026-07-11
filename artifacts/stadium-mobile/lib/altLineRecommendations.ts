// Sim-driven line recommendations for AI Coach pick cards.
// Every posted game-line rung (full game, periods, alts, team totals) and every
// prop alt ladder rung is scored on the same 10k draw; qualifying lines are
// labeled Safest / Best / Best Value / High Risk and ranked for display.

import type { ParsedPick, SimAltLine, SimAltTierLabel } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  evaluateGameLines,
  evalLinesForGame,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import {
  deriveGameSimLineMetrics,
  qualifiesCoachSimLineMetrics,
  simEdgeFromHit,
  simEvPct,
  type GameSimLineMetrics,
} from "./gameSimQualityGates.ts";
import {
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { gameAltPoolForPick, isPostablePoolLadderOdds, ladderTierForSiblingIndex } from "./altLinePool.ts";
export { gameAltPoolForPick, poolMatchesPickFamily, isMainLineGameLeg, isQualifyingBackupGameLine } from "./altLinePool.ts";
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
export const MAX_SIM_ALT_LINES = 12;

export type SimAltRecommendations = {
  safest: AltRungMetrics | null;
  best: AltRungMetrics | null;
  bestValue: AltRungMetrics | null;
  highRisk: AltRungMetrics | null;
  /** Every qualifying rung, labeled and sorted Safest → Best → Best Value → High Risk. */
  ranked: SimAltLine[];
};

const TIER_ORDER: SimAltTierLabel[] = ["Safest", "Best", "Best Value", "High Risk"];

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rungKey(r: Pick<AltRungMetrics, "market" | "pick" | "odds">): string {
  return `${r.market ?? ""}|${r.pick}|${r.odds}`.toLowerCase();
}

function overallScore(r: AltRungMetrics): number {
  if (r.composite != null && Number.isFinite(r.composite)) return r.composite;
  return r.winProb * 35 + r.edgePct * 2.5 + r.confidencePct * 0.25;
}

function qualifiesAltMetrics(m: GameSimLineMetrics): boolean {
  return qualifiesCoachSimLineMetrics(m);
}

/** Softer bar for surfacing alt chips — positive edge + EV with full metrics. */
function qualifiesDisplayAlt(m: GameSimLineMetrics): boolean {
  return m.edgePct > 0 && m.evPct > 0;
}

function isHighRiskStyle(r: AltRungMetrics): boolean {
  return r.winProb < 0.52 && r.edgePct >= 5 && r.evPct > 0;
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

function assignTierLabel(r: AltRungMetrics, champions: {
  safest: AltRungMetrics;
  best: AltRungMetrics;
  bestValue: AltRungMetrics;
  highRisk: AltRungMetrics;
}): SimAltTierLabel {
  const k = rungKey(r);
  if (rungKey(champions.safest) === k) return "Safest";
  if (rungKey(champions.best) === k) return "Best";
  if (rungKey(champions.bestValue) === k) return "Best Value";
  if (rungKey(champions.highRisk) === k) return "High Risk";
  if (r.winProb >= 0.58) return "Safest";
  if (isHighRiskStyle(r)) return "High Risk";
  if (r.evPct >= champions.bestValue.evPct * 0.85) return "Best Value";
  return "Best";
}

function pickChampions(rows: AltRungMetrics[]): {
  safest: AltRungMetrics;
  best: AltRungMetrics;
  bestValue: AltRungMetrics;
  highRisk: AltRungMetrics;
} {
  const safest = [...rows].sort((a, b) => b.winProb - a.winProb)[0]!;
  const best = [...rows].sort((a, b) => overallScore(b) - overallScore(a))[0]!;
  const bestValue = [...rows].sort((a, b) => b.evPct - a.evPct)[0]!;
  const highRiskCandidates = rows.filter(isHighRiskStyle);
  const highRisk =
    highRiskCandidates.length > 0
      ? [...highRiskCandidates].sort((a, b) => b.evPct - a.evPct)[0]!
      : [...rows].sort((a, b) => a.winProb - b.winProb || b.edgePct - a.edgePct)[0]!;
  return { safest, best, bestValue, highRisk };
}

function buildRankedSimAltLines(
  rows: AltRungMetrics[],
  excludeKey?: string,
): SimAltLine[] {
  if (!rows.length) return [];
  const champions = pickChampions(rows);
  const seen = new Set<string>();
  const lines: SimAltLine[] = [];

  for (const rung of rows) {
    const key = rungKey(rung);
    if (excludeKey && key === excludeKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      side: rung.side,
      line: rung.line,
      odds: rung.odds,
      pick: rung.pick,
      market: rung.market,
      tierLabel: assignTierLabel(rung, champions),
      simMetrics: {
        winProb: rung.winProb,
        edgePct: rung.edgePct,
        evPct: rung.evPct,
        confidencePct: rung.confidencePct,
        grade: rung.grade,
      },
    });
  }

  return lines
    .sort((a, b) => {
      const tierDiff = TIER_ORDER.indexOf(a.tierLabel) - TIER_ORDER.indexOf(b.tierLabel);
      if (tierDiff !== 0) return tierDiff;
      const aScore =
        (a.simMetrics?.winProb ?? 0) * 35 +
        (a.simMetrics?.edgePct ?? 0) * 2.5 +
        (a.simMetrics?.evPct ?? 0);
      const bScore =
        (b.simMetrics?.winProb ?? 0) * 35 +
        (b.simMetrics?.edgePct ?? 0) * 2.5 +
        (b.simMetrics?.evPct ?? 0);
      return bScore - aScore;
    })
    .slice(0, MAX_SIM_ALT_LINES);
}

function pickTiers(rows: AltRungMetrics[]): SimAltRecommendations {
  if (!rows.length) {
    return { safest: null, best: null, bestValue: null, highRisk: null, ranked: [] };
  }
  const champions = pickChampions(rows);
  const ranked = buildRankedSimAltLines(rows);
  return {
    safest: champions.safest,
    best: champions.best,
    bestValue: champions.bestValue,
    highRisk: champions.highRisk,
    ranked,
  };
}

function formatPropPick(player: string, side: string, line: number, marketLabel: string): string {
  const lineTxt = Number.isInteger(line) ? ` ${line}` : ` ${line}`;
  return `${player} ${side}${lineTxt} ${marketLabel}`;
}

/** Rank every qualifying alt game-line rung from the 10k-evaluated ladder. */
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
    return { safest: null, best: null, bestValue: null, highRisk: null, ranked: [] };
  }

  const pool = gameAltPoolForPick(pick, evalLines);
  if (!pool.length) return { safest: null, best: null, bestValue: null, highRisk: null, ranked: [] };

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

  const tiers = pickTiers(qualified);
  const onTicket = rungKey({
    market: pick.market,
    pick: pick.pick,
    odds: pick.odds,
  });
  tiers.ranked = buildRankedSimAltLines(qualified, onTicket);
  return tiers;
}

/** Rank every qualifying alt prop rung using lineHitRates from a 10k prop sim. */
export function recommendPropAltTiers(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
  sim: PropSimulationResult | null | undefined,
  finalAi?: FinalAiScore | null,
): SimAltRecommendations {
  if (!pick.isProp || !pick.player || !pick.propSide || sim?.lineHitRates == null) {
    return { safest: null, best: null, bestValue: null, highRisk: null, ranked: [] };
  }
  if ((sim.simulations ?? 0) < DEEP_SIM_COUNT) {
    return { safest: null, best: null, bestValue: null, highRisk: null, ranked: [] };
  }

  const side = pick.propSide === "Under" ? "Under" : "Over";
  const marketKey = pick.propMarketKey;
  const grade = finalAi?.grade ?? pick.finalAiScore?.grade ?? pick.scores?.grade ?? null;
  const baseConf = sim.confidenceScore ?? finalAi?.confidencePct ?? pick.scores?.confidencePct ?? 50;

  const rows: AltRungMetrics[] = [];
  const strictRows: AltRungMetrics[] = [];
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
    if (!metrics) continue;
    const pickStr = formatPropPick(pick.player, side, line, poolEntry.marketLabel);
    const row: AltRungMetrics = {
      side,
      line,
      odds: poolEntry.odds,
      pick: pickStr,
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
        pick: pickStr,
        winProb: hit,
        edgePct: metrics.edgePct,
        evPct: metrics.evPct,
        confidencePct: metrics.confidencePct,
        grade: metrics.grade,
      }),
    };
    if (qualifiesAltMetrics(metrics)) strictRows.push(row);
    rows.push(row);
  }

  const displayRows = rows;
  const tiers = pickTiers(displayRows);
  if (pick.propLine != null && pick.odds != null) {
    const onTicket = rungKey({
      market: pick.market,
      pick: pick.pick,
      odds: pick.odds,
    });
    tiers.ranked = buildRankedSimAltLines(rows, onTicket);
  }
  return tiers;
}

/** Posted prop ladder rungs on the card before deep sim returns (real pool lines only). */
export function attachPropPoolLadder(
  picks: ParsedPick[],
  propPool: PropPoolEntry[],
): ParsedPick[] {
  return picks.map((pick) => {
    if (!pick.isProp || !pick.player || pick.propLine == null || (pick.simAltLines?.length ?? 0) > 0) {
      return pick;
    }
    const side = pick.propSide === "Under" ? "Under" : "Over";
    const marketKey = pick.propMarketKey;
    const siblings = propPool
      .filter(
        (e) =>
          e.player === pick.player &&
          e.side === side &&
          e.line != null &&
          isPostablePoolLadderOdds(e.odds) &&
          (marketKey ? e.marketKey === marketKey : norm(e.marketLabel) === norm(pick.market)) &&
          (!pick.game || e.game === pick.game),
      )
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    if (siblings.length <= 1) return pick;
    const onLine = pick.propLine;
    const others = siblings.filter((e) => e.line !== onLine);
    if (!others.length) return pick;
    const cap = Math.min(others.length, MAX_SIM_ALT_LINES);
    const ranked = others.slice(0, MAX_SIM_ALT_LINES).map((e, i) => ({
      side: e.side,
      line: e.line!,
      odds: e.odds,
      pick: `${e.player} ${e.side} ${e.line} ${e.marketLabel}`,
      market: e.marketLabel,
      tierLabel: ladderTierForSiblingIndex(i, cap),
    }));
    return { ...pick, simAltLines: ranked, altOptions: undefined };
  });
}

/** Swap a prop leg to the best strict qualifying alt rung from 10k sim. */
export function optimizePropPickToBestAlt(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
  sim: PropSimulationResult,
): ParsedPick {
  if (!pick.isProp || !pick.player || !pick.propSide) return pick;
  const tiers = recommendPropAltTiers(pick, propPool, sim, pick.finalAiScore);
  const strict = collectStrictPropAltRows(pick, propPool, sim, pick.finalAiScore);
  const best = bestQualifyingAltRung(strict);
  if (!best) return pick;
  const onTicket = rungKey({ market: pick.market, pick: pick.pick, odds: pick.odds });
  if (rungKey({ market: best.market, pick: best.pick, odds: best.odds }) === onTicket) {
    return tiers.ranked.length ? { ...pick, simAltLines: tiers.ranked, altOptions: undefined } : pick;
  }
  return {
    ...pick,
    pick: best.pick,
    odds: best.odds,
    propLine: best.line,
    market: best.market ?? pick.market,
    simAltLines: tiers.ranked,
    altOptions: undefined,
  };
}

function collectStrictPropAltRows(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
  sim: PropSimulationResult,
  finalAi?: FinalAiScore | null,
): AltRungMetrics[] {
  if (!pick.isProp || !pick.player || !pick.propSide || sim?.lineHitRates == null) return [];
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
    const pickStr = formatPropPick(pick.player, side, line, poolEntry.marketLabel);
    rows.push({
      side,
      line,
      odds: poolEntry.odds,
      pick: pickStr,
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
        pick: pickStr,
        winProb: hit,
        edgePct: metrics.edgePct,
        evPct: metrics.evPct,
        confidencePct: metrics.confidencePct,
        grade: metrics.grade,
      }),
    });
  }
  return rows;
}

/** Attach 10k prop alt tiers after deep sim — does not require game-line sim. */
export function attachPropSimAltLines(
  picks: ParsedPick[],
  propPool: PropPoolEntry[],
  propSims: Map<string, PropSimulationResult>,
  opts: { swapToBestAlt?: boolean } = {},
): ParsedPick[] {
  return picks.map((pick) => {
    if (!pick.isProp || !pick.player || pick.propLine == null) return pick;
    const sim = findPropSimResult(pick, propSims);
    if (!sim || (sim.simulations ?? 0) < DEEP_SIM_COUNT) return pick;
    if (opts.swapToBestAlt) {
      return optimizePropPickToBestAlt(pick, propPool, sim);
    }
    const tiers = recommendPropAltTiers(pick, propPool, sim, pick.finalAiScore);
    if (!tiers.ranked.length) return pick;
    return { ...pick, simAltLines: tiers.ranked, altOptions: undefined };
  });
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
    requireDeepPropSim?: boolean;
  },
): ParsedPick[] {
  return picks.map((pick) => {
    let tiers: SimAltRecommendations = {
      safest: null,
      best: null,
      bestValue: null,
      highRisk: null,
      ranked: [],
    };
    let evaluated = false;

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
      if ((sim?.simulations ?? 0) >= DEEP_SIM_COUNT) {
        evaluated = true;
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
      if (!sim || (sim.simulations ?? 0) < DEEP_SIM_COUNT) {
        return pick;
      }
      evaluated = true;
      tiers = recommendPropAltTiers(pick, opts.propPool, sim, pick.finalAiScore);
    }

    if (!tiers.ranked.length) {
      return pick;
    }

    return { ...pick, simAltLines: tiers.ranked, altOptions: undefined };
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
    if (e.line == null || e.line === pick.propLine) continue;
    lines.add(e.line);
  }
  return [...lines].sort((a, b) => a - b);
}

/** Best qualifying alt rung for ticket optimization (highest composite score). */
export function bestQualifyingAltRung(rows: AltRungMetrics[]): AltRungMetrics | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => overallScore(b) - overallScore(a))[0]!;
}
