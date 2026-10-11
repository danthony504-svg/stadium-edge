// Full-board scan: sim every posted game-line rung + prop pool row, rank by composite
// score (EV/sim/matchup/form/injury/line-move/market-efficiency), top N.
// Scan policy: coachScanPolicy.ts — AI Recommended picks only, never filler.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, GameMeta, OddsGame, PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchFullBoardPropPool, fetchPropSimulations } from "./api.ts";
import { enrichCoachPropSimHits } from "./coachPropSimFallback.ts";
import {
  createCoachPropSimHistoryMemo,
  type CoachPropSimHistoryMemo,
  type CoachPropSimHistoryMemoStats,
} from "./coachPropSimHistoryMemo.ts";
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
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import { propSimKey, propSimLookupKey } from "./propSelection.ts";
import {
  buildStagedTicketFromScan,
  type BoardScoredLeg,
  type CoachTicketStagingContext,
} from "./ticketStaging.ts";
import {
  coachAskTeamScope,
  coachAskTeamShortfallNote,
} from "./coachAskTeamScope.ts";
import { shouldActivateSingleEventSeating } from "./singleEventSeating.ts";
export { buildStagedTicketFromScan, selectTopBoardLegs, tagTicketRoles, type BoardScoredLeg } from "./ticketStaging.ts";
import type { CalibrationBucket } from "./modelCalibration.ts";
import { calibrationDeltaForPick } from "./modelCalibration.ts";
import { coachCompositeRankScore } from "./coachCompositeRank.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";

import {
  boardPropSimExpansionBatchSize,
  boardPropSimFillCapacity,
  boardPropSimInitialBatchSize,
  isRealisticBoardPropCandidate,
} from "./boardPropSimExpansion.ts";
export {
  boardPropSimEarlyStopReserve,
  boardPropSimExpansionBatchSize,
  boardPropSimFillCapacity,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
} from "./boardPropSimExpansion.ts";

const PROP_SIM_BATCH_TIMEOUT_MS = 60_000;

function propSimKeyForPick(pick: ParsedPick, poolRow?: { marketKey?: string | null }): string | null {
  return propSimLookupKey(pick, poolRow);
}

function poolRowForPropPick(pick: ParsedPick, pool: PropPoolEntry[]): PropPoolEntry | undefined {
  return pool.find(
    (e) =>
      e.player === pick.player &&
      e.side === pick.propSide &&
      (pick.propLine == null || e.line === pick.propLine) &&
      (pick.game ? e.game === pick.game : true),
  );
}

function propPickHasSimHit(
  pick: ParsedPick,
  pool: PropPoolEntry[],
  hits: Map<string, { hitProbability: number | null }>,
): boolean {
  const hit = hits.get(propSimKeyForPick(pick, poolRowForPropPick(pick, pool)) ?? "")?.hitProbability ?? null;
  return pickHasSimGrade(pick, hit);
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

export type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";

/** Request-scoped board-scan speed diagnostics (no cross-request state). */
export type BoardScanPerfDiagnostics = {
  historyCacheHits: number;
  historyCacheMisses: number;
  historyFetches: number;
  athleteIdCacheHits: number;
  athleteIdCacheMisses: number;
  fallbackSkippedServerHit: number;
  /** Ranked realistic prop candidates considered for MC. */
  propCandidatesConsidered: number;
  /** Props that actually ran DEEP (10k) MC this request. */
  propsSimulated: number;
  /** simIndex where staging-aware early-stop fired; null if pool exhausted. */
  earlyStopFiredAt: number | null;
  earlyStopEnabled: boolean;
  earlyStopSeated: number | null;
  earlyStopNeed: number | null;
  /** Wall overlap of gameSim work with prop expand/sim waves (ms). */
  gameSimPropSimOverlapMs: number;
  gameSimMs: number;
  propSimMs: number;
};

export type FullBoardScanResult = {
  picks: ParsedPick[];
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  staging: TicketStagingBreakdown;
  note: string;
  /** Leg count this scan was staged for — must match delivery target. */
  requestedLegs?: number;
  /** Coach request that started this scan — blocks stale cross-request reuse. */
  requestId?: string;
  /** False for in-flight partial flashes; true when the scan finished or exhausted the board. */
  scanComplete?: boolean;
  /** Exhaustive scan audit — families found, sim counts, gate failures, sample rejections. */
  manifest?: CoachBoardScanManifest;
  /** Speed-pass diagnostics for history memo / overlap / early-stop. */
  perfDiagnostics?: BoardScanPerfDiagnostics;
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
  historyMemo?: CoachPropSimHistoryMemo,
): Promise<{
  hits: Map<string, { hitProbability: number | null; nullReason?: string | null }>;
  timedOut: boolean;
  playerHistory: Record<string, PlayerHistorySlice>;
  memo: CoachPropSimHistoryMemo;
}> {
  const memo = historyMemo ?? createCoachPropSimHistoryMemo();
  const out = new Map<string, { hitProbability: number | null; nullReason?: string | null }>();
  if (!batch.length) return { hits: out, timedOut: false, playerHistory: { ...memo.playerHistory }, memo };
  let timedOut = false;
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
  } catch {
    timedOut = true;
  }
  const enriched = await enrichCoachPropSimHits(
    batch,
    pool,
    aliasPropSimHitsForBatch(batch, out),
    signal,
    memo,
  );
  return { hits: enriched.hits, timedOut, playerHistory: enriched.playerHistory, memo: enriched.memo };
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
    if (!propPickHasSimHit(p, opts.pool, propHits)) return false;
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

/** Fast-rank every prop, then expand MC in batches until staging fill capacity or pool exhausted. */
async function simPropPoolUntilQualified(
  pool: PropPoolEntry[],
  mergedOdds: RealOddsEntry[],
  getGameScored: () => BoardScoredLeg[],
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
    historyMemo?: CoachPropSimHistoryMemo;
    /** Await before first early-stop check so game legs participate in staging. */
    gamesCompleteP?: Promise<void>;
    isGamesComplete?: () => boolean;
    varietySeed?: string;
    varietyContext?: CoachTicketStagingContext;
    /**
     * Staging-aware early-stop. Disabled when false — e.g. when we cannot prove
     * post-correlation seating capacity for the request.
     */
    earlyStopEnabled?: boolean;
  },
  signal?: AbortSignal,
): Promise<{
  propScored: BoardScoredLeg[];
  propHits: Map<string, { hitProbability: number | null }>;
  simEvaluated: number;
  propCandidatesConsidered: number;
  earlyStopFiredAt: number | null;
  earlyStopSeated: number | null;
  earlyStopNeed: number | null;
  historyStats: CoachPropSimHistoryMemoStats;
}> {
  const propHits = new Map<string, { hitProbability: number | null }>();
  const propScored: BoardScoredLeg[] = [];
  const seenFp = new Set<string>();
  const memo = opts.historyMemo ?? createCoachPropSimHistoryMemo();
  const earlyStopEnabled = opts.earlyStopEnabled !== false;

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
    playerHistory: { ...(opts.playerHistory ?? {}) },
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    perfByFamily: opts.perfByFamily,
    calibration: opts.calibration,
    manifestRecorder: opts.manifestRecorder,
  };

  const combinedScored = () => [...getGameScored(), ...propScored];

  const emptyDiag = {
    propScored,
    propHits,
    simEvaluated: 0,
    propCandidatesConsidered: rankedProps.length,
    earlyStopFiredAt: null as number | null,
    earlyStopSeated: null as number | null,
    earlyStopNeed: null as number | null,
    historyStats: { ...memo.stats },
  };

  if (rankedProps.length === 0) {
    return emptyDiag;
  }

  let simIndex = 0;
  let batchSize = boardPropSimInitialBatchSize(opts.target);
  let earlyStopFiredAt: number | null = null;
  let earlyStopSeated: number | null = null;
  let earlyStopNeed: number | null = null;
  let awaitedGamesForStop = false;

  while (simIndex < rankedProps.length) {
    if (signal?.aborted) break;

    const batch = rankedProps.slice(simIndex, simIndex + batchSize);
    simIndex += batch.length;
    const wave = await simPropBatch(batch, pool, opts.teamIdsByGame, signal, memo);
    for (const [k, v] of wave.hits) propHits.set(k, v);
    for (const [k, v] of Object.entries(wave.playerHistory)) {
      scoreOpts.playerHistory[k] = v;
    }
    opts.onPropBatch?.(batch.length, wave.timedOut);

    for (const pick of batch) {
      const key = propSimKeyForPick(pick, poolRowForPropPick(pick, pool));
      if (!key) {
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

    if (earlyStopEnabled) {
      // Do not early-stop until game legs are scored — staging must see the full
      // mixed pool (ladder / correlation / seating). Await once when props look dense.
      if (!opts.isGamesComplete?.()) {
        if (!awaitedGamesForStop && opts.gamesCompleteP && propScored.length >= opts.target) {
          awaitedGamesForStop = true;
          await opts.gamesCompleteP;
        } else if (!opts.isGamesComplete?.()) {
          batchSize = boardPropSimExpansionBatchSize(opts.target);
          continue;
        }
      }
      const fill = boardPropSimFillCapacity(combinedScored(), opts.target, {
        varietySeed: opts.varietySeed,
        varietyContext: opts.varietyContext,
      });
      earlyStopNeed = fill.need;
      if (fill.ready) {
        earlyStopFiredAt = simIndex;
        earlyStopSeated = fill.seated;
        break;
      }
    }

    batchSize = boardPropSimExpansionBatchSize(opts.target);
  }

  return {
    propScored,
    propHits,
    simEvaluated: simIndex,
    propCandidatesConsidered: rankedProps.length,
    earlyStopFiredAt,
    earlyStopSeated,
    earlyStopNeed,
    historyStats: { ...memo.stats },
  };
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
    /** Staging-aware early-stop finished the scan without exhausting the prop pool. */
    earlyStopped?: boolean;
    manifestRecorder: ReturnType<typeof createCoachBoardScanManifestRecorder>;
    varietySeed?: string;
    varietyContext?: CoachTicketStagingContext;
    ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
    requestId?: string;
    perfDiagnostics?: BoardScanPerfDiagnostics;
  },
): FullBoardScanResult {
  const stagingCtx: CoachTicketStagingContext = {
    ...opts.varietyContext,
    ticketStyle: opts.ticketStyle,
  };
  const staged = buildStagedTicketFromScan(
    scored,
    opts.target,
    opts.varietySeed,
    stagingCtx,
  );
  const picks = staged.picks;
  const breakdown = staged.breakdown;

  const totalQualified = breakdown.mainQualified + breakdown.altQualified;
  // Early-stop is a finished scan even when the prop board was not fully exhausted.
  const scanComplete =
    !opts.preview && (opts.boardExhausted === true || opts.earlyStopped === true);
  const manifest = opts.manifestRecorder.finalize({
    scanComplete,
    boardExhausted: opts.boardExhausted === true,
    deliveredLegs: scanComplete ? picks.length : 0,
  });
  let note: string;
  if (picks.length >= opts.target) {
    note = fullBoardScanSuccessNote(opts.totalScanned, picks.length);
  } else if (picks.length > 0 && opts.preview) {
    note = `Scoring live board — ${picks.length} leg${picks.length === 1 ? "" : "s"} ready so far (${opts.totalScanned} markets scanned)…`;
  } else {
    const askText = stagingCtx.askText;
    const teamScope = coachAskTeamScope(askText);
    const teamNote =
      teamScope && shouldActivateSingleEventSeating(askText)
        ? coachAskTeamShortfallNote(teamScope, opts.target, {
            qualifiedInScope: breakdown.qualifiedInScope ?? totalQualified,
            seatedCount: picks.length,
            // Single-event activation implies the scoped matchup was on the board.
            matchedGameCount: 1,
            limitingRule: breakdown.limitingRule,
          })
        : "";
    note = teamNote
      ? `${teamNote}\n\n${fullBoardScanShortfallNote(opts.totalScanned, totalQualified, picks.length, breakdown)}`
      : fullBoardScanShortfallNote(opts.totalScanned, totalQualified, picks.length, breakdown);
  }
  traceCoachTicket("board-scan-staged", {
    requestedLegs: opts.target,
    pickIds: picks,
    source: opts.preview ? "buildScanResult-preview" : "buildScanResult-final",
    extra: {
      scanComplete,
      earlyStopped: opts.earlyStopped === true,
      boardExhausted: opts.boardExhausted === true,
    },
  });
  return {
    picks,
    evalLinesByGame: opts.evalLinesByGame,
    gameSimulations: opts.gameSimulations,
    totalScanned: opts.totalScanned,
    totalQualified,
    staging: breakdown,
    note,
    scanComplete,
    requestedLegs: opts.target,
    requestId: opts.requestId,
    manifest,
    perfDiagnostics: opts.perfDiagnostics,
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
  varietySeed?: string;
  varietyContext?: CoachTicketStagingContext;
  ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
  requestId?: string;
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
  // liveOdds is RealOddsEntry[] — pass as one source list (do not spread entries).
  const mergedOdds = mergeOddsEntries(
    opts.realOdds,
    opts.liveOdds ?? [],
    ...evalLinesByGame.values(),
  );

  // Always expand to the full posted prop board when ESPN games are available.
  let pool = filterBettablePropPool(poolBase);
  const poolExpandP = opts.espnGames?.length
    ? fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
        .then((rows) => filterBettablePropPool(rows))
        .catch(() => null)
    : Promise.resolve(null);

  const scored: BoardScoredLeg[] = [];
  let totalScanned = 0;
  const gameSimulations = new Map<string, CoachGameSimEntry>();
  const gameEntries = [...evalLinesByGame.entries()];
  const SLATE_SIM_BATCH = 2;
  const manifestRecorder = createCoachBoardScanManifestRecorder(opts.target);
  const historyMemo = createCoachPropSimHistoryMemo();

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
      varietySeed: opts.varietySeed,
      varietyContext: opts.varietyContext,
      ticketStyle: opts.ticketStyle,
      requestId: opts.requestId,
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

  const gameSimStartedAt = Date.now();
  let gameSimFinishedAt = 0;
  let gamesComplete = false;

  // Start game sims immediately — overlap with pool expand + first prop waves.
  const gameWorkP = (async () => {
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
    gamesComplete = true;
    gameSimFinishedAt = Date.now();
  })();

  // Pool expand runs concurrently with game sims (no duplicate game-sim work).
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

  // Early-stop is enabled when we can run the same staging path as final delivery
  // (ladder + correlation + seating via buildStagedTicketFromScan at target+reserve).
  const earlyStopEnabled = true;

  const propSimStartedAt = Date.now();
  const propResultP = simPropPoolUntilQualified(
    pool,
    mergedOdds,
    () => scored,
    {
      target: opts.target,
      ...propScoreOpts,
      teamIdsByGame: opts.teamIdMap,
      historyMemo,
      gamesCompleteP: gameWorkP,
      isGamesComplete: () => gamesComplete,
      varietySeed: opts.varietySeed,
      varietyContext: opts.varietyContext,
      earlyStopEnabled,
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

  // Preserve finalization ordering: games must finish before we seal the ticket,
  // while prop waves may already have overlapped gameSim wall time.
  await gameWorkP;
  const {
    propScored,
    simEvaluated,
    propCandidatesConsidered,
    earlyStopFiredAt,
    earlyStopSeated,
    earlyStopNeed,
    historyStats,
  } = await propResultP;
  const propSimFinishedAt = Date.now();

  scored.push(...propScored);

  const gameSimMs = Math.max(0, gameSimFinishedAt - gameSimStartedAt);
  const propSimMs = Math.max(0, propSimFinishedAt - propSimStartedAt);
  const overlapStart = Math.max(gameSimStartedAt, propSimStartedAt);
  const overlapEnd = Math.min(gameSimFinishedAt || propSimFinishedAt, propSimFinishedAt);
  const gameSimPropSimOverlapMs = Math.max(0, overlapEnd - overlapStart);

  const earlyStopped = earlyStopFiredAt != null;
  const boardExhausted = !earlyStopped;

  totalScanned += pool.length;
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  collapsed.sort((a, b) => compareBoardLegsForRank(a, b, opts.varietySeed));
  manifestRecorder.recomputeQualificationFromScored(collapsed);

  const perfDiagnostics: BoardScanPerfDiagnostics = {
    historyCacheHits: historyStats.historyCacheHits,
    historyCacheMisses: historyStats.historyCacheMisses,
    historyFetches: historyStats.historyFetches,
    athleteIdCacheHits: historyStats.athleteIdCacheHits,
    athleteIdCacheMisses: historyStats.athleteIdCacheMisses,
    fallbackSkippedServerHit: historyStats.fallbackSkippedServerHit,
    propCandidatesConsidered,
    propsSimulated: simEvaluated,
    earlyStopFiredAt,
    earlyStopEnabled,
    earlyStopSeated,
    earlyStopNeed,
    gameSimPropSimOverlapMs,
    gameSimMs,
    propSimMs,
  };

  const result = buildScanResult(collapsed, {
    target: opts.target,
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    boardExhausted,
    earlyStopped,
    manifestRecorder,
    varietySeed: opts.varietySeed,
    varietyContext: opts.varietyContext,
    ticketStyle: opts.ticketStyle,
    requestId: opts.requestId,
    perfDiagnostics,
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
