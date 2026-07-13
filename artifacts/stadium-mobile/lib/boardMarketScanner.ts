// Full-board scan: sim every posted game-line rung + prop pool row, rank by composite
// score (EV/sim/matchup/form/injury/line-move/market-efficiency), top N.
// Scan policy: coachScanPolicy.ts — AI Recommended picks only, never filler.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, GameMeta, OddsGame, PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchFullBoardPropPool, fetchPropSimulations } from "./api.ts";
import { enrichCoachPropSimHits } from "./coachPropSimFallback.ts";
import { filterForExcludedSports } from "./chatContextPriority.ts";
import {
  createCoachBoardScanManifestRecorder,
  type CoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
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
import { propSimKey } from "./propSelection.ts";
import {
  buildStagedTicketFromScan,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
export { buildStagedTicketFromScan, selectTopBoardLegs, tagTicketRoles, type BoardScoredLeg } from "./ticketStaging.ts";
import type { CalibrationBucket } from "./modelCalibration.ts";
import { calibrationDeltaForPick } from "./modelCalibration.ts";
import { coachCompositeRankScore } from "./coachCompositeRank.ts";

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

const PROP_SIM_BATCH_TIMEOUT_MS = 60_000;

function propSimKeyForPick(pick: ParsedPick): string | null {
  if (!pick.isProp || !pick.player) return null;
  const market = pick.propMarketKey ?? pick.market ?? "";
  return propSimKey(pick.player, market, pick.propLine, pick.propSide ?? "");
}

function aliasPropSimHitsForBatch(
  batch: ParsedPick[],
  hits: Map<string, { hitProbability: number | null }>,
): Map<string, { hitProbability: number | null }> {
  const out = new Map(hits);
  for (const pick of batch) {
    const clientKey = propSimKeyForPick(pick);
    if (!clientKey || out.has(clientKey)) continue;
    const market = pick.propMarketKey ?? pick.market ?? "";
    const altMarket = pick.propMarketKey ? pick.market : pick.propMarketKey;
    const altKey =
      altMarket && altMarket !== market
        ? propSimKey(pick.player, altMarket, pick.propLine, pick.propSide ?? "")
        : null;
    if (altKey && out.has(altKey)) {
      out.set(clientKey, out.get(altKey)!);
      continue;
    }
    const side =
      pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
    if (!side || pick.propLine == null) continue;
    const suffix = `|${pick.propLine}|${side}`;
    for (const [serverKey, row] of hits) {
      if (serverKey.startsWith(`${pick.player}|`) && serverKey.endsWith(suffix)) {
        out.set(clientKey, row);
        break;
      }
    }
  }
  return out;
}

function propPickHasSimHit(
  pick: ParsedPick,
  hits: Map<string, { hitProbability: number | null }>,
): boolean {
  const key = propSimKeyForPick(pick);
  return key != null && hits.has(key);
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
  /** Exhaustive scan audit — families found, sim counts, gate failures, sample rejections. */
  manifest?: CoachBoardScanManifest;
};

function unifiedRankScore(leg: Omit<BoardScoredLeg, "rankScore">): number {
  return coachCompositeRankScore(leg as BoardScoredLeg);
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
  teamIdsByGame?: Map<string, GameTeamIds>,
  signal?: AbortSignal,
): Promise<{ hits: Map<string, { hitProbability: number | null; nullReason?: string | null }>; timedOut: boolean }> {
  const out = new Map<string, { hitProbability: number | null; nullReason?: string | null }>();
  if (!batch.length) return { hits: out, timedOut: false };
  try {
    const rows = await Promise.race([
      fetchPropSimulations(
        batch,
        pool,
        { tier: "deep", teamIdsByGame: teamIdsByGame as Map<string, PropSimTeamIds> | undefined },
        signal,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("prop-sim-batch-timeout")), PROP_SIM_BATCH_TIMEOUT_MS),
      ),
    ]);
    for (const [k, v] of rows) {
      out.set(k, { hitProbability: v.hitProbability, nullReason: v.nullReason ?? null });
    }
    const enriched = await enrichCoachPropSimHits(batch, pool, aliasPropSimHitsForBatch(batch, out), signal);
    return { hits: enriched, timedOut: false };
  } catch {
    return { hits: out, timedOut: true };
  }
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
    mlbPlatoon?: Record<string, unknown>;
    mlbGameEnv?: Record<string, unknown>;
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
    manifestRecorder?: ReturnType<typeof createCoachBoardScanManifestRecorder>;
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
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
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

function prescorePropRank(pick: ParsedPick): number {
  const leg: BoardScoredLeg = {
    pick,
    evPct: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null,
    edgePct: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null,
    confidencePct: pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null,
    impliedProbPct: null,
    lineShoppingScore:
      pick.finalAiScore?.rubric?.scores?.lineShopping ??
      pick.scores?.lineShopping ??
      null,
    grade: pick.finalAiScore?.grade ?? pick.scores?.grade ?? null,
    simHit: pick.finalAiScore?.simHit ?? null,
    composite: pick.finalAiScore?.composite ?? pick.scores?.composite ?? null,
    rankScore: 0,
  };
  return (
    coachCompositeRankScore(leg) ??
    pick.finalAiScore?.composite ??
    pick.scores?.composite ??
    0
  );
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
    mlbPlatoon?: Record<string, unknown>;
    mlbGameEnv?: Record<string, unknown>;
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
    onWave?: (scored: BoardScoredLeg[]) => void;
    onPropBatch?: (size: number, timedOut: boolean) => void;
    manifestRecorder?: ReturnType<typeof createCoachBoardScanManifestRecorder>;
    teamIdsByGame?: Map<string, GameTeamIds>;
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
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    perfByFamily: opts.perfByFamily,
  });
  const rankedProps = [...prescorePool]
    .filter(isRealisticBoardPropCandidate)
    .sort((a, b) => prescorePropRank(b) - prescorePropRank(a));

  const scoreOpts = {
    pool,
    mergedOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    perfByFamily: opts.perfByFamily,
    calibration: opts.calibration,
    manifestRecorder: opts.manifestRecorder,
  };

  const combinedScored = () => [...gameScored, ...propScored];

  if (rankedProps.length === 0) {
    return { propScored, propHits, simEvaluated: 0 };
  }

  let simIndex = 0;
  let batchSize = boardPropSimInitialBatchSize(opts.target);

  while (simIndex < rankedProps.length) {
    if (signal?.aborted) break;

    const batch = rankedProps.slice(simIndex, simIndex + batchSize);
    simIndex += batch.length;
    const wave = await simPropBatch(batch, pool, opts.teamIdsByGame, signal);
    for (const [k, v] of wave.hits) propHits.set(k, v);
    opts.onPropBatch?.(batch.length, wave.timedOut);

    for (const pick of batch) {
      const key = propSimKeyForPick(pick);
      if (!key) {
        opts.manifestRecorder?.recordPreScoreGateFailure(pick, { simHit: null });
        continue;
      }
      if (wave.timedOut || !wave.hits.has(key)) {
        opts.manifestRecorder?.recordPreScoreGateFailure(pick, { simHit: null });
        continue;
      }
      const simHit = wave.hits.get(key)?.hitProbability ?? null;
      if (!propHasSimGrade(pick, simHit)) {
        opts.manifestRecorder?.recordPreScoreGateFailure(pick, { simHit });
      }
    }

    appendPropScoredLegs(rankedProps, propHits, propScored, seenFp, scoreOpts);
    opts.onWave?.(combinedScored());

    if (simIndex >= rankedProps.length) break;

    batchSize = boardPropSimExpansionBatchSize(opts.target);
  }

  return { propScored, propHits, simEvaluated: simIndex };
}

function buildScanResult(
  scored: BoardScoredLeg[],
  opts: {
    target: number;
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    totalScanned: number;
    preview?: boolean;
    boardExhausted?: boolean;
    manifestRecorder: ReturnType<typeof createCoachBoardScanManifestRecorder>;
  },
): FullBoardScanResult {
  const staged = buildStagedTicketFromScan(scored, opts.target);
  const picks = staged.picks;
  const breakdown = staged.breakdown;

  const totalQualified = breakdown.mainQualified + breakdown.altQualified;
  const scanComplete = !opts.preview && opts.boardExhausted === true;
  const manifest = opts.manifestRecorder.finalize({
    scanComplete,
    boardExhausted: opts.boardExhausted === true,
    deliveredLegs: scanComplete ? picks.length : 0,
  });
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
    scanComplete,
    manifest,
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
  mlbPlatoon?: Record<string, unknown>;
  mlbGameEnv?: Record<string, unknown>;
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

  // Always expand to the full posted prop board when ESPN games are available.
  let pool = filterBettablePropPool(poolBase);
  const poolExpandP = opts.espnGames?.length
    ? fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
        .then((rows) => filterBettablePropPool(rows))
        .catch(() => null)
    : null;

  const scored: BoardScoredLeg[] = [];
  let totalScanned = 0;
  const gameSimulations = new Map<string, CoachGameSimEntry>();
  const gameEntries = [...evalLinesByGame.entries()];
  const SLATE_SIM_BATCH = 2;
  const manifestRecorder = createCoachBoardScanManifestRecorder(opts.target);

  for (const [, lines] of gameEntries) {
    for (const entry of lines ?? []) {
      manifestRecorder.recordMarketFound({
        game: entry.game,
        market: entry.market,
        pick: entry.pick,
        odds: entry.odds,
        isProp: false,
      } as ParsedPick);
    }
  }

  const emitBoardScanPartial = () => {
    if (!opts.onPartial) return;
    manifestRecorder.recomputeQualificationFromScored(scored);
    const partial = buildScanResult(scored, {
      target: opts.target,
      evalLinesByGame,
      gameSimulations,
      totalScanned,
      preview: true,
      manifestRecorder,
    });
    if (partial.picks.length > 0) opts.onPartial(partial);
  };

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
      for (const row of evaluated) {
        manifestRecorder.recordMarketFound(row.pick);
        const simHit = gameSimHitForPick(row.pick, sim);
        if (sim) manifestRecorder.recordGameLineSimulated();
        const leg = scoredFromEvalRow(row, opts.perfByFamily, simHit, opts.calibration);
        if (leg) {
          scored.push(leg);
        } else if (sim) {
          manifestRecorder.recordPreScoreGateFailure(row.pick, {
            ...row.finalAiScore,
            simHit: simHit ?? row.finalAiScore.simHit ?? null,
          });
        }
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

  for (const entry of pool) {
    manifestRecorder.recordPropPoolRow(parsedPickFromPoolEntry(entry));
  }

  const propScoreOpts = {
    pool,
    mergedOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
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
      teamIdsByGame: opts.teamIdMap,
      onWave: () => {
        emitBoardScanPartial();
      },
      onPropBatch: (size, timedOut) => {
        manifestRecorder.recordPropSimBatch(size, timedOut);
      },
      manifestRecorder,
    },
    opts.signal,
  );

  scored.push(...propScored);

  totalScanned += pool.length;
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  collapsed.sort((a, b) => b.rankScore - a.rankScore);
  manifestRecorder.recomputeQualificationFromScored(collapsed);
  const result = buildScanResult(collapsed, {
    target: opts.target,
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    boardExhausted: true,
    manifestRecorder,
  });
  if (opts.onPartial) opts.onPartial(result);
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
