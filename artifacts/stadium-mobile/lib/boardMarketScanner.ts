// Full-board scan: sim every posted game-line rung + prop pool row, rank by EV/edge/grade, top N.
// Scan policy: coachScanPolicy.ts — AI Recommended picks only, never filler.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, GameMeta, OddsGame, PropPoolEntry, RealOddsEntry } from "./api.ts";
import { fetchFullBoardPropPool, fetchPropSimulations } from "./api.ts";
import { filterBettableOddsGames, filterBettablePropPool } from "./slate.ts";
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
  type TicketStagingBreakdown,
} from "./fullBoardMarketCopy.ts";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import { augmentEvalLinesWithPostedOdds } from "./postedGameLineMerge.ts";
import { buildFullEvalLinesForGame } from "./postedMarketDiscovery.ts";
import { collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import { marketConfidenceDelta } from "./marketWeighting.ts";
import { scoreLineShopping } from "./pickScore.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { MatchupHistoryEntry } from "./api.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "./simMarketSupport.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  buildStagedTicketFromScan,
  selectGreedyBoardLegs,
  selectTopBoardLegs,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
export { buildStagedTicketFromScan, selectTopBoardLegs, tagTicketRoles, type BoardScoredLeg } from "./ticketStaging.ts";
import type { CalibrationBucket } from "./modelCalibration.ts";
import { calibrationDeltaForPick } from "./modelCalibration.ts";

import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
} from "./boardPropSimExpansion.ts";
export {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
} from "./boardPropSimExpansion.ts";

const PROP_SIM_BATCH_TIMEOUT_MS = 20_000;
const MIN_PROP_POOL_FOR_SKIP_FETCH = 80;

function propSimKeyForPick(pick: ParsedPick): string | null {
  if (!pick.isProp || !pick.player || pick.propLine == null || !pick.propSide) return null;
  return `${pick.player}|${pick.propMarketKey ?? pick.market}|${pick.propLine}|${pick.propSide}`;
}

function propPickHasSimHit(
  pick: ParsedPick,
  hits: Map<string, { hitProbability: number | null }>,
): boolean {
  const key = propSimKeyForPick(pick);
  return key != null && hits.has(key);
}
const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";

export type FullBoardScanResult = {
  picks: ParsedPick[];
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  staging: TicketStagingBreakdown;
  note: string;
  /** False for in-flight partial flashes; true when the scan finished or exhausted the board. */
  scanComplete?: boolean;
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

function gameLineHasSimGrade(row: EvaluatedGameLine, simHit: number | null): boolean {
  return pickHasSimGrade(row.pick, simHit);
}

function propHasSimGrade(pick: ParsedPick, simHit: number | null): boolean {
  if (!pickHasSimGrade(pick, simHit)) return false;
  return marketSupportsSimulation(pick.market ?? "", pick);
}

function scoredFromEvalRow(
  row: EvaluatedGameLine,
  perfByFamily?: Map<string, MarketPerf>,
  simHit?: number | null,
  calibration?: Map<string, CalibrationBucket>,
): BoardScoredLeg | null {
  const hit = simHit ?? row.winProb ?? row.finalAiScore.simHit;
  if (!gameLineHasSimGrade(row, hit)) return null;
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
  if (!propHasSimGrade(pick, simHit)) return null;
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

async function simPropBatch(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  signal?: AbortSignal,
): Promise<Map<string, { hitProbability: number | null }>> {
  const out = new Map<string, { hitProbability: number | null }>();
  if (!batch.length) return out;
  try {
    const rows = await Promise.race([
      fetchPropSimulations(batch, pool, { tier: "quick" }, signal),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("prop-sim-batch-timeout")), PROP_SIM_BATCH_TIMEOUT_MS),
      ),
    ]);
    for (const [k, v] of rows) {
      out.set(k, { hitProbability: v.hitProbability });
    }
  } catch {
    /* rubric-only for this batch */
  }
  return out;
}

function appendPropScoredLegs(
  rankedProps: ParsedPick[],
  propHits: Map<string, { hitProbability: number | null }>,
  propScored: BoardScoredLeg[],
  seenFp: Set<string>,
  opts: {
    pool: PropPoolEntry[];
    mergedOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    playerHistory?: Record<string, PlayerHistorySlice>;
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
  },
): void {
  const pending = rankedProps.filter((p) => {
    if (!propPickHasSimHit(p, propHits)) return false;
    return !seenFp.has(pickLegFingerprint(p));
  });
  if (!pending.length) return;

  const scoredPicks = attachPickScores(pending, {
    realOdds: opts.mergedOdds,
    propPool: opts.pool,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    propSimulations: propHits,
    perfByFamily: opts.perfByFamily,
  });

  for (const pick of scoredPicks) {
    const fp = pickLegFingerprint(pick);
    if (seenFp.has(fp)) continue;
    const simHit = pick.finalAiScore?.simHit ?? null;
    const leg = scoredFromPropPick(pick, simHit, opts.perfByFamily, opts.calibration);
    if (!leg) continue;
    seenFp.add(fp);
    propScored.push(leg);
  }
}

/** Fast-rank every prop, then expand MC in batches until enough qualify or pool is exhausted. */
async function simPropPoolUntilQualified(
  pool: PropPoolEntry[],
  mergedOdds: RealOddsEntry[],
  gameScored: BoardScoredLeg[],
  opts: {
    target: number;
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    playerHistory?: Record<string, PlayerHistorySlice>;
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
    onWave?: (scored: BoardScoredLeg[]) => void;
  },
  signal?: AbortSignal,
): Promise<{ propScored: BoardScoredLeg[]; propHits: Map<string, { hitProbability: number | null }>; simEvaluated: number }> {
  const propHits = new Map<string, { hitProbability: number | null }>();
  const propScored: BoardScoredLeg[] = [];
  const seenFp = new Set<string>();

  const prescorePool = attachPickScores(pool.map(parsedPickFromPoolEntry), {
    realOdds: mergedOdds,
    propPool: pool,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    perfByFamily: opts.perfByFamily,
  });
  const rankedProps = [...prescorePool]
    .filter(isRealisticBoardPropCandidate)
    .sort(
      (a, b) =>
        (b.scores?.composite ?? b.finalAiScore?.composite ?? 0) -
        (a.scores?.composite ?? a.finalAiScore?.composite ?? 0),
    );

  const scoreOpts = {
    pool,
    mergedOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    perfByFamily: opts.perfByFamily,
    calibration: opts.calibration,
  };

  const combinedScored = () => [...gameScored, ...propScored];

  if (countQualifiedBoardLegs(combinedScored(), opts.target) >= opts.target || rankedProps.length === 0) {
    return { propScored, propHits, simEvaluated: 0 };
  }

  let simIndex = 0;
  let batchSize = boardPropSimInitialBatchSize(opts.target);

  while (simIndex < rankedProps.length) {
    if (signal?.aborted) break;

    const batch = rankedProps.slice(simIndex, simIndex + batchSize);
    simIndex += batch.length;
    const wave = await simPropBatch(batch, pool, signal);
    for (const [k, v] of wave) propHits.set(k, v);

    appendPropScoredLegs(rankedProps, propHits, propScored, seenFp, scoreOpts);
    const scored = combinedScored();
    opts.onWave?.(scored);

    if (countQualifiedBoardLegs(scored, opts.target) >= opts.target) break;
    if (simIndex >= rankedProps.length) break;

    batchSize = boardPropSimExpansionBatchSize(opts.target);
  }

  return { propScored, propHits, simEvaluated: simIndex };
}

/** Top evaluated game lines before sim gates qualify — early partial flash. */
function bootstrapPicksFromEvalRows(
  rows: EvaluatedGameLine[],
  target: number,
): ParsedPick[] {
  const ranked = [...rows]
    .filter((r) => r.pick.odds != null && Number.isFinite(r.pick.odds))
    .sort((a, b) => (b.finalAiScore.composite ?? 0) - (a.finalAiScore.composite ?? 0));
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  const want = Math.min(target, Math.max(2, ranked.length));
  for (const row of ranked) {
    const fp = pickLegFingerprint(row.pick);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({ ...row.pick, finalAiScore: row.finalAiScore });
    if (out.length >= want) break;
  }
  return out;
}

function buildScanResult(
  scored: BoardScoredLeg[],
  opts: {
    target: number;
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    totalScanned: number;
    preview?: boolean;
    bootstrapEvalRows?: EvaluatedGameLine[];
  },
): FullBoardScanResult {
  const staged = buildStagedTicketFromScan(scored, opts.target);
  let picks = staged.picks;
  let breakdown = staged.breakdown;

  // During in-flight scans, flash top-ranked scored legs before strict AI gates fill the ticket.
  if (opts.preview && picks.length === 0 && scored.length > 0) {
    const ranked = [...scored].sort((a, b) => b.rankScore - a.rankScore);
    const previewCount = Math.min(opts.target, Math.max(2, ranked.length));
    picks = selectTopBoardLegs(ranked, previewCount);
    breakdown = {
      mainQualified: ranked.length,
      altQualified: 0,
      mainOnTicket: picks.length,
      altOnTicket: 0,
    };
  }

  // Before sim grades land, flash top composite game lines so progress/cards don't stall at 84%.
  if (opts.preview && picks.length === 0 && opts.bootstrapEvalRows?.length) {
    picks = bootstrapPicksFromEvalRows(opts.bootstrapEvalRows, opts.target);
    if (picks.length > 0) {
      breakdown = {
        mainQualified: opts.bootstrapEvalRows.length,
        altQualified: 0,
        mainOnTicket: picks.length,
        altOnTicket: 0,
      };
    }
  }

  const totalQualified = breakdown.mainQualified + breakdown.altQualified;
  const note =
    picks.length >= opts.target
      ? fullBoardScanSuccessNote(opts.totalScanned, picks.length)
      : picks.length > 0 && opts.preview
        ? `Scoring live board — ${picks.length} leg${picks.length === 1 ? "" : "s"} ready so far (${opts.totalScanned} markets scanned)…`
        : fullBoardScanShortfallNote(opts.totalScanned, totalQualified, picks.length, breakdown);
  return {
    picks,
    evalLinesByGame: opts.evalLinesByGame,
    gameSimulations: opts.gameSimulations,
    totalScanned: opts.totalScanned,
    totalQualified,
    staging: breakdown,
    note,
    scanComplete: !opts.preview,
  };
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
  onPartial?: (result: FullBoardScanResult) => void;
}): Promise<FullBoardScanResult> {
  const poolBase = filterBettablePropPool(
    opts.excludedSports?.size ? filterForExcludedSports(opts.propPool, opts.excludedSports) : opts.propPool,
  );
  const oddsGamesRaw = opts.excludedSports?.size
    ? opts.oddsGames.filter((g) => !opts.excludedSports!.has(g.sport))
    : opts.oddsGames;
  const oddsGames = filterBettableOddsGames(oddsGamesRaw);

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
  const mergedOdds = mergeOddsEntries(
    opts.realOdds,
    ...(opts.liveOdds ?? []),
    ...evalLinesByGame.values(),
  );

  // Expand prop pool in parallel — never block the first partial on a slow fetch.
  let pool = filterBettablePropPool(poolBase);
  const poolExpandP =
    opts.espnGames?.length && poolBase.length < MIN_PROP_POOL_FOR_SKIP_FETCH
      ? fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
          .then((rows) => filterBettablePropPool(rows))
          .catch(() => null)
      : null;

  const scored: BoardScoredLeg[] = [];
  const bootstrapEvalRows: EvaluatedGameLine[] = [];
  let totalScanned = 0;
  const gameSimulations = new Map<string, CoachGameSimEntry>();
  const gameEntries = [...evalLinesByGame.entries()];
  const SLATE_SIM_BATCH = 2;

  const emitBoardScanPartial = () => {
    if (!opts.onPartial) return;
    const partial = buildScanResult(scored, {
      target: opts.target,
      evalLinesByGame,
      gameSimulations,
      totalScanned,
      preview: true,
      bootstrapEvalRows,
    });
    if (partial.picks.length > 0) opts.onPartial(partial);
  };

  // Flash top posted game lines immediately — before the first sim batch returns.
  for (const [, lines] of gameEntries) {
    if (!lines?.length) continue;
    const evaluated = evaluateGameLines({
      lines,
      gameSim: undefined,
      realOdds: mergedOdds,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
    });
    totalScanned += evaluated.length;
    bootstrapEvalRows.push(...evaluated);
  }
  emitBoardScanPartial();

  const scoreGamesAndMaybePartial = (games: string[]) => {
    for (const game of games) {
      const lines = evalLinesByGame.get(game);
      if (!lines?.length) continue;
      const sim = gameSimulations.get(game);
      const evaluated = evaluateGameLines({
        lines,
        gameSim: sim,
        realOdds: mergedOdds,
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
      });
      totalScanned += evaluated.length;
      bootstrapEvalRows.push(...evaluated);
      for (const row of evaluated) {
        const simHit = gameSimHitForPick(row.pick, sim);
        const leg = scoredFromEvalRow(row, opts.perfByFamily, simHit, opts.calibration);
        if (leg) scored.push(leg);
      }
    }
    emitBoardScanPartial();
  };

  for (let i = 0; i < gameEntries.length; i += SLATE_SIM_BATCH) {
    if (opts.signal?.aborted) break;
    const batch = gameEntries.slice(i, i + SLATE_SIM_BATCH);
    const batchSims = await fetchSlateGameSimulations(
      new Map(batch),
      opts.teamIdMap,
      opts.signal,
    );
    for (const [label, sim] of batchSims) gameSimulations.set(label, sim);
    scoreGamesAndMaybePartial(batch.map(([game]) => game));
  }

  const expandedPool = await poolExpandP;
  if (expandedPool?.length) pool = expandedPool;

  const propScoreOpts = {
    pool,
    mergedOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    perfByFamily: opts.perfByFamily,
    calibration: opts.calibration,
  };

  const { propScored } = await simPropPoolUntilQualified(
    pool,
    mergedOdds,
    scored,
    {
      target: opts.target,
      ...propScoreOpts,
      onWave: () => {
        emitBoardScanPartial();
      },
    },
    opts.signal,
  );

  scored.push(...propScored);

  totalScanned += pool.length;
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  collapsed.sort((a, b) => b.rankScore - a.rankScore);
  const result = buildScanResult(collapsed, {
    target: opts.target,
    evalLinesByGame,
    gameSimulations,
    totalScanned,
  });
  if (opts.onPartial && result.picks.length > 0) opts.onPartial(result);
  return result;
}

export function shouldUseFullBoardScan(
  legTarget: number,
  opts: {
    propsOnly?: boolean;
    explicitSingleGame?: boolean;
    oddsThreshold?: unknown;
    confidenceThreshold?: unknown;
    requestedLegs?: number;
    reachFull?: boolean;
  },
): boolean {
  if (reachBoardScanEligible(opts)) return true;
  const asked = opts.requestedLegs ?? 0;
  if (opts.reachFull && asked > 0) return true;
  return asked > 0 && legTarget >= 3;
}

/** True for explicit 3+ leg parlay asks that should always full-board scan. */
export function reachBoardScanEligible(opts: {
  isAnalyze?: boolean;
  requestedLegs?: number;
  propsOnly?: boolean;
  explicitSingleGame?: boolean;
  oddsThreshold?: unknown;
  confidenceThreshold?: unknown;
}): boolean {
  if (opts.isAnalyze) return false;
  const asked = opts.requestedLegs ?? 0;
  if (asked < 3) return false;
  if (opts.propsOnly || opts.explicitSingleGame || opts.oddsThreshold || opts.confidenceThreshold) {
    return false;
  }
  return true;
}

/** Full-board scan wrapper — never throws through to the coach render path. */
export async function tryReachFullBoardScan(
  opts: Parameters<typeof buildTopLegsFromFullBoardScan>[0],
): Promise<FullBoardScanResult | null> {
  try {
    return await buildTopLegsFromFullBoardScan(opts);
  } catch {
    return null;
  }
}
