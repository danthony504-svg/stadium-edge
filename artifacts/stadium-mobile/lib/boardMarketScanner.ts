// Full-board scan: sim every posted game-line rung + prop pool row, rank by EV/edge/grade, top N.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, GameMeta, OddsGame, PropPoolEntry, RealOddsEntry } from "./api.ts";
import { fetchFullBoardPropPool, fetchPropSimulations } from "./api.ts";
import { filterForExcludedSports } from "./chatContextPriority.ts";
import { fetchSlateGameSimulations, type GameTeamIds, type CoachGameSimEntry } from "./coachGameMonteCarlo.ts";
import {
  buildEvalLinesForAllGames,
  evaluateGameLines,
  mergeOddsEntries,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import { gameSimHitForPick } from "./gameSimScoring.ts";
import {
  deriveGameSimLineMetrics,
  simEvPct,
} from "./gameSimQualityGates.ts";
import {
  fullBoardScanShortfallNote,
  fullBoardScanSuccessNote,
} from "./fullBoardMarketCopy.ts";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { augmentEvalLinesWithPostedOdds } from "./postedGameLineMerge.ts";
import { buildFullEvalLinesForGame } from "./postedMarketDiscovery.ts";
import { selectCorrelationAwareBoardLegs } from "./parlayCorrelationScore.ts";
import { dedupeSameTeamGameLegs } from "./ticketDiversity.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import { marketConfidenceDelta } from "./marketWeighting.ts";
import { scoreLineShopping } from "./pickScore.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { MatchupHistoryEntry } from "./api.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "./simMarketSupport.ts";
import { pickIsAiRecommended } from "./pickRecommendation.ts";
import type { CalibrationBucket } from "./modelCalibration.ts";
import { calibrationDeltaForPick } from "./modelCalibration.ts";

const PROP_SIM_BATCH = 28;
const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type BoardScoredLeg = {
  pick: ParsedPick;
  evPct: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  impliedProbPct: number | null;
  lineShoppingScore: number | null;
  grade: string | null;
  simHit: number | null;
  composite: number | null;
  rankScore: number;
};

export type FullBoardScanResult = {
  picks: ParsedPick[];
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  note: string;
};

function unifiedRankScore(leg: Omit<BoardScoredLeg, "rankScore">): number {
  const ev = leg.evPct ?? 0;
  const edge = leg.edgePct ?? 0;
  const conf = leg.confidencePct ?? 0;
  const composite = leg.composite ?? 0;
  const sim = (leg.simHit ?? 0) * 100;
  const grade = gradeRank(leg.grade) * 4;
  const shop = (leg.lineShoppingScore ?? 0) * 1.2;
  return ev * 1.5 + edge * 3 + conf * 0.4 + composite * 0.5 + sim * 0.35 + grade + shop;
}

function lineShoppingFromPick(pick: ParsedPick, entry?: RealOddsEntry): number | null {
  const rubric = pick.finalAiScore?.rubricScores?.lineShopping ?? pick.scores?.lineShopping ?? null;
  if (rubric != null) return rubric;
  if (entry?.bookSpread != null) return scoreLineShopping(entry.bookSpread);
  return null;
}

function confidenceWithLearning(
  pick: ParsedPick,
  base: number | null | undefined,
  perfByFamily?: Map<string, MarketPerf>,
  calibration?: Map<string, CalibrationBucket>,
): number | null {
  if (base == null) return null;
  const delta =
    (perfByFamily ? marketConfidenceDelta(pick, perfByFamily) : 0) +
    calibrationDeltaForPick(pick, calibration, perfByFamily);
  if (!delta) return base;
  return Math.max(5, Math.min(95, Math.round(base + delta)));
}

function gameLineQualifies(row: EvaluatedGameLine, simHit: number | null): boolean {
  if (!pickHasSimGrade(row.pick, simHit)) return false;
  if (!pickIsAiRecommended(row.pick, row.finalAiScore)) return false;
  return true;
}

function propQualifies(pick: ParsedPick, simHit: number | null): boolean {
  if (!pickHasSimGrade(pick, simHit)) return false;
  if (!marketSupportsSimulation(pick.market ?? "", pick)) return false;
  return pickIsAiRecommended(pick, pick.finalAiScore ?? undefined);
}

function scoredFromEvalRow(
  row: EvaluatedGameLine,
  perfByFamily?: Map<string, MarketPerf>,
  simHit?: number | null,
  calibration?: Map<string, CalibrationBucket>,
): BoardScoredLeg | null {
  const hit = simHit ?? row.winProb ?? row.finalAiScore.simHit;
  if (!gameLineQualifies(row, hit)) return null;
  const m = deriveGameSimLineMetrics(row);
  const implied =
    row.pick.odds != null ? Math.round(impliedProb(row.pick.odds) * 1000) / 10 : null;
  const leg: Omit<BoardScoredLeg, "rankScore"> = {
    pick: {
      ...row.pick,
      finalAiScore: row.finalAiScore,
      highRiskValuePlay: row.finalAiScore.highRiskValuePlay,
    },
    evPct: m?.evPct ?? null,
    edgePct: row.edgePct ?? row.finalAiScore.edgePct,
    confidencePct: confidenceWithLearning(row.pick, row.finalAiScore.confidencePct, perfByFamily, calibration),
    impliedProbPct: implied,
    lineShoppingScore: lineShoppingFromPick(row.pick, row.entry),
    grade: row.finalAiScore.grade,
    simHit: hit,
    composite: row.finalAiScore.composite,
  };
  return { ...leg, rankScore: unifiedRankScore(leg) };
}

function scoredFromPropPick(
  pick: ParsedPick,
  simHit: number | null,
  perfByFamily?: Map<string, MarketPerf>,
  calibration?: Map<string, CalibrationBucket>,
): BoardScoredLeg | null {
  if (!propQualifies(pick, simHit)) return null;
  const ev =
    simHit != null && pick.odds != null ? simEvPct(simHit, pick.odds) : null;
  const implied =
    pick.odds != null ? Math.round(impliedProb(pick.odds) * 1000) / 10 : null;
  const leg: Omit<BoardScoredLeg, "rankScore"> = {
    pick,
    evPct: ev,
    edgePct: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null,
    confidencePct: confidenceWithLearning(
      pick,
      pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct,
      perfByFamily,
      calibration,
    ),
    impliedProbPct: implied,
    lineShoppingScore: lineShoppingFromPick(pick),
    grade: pick.finalAiScore?.grade ?? pick.scores?.grade ?? null,
    simHit,
    composite: pick.finalAiScore?.composite ?? pick.scores?.composite ?? null,
  };
  return { ...leg, rankScore: unifiedRankScore(leg) };
}

/** Greedy top-N by rank — correlation-aware when building multi-leg tickets. */
export function selectTopBoardLegs(ranked: BoardScoredLeg[], target: number): ParsedPick[] {
  if (target >= 3) {
    return dedupeSameTeamGameLegs(selectCorrelationAwareBoardLegs(ranked, target)).picks.slice(0, target);
  }
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  for (const row of ranked) {
    const fp = pickLegFingerprint(row.pick);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(row.pick);
    if (out.length >= target) break;
  }
  return dedupeSameTeamGameLegs(out).picks.slice(0, target);
}

async function simAllPropPoolRows(
  propPool: PropPoolEntry[],
  signal?: AbortSignal,
): Promise<Map<string, { hitProbability: number | null }>> {
  const hits = new Map<string, { hitProbability: number | null }>();
  const picks = propPool.map(parsedPickFromPoolEntry);
  for (let i = 0; i < picks.length; i += PROP_SIM_BATCH) {
    const batch = picks.slice(i, i + PROP_SIM_BATCH);
    try {
      const rows = await fetchPropSimulations(batch, propPool, { tier: "deep" }, signal);
      for (const [k, v] of rows) {
        hits.set(k, { hitProbability: v.hitProbability });
      }
    } catch {
      /* keep rubric-only scores for this batch */
    }
    if (signal?.aborted) break;
  }
  return hits;
}

export async function buildTopLegsFromFullBoardScan(opts: {
  target: number;
  oddsGames: OddsGame[];
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  liveOdds?: RealOddsEntry[];
  espnGames?: EspnGame[];
  gameMeta: GameMeta[];
  teamIdMap: Map<string, GameTeamIds>;
  excludedSports?: Set<string>;
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  playerHistory?: Record<string, PlayerHistorySlice>;
  perfByFamily?: Map<string, MarketPerf>;
  calibration?: Map<string, CalibrationBucket>;
  signal?: AbortSignal;
}): Promise<FullBoardScanResult> {
  const poolBase =
    opts.excludedSports?.size ? filterForExcludedSports(opts.propPool, opts.excludedSports) : opts.propPool;
  const oddsGames = opts.excludedSports?.size
    ? opts.oddsGames.filter((g) => !opts.excludedSports!.has(g.sport))
    : opts.oddsGames;

  const pool =
    opts.espnGames?.length
      ? await fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
      : poolBase;

  let evalLinesByGame = new Map<string, RealOddsEntry[]>();
  for (const og of oddsGames) {
    const label = `${og.awayTeam} @ ${og.homeTeam}`;
    const ladder = buildEvalLinesForAllGames([og]).get(label) ?? [];
    evalLinesByGame.set(label, buildFullEvalLinesForGame(og, ladder));
  }
  evalLinesByGame = augmentEvalLinesWithPostedOdds(evalLinesByGame, [
    ...opts.realOdds,
    ...(opts.liveOdds ?? []),
  ]);
  const gameSimulations = await fetchSlateGameSimulations(
    evalLinesByGame,
    opts.teamIdMap,
    opts.signal,
  );

  const mergedOdds = mergeOddsEntries(opts.realOdds, ...(opts.liveOdds ?? []), ...evalLinesByGame.values());
  const scored: BoardScoredLeg[] = [];
  let totalScanned = 0;

  for (const [game, lines] of evalLinesByGame) {
    const sim = gameSimulations.get(game);
    const evaluated = evaluateGameLines({
      lines,
      gameSim: sim,
      realOdds: mergedOdds,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
    });
    totalScanned += evaluated.length;
    for (const row of evaluated) {
      const simHit = gameSimHitForPick(row.pick, sim);
      const leg = scoredFromEvalRow(row, opts.perfByFamily, simHit, opts.calibration);
      if (leg) scored.push(leg);
    }
  }

  totalScanned += pool.length;
  const propHits = await simAllPropPoolRows(pool, opts.signal);

  const propPicks = attachPickScores(
    pool.map(parsedPickFromPoolEntry),
    {
      realOdds: mergedOdds,
      propPool: pool,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
      playerHistory: opts.playerHistory,
      propSimulations: propHits,
      perfByFamily: opts.perfByFamily,
    },
  );

  for (const pick of propPicks) {
    const simHit = pick.finalAiScore?.simHit ?? null;
    const leg = scoredFromPropPick(pick, simHit, opts.perfByFamily, opts.calibration);
    if (leg) scored.push(leg);
  }

  scored.sort((a, b) => b.rankScore - a.rankScore);
  const totalQualified = scored.length;
  const picks = selectTopBoardLegs(scored, opts.target);

  const note =
    picks.length >= opts.target
      ? fullBoardScanSuccessNote(totalScanned, picks.length)
      : fullBoardScanShortfallNote(totalScanned, totalQualified, picks.length);

  return {
    picks,
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    totalQualified,
    note,
  };
}

export function shouldUseFullBoardScan(
  legTarget: number,
  opts: {
    propsOnly?: boolean;
    explicitSingleGame?: boolean;
    oddsThreshold?: unknown;
    confidenceThreshold?: unknown;
    requestedLegs?: number;
  },
): boolean {
  if (opts.propsOnly || opts.explicitSingleGame || opts.oddsThreshold || opts.confidenceThreshold) {
    return false;
  }
  const asked = opts.requestedLegs ?? 0;
  return asked > 0 && legTarget >= 3;
}
