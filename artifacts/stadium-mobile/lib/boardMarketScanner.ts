// Full-board scan: sim every posted game-line rung + prop pool row, rank by composite
// score (EV/sim/matchup/form/injury/line-move/market-efficiency), top N.
// Scan policy: coachScanPolicy.ts — AI Recommended picks only, never filler.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, GameMeta, OddsGame, PropPoolEntry, RealOddsEntry } from "./api.ts";
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
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import { propSimKey, propSimLookupKey } from "./propSelection.ts";
import {
  buildStagedTicketFromScan,
  boardLegPoolRole,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import type { TicketFamilyVarietyAudit } from "./coachTicketCombinations.ts";
export { buildStagedTicketFromScan, selectTopBoardLegs, tagTicketRoles, type BoardScoredLeg } from "./ticketStaging.ts";
import type { CalibrationBucket } from "./modelCalibration.ts";
import { calibrationDeltaForPick } from "./modelCalibration.ts";
import { coachCompositeRankScore } from "./coachCompositeRank.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import { nonOuCandidateDiagnostic, traceCoachMarketStage } from "./coachMarketDiagnostics.ts";
import { explainBoardLegQualification } from "./boardLegQualification.ts";
import { isYesNoPropMarket, simulationLineForProp } from "./propYesNoMarkets.ts";
import { recordCoachRequestTrace } from "./coachRequestTrace.ts";
import { shouldEmitPartialUpdate } from "./coachPartialUi.ts";
import type { CoachTicketMixConstraints } from "./slate.ts";
import {
  auditNonPropQualificationFailures,
  createCoachMarketPipelineAudit,
  legsQualifiedForStaging,
  picksSimulationEligible,
} from "./coachMarketPipelineAudit.ts";

import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  selectBoardPropSimCandidates,
} from "./boardPropSimExpansion.ts";
export {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  selectBoardPropSimCandidates,
} from "./boardPropSimExpansion.ts";
import {
  boardPropSimFetchConcurrency,
  boardScanMaxPropsToSim,
  boardScanPropSimBatchTimeoutMs,
} from "./boardScanScope.ts";
import { mapWithConcurrency, yieldToEventLoop } from "./boundedConcurrency.ts";
import {
  isCoachBoardScanAborted,
  mergeAbortSignals,
  runExclusiveCoachBoardScan,
} from "./coachBoardScanGuard.ts";

const PROP_SIM_BATCH_TIMEOUT_MS = boardScanPropSimBatchTimeoutMs();
const PROP_SIM_SUB_BATCH = 40;

function propSimKeyForPick(pick: ParsedPick, poolRow?: { marketKey?: string | null }): string | null {
  return propSimLookupKey(pick, poolRow);
}

function poolRowForPropPick(pick: ParsedPick, pool: PropPoolEntry[]): PropPoolEntry | undefined {
  const line = simulationLineForProp(pick.propMarketKey ?? pick.market, pick.propLine);
  const side = pick.propSide ?? (isYesNoPropMarket(pick.propMarketKey ?? pick.market) ? "Over" : undefined);
  return pool.find(
    (e) =>
      e.player === pick.player &&
      e.side === side &&
      simulationLineForProp(e.marketKey, e.line) === line &&
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
    if (!pick.player) continue;
    const market = pick.propMarketKey ?? pick.market ?? "";
    const altMarket = pick.propMarketKey ? pick.market : pick.propMarketKey;
    const altKey =
      altMarket && altMarket !== market
        ? propSimKey(pick.player, altMarket, simulationLineForProp(market, pick.propLine), pick.propSide ?? (isYesNoPropMarket(market) ? "Over" : ""))
        : null;
    if (altKey && out.has(altKey)) {
      out.set(clientKey, out.get(altKey)!);
      continue;
    }
    const side =
      pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : isYesNoPropMarket(market) ? "Over" : null;
    const line = simulationLineForProp(market, pick.propLine);
    if (!side || line == null) continue;
    const suffix = `|${line}|${side}`;
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

export type FullBoardScanResult = {
  picks: ParsedPick[];
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  staging: TicketStagingBreakdown;
  /** Qualified-family coverage and any family-level selection exclusions. */
  familyVariety?: TicketFamilyVarietyAudit;
  note: string;
  /** Leg count this scan was staged for — must match delivery target. */
  requestedLegs?: number;
  /** Coach request that started this scan — blocks stale cross-request reuse. */
  requestId?: string;
  /** False for in-flight partial flashes; true when the scan finished or exhausted the board. */
  scanComplete?: boolean;
  /** Exhaustive scan audit — families found, sim counts, gate failures, sample rejections. */
  manifest?: CoachBoardScanManifest;
};

function unifiedRankScore(leg: Omit<BoardScoredLeg, "rankScore">): number {
  return coachCompositeRankScore(leg);
}

function lineShoppingFromPick(pick: ParsedPick, entry?: RealOddsEntry): number | null {
  const rubric =
    pick.finalAiScore?.rubric.scores.lineShopping ??
    pick.scores?.scores.lineShopping ??
    null;
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
): Promise<{
  hits: Map<string, { hitProbability: number | null; nullReason?: string | null }>;
  timedOut: boolean;
  playerHistory: Record<string, PlayerHistorySlice>;
}> {
  const out = new Map<string, { hitProbability: number | null; nullReason?: string | null }>();
  if (!batch.length) return { hits: out, timedOut: false, playerHistory: {} };
  if (signal?.aborted) return { hits: out, timedOut: false, playerHistory: {} };

  const chunks: ParsedPick[][] = [];
  for (let i = 0; i < batch.length; i += PROP_SIM_SUB_BATCH) {
    chunks.push(batch.slice(i, i + PROP_SIM_SUB_BATCH));
  }

  let timedOut = false;
  const chunkResults = await mapWithConcurrency(
    chunks,
    boardPropSimFetchConcurrency(),
    async (chunk) => {
      if (signal?.aborted) {
        return { hits: new Map<string, { hitProbability: number | null; nullReason?: string | null }>(), timedOut: false };
      }
      try {
        const rows = await Promise.race([
          fetchPropSimulations(
            chunk,
            pool,
            { tier: "deep", teamIdsByGame },
            signal,
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("prop-sim-batch-timeout")), PROP_SIM_BATCH_TIMEOUT_MS),
          ),
        ]);
        const hits = new Map<string, { hitProbability: number | null; nullReason?: string | null }>();
        for (const [k, v] of rows) {
          hits.set(k, { hitProbability: v.hitProbability, nullReason: v.nullReason ?? null });
        }
        return { hits, timedOut: false };
      } catch {
        return {
          hits: new Map<string, { hitProbability: number | null; nullReason?: string | null }>(),
          timedOut: true,
        };
      }
    },
    { signal },
  );

  for (const result of chunkResults) {
    if (!result) continue;
    if (result.timedOut) timedOut = true;
    for (const [k, v] of result.hits) out.set(k, v);
  }

  if (signal?.aborted) return { hits: out, timedOut, playerHistory: {} };
  const enriched = await enrichCoachPropSimHits(batch, pool, aliasPropSimHitsForBatch(batch, out), signal);
  return { hits: enriched.hits, timedOut, playerHistory: enriched.playerHistory };
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
      pick.scores?.scores.lineShopping ??
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

export type PropSimPoolStats = {
  propScored: BoardScoredLeg[];
  propHits: Map<string, { hitProbability: number | null }>;
  inputCount: number;
  simulatedCount: number;
  skippedCount: number;
  qualifiedCount: number;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  error?: string;
};

/** Fast-rank + dedupe, then expand deep MC in bounded batches until enough qualify. */
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
): Promise<PropSimPoolStats> {
  const startedAt = Date.now();
  const propHits = new Map<string, { hitProbability: number | null }>();
  const propScored: BoardScoredLeg[] = [];
  const seenFp = new Set<string>();
  let timedOut = false;

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
  const rankedAll = [...prescorePool]
    .filter(isRealisticBoardPropCandidate)
    .sort((a, b) => prescorePropRank(b) - prescorePropRank(a));
  const maxToSim = boardScanMaxPropsToSim(opts.target, rankedAll.length);
  const { selected: rankedProps, skippedCount } = selectBoardPropSimCandidates(rankedAll, maxToSim);

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

  const combinedScored = () => [...gameScored, ...propScored];
  const finish = (simulatedCount: number, error?: string): PropSimPoolStats => ({
    propScored,
    propHits,
    inputCount: rankedAll.length,
    simulatedCount,
    skippedCount,
    qualifiedCount: countQualifiedBoardLegs(combinedScored(), opts.target),
    durationMs: Date.now() - startedAt,
    timedOut,
    aborted: !!signal?.aborted,
    ...(error ? { error } : signal?.aborted ? { error: "aborted" } : timedOut ? { error: "batch_timeout" } : {}),
  });

  if (rankedProps.length === 0) {
    return finish(0);
  }

  let simIndex = 0;
  let batchSize = boardPropSimInitialBatchSize(opts.target);

  while (simIndex < rankedProps.length) {
    if (signal?.aborted) break;

    const batch = rankedProps.slice(simIndex, simIndex + batchSize);
    simIndex += batch.length;
    const wave = await simPropBatch(batch, pool, opts.teamIdsByGame, signal);
    if (wave.timedOut) timedOut = true;
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

    // Enough unique ladder-collapsed legs to fill the ticket — stop deep MC.
    if (countQualifiedBoardLegs(combinedScored(), opts.target) >= opts.target) {
      return finish(simIndex);
    }

    if (simIndex >= rankedProps.length) break;

    batchSize = boardPropSimExpansionBatchSize(opts.target);
    await yieldToEventLoop();
  }

  return finish(simIndex);
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
    varietySeed?: string;
    varietyContext?: Partial<import("./parlayVarietyMemory.ts").CoachParlayVarietyContext>;
    ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
    requestId?: string;
    mixConstraints?: CoachTicketMixConstraints;
  },
): FullBoardScanResult {
  if (opts.preview) {
    const qualifying = scored
      .filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null)
      .sort((a, b) => compareBoardLegsForRank(a, b, opts.varietySeed));
    const picks = qualifying.slice(0, opts.target).map((leg) => leg.pick);
    const mainQualified = qualifying.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "main").length;
    const altQualified = qualifying.length - mainQualified;
    return {
      picks,
      evalLinesByGame: opts.evalLinesByGame,
      gameSimulations: opts.gameSimulations,
      totalScanned: opts.totalScanned,
      totalQualified: qualifying.length,
      staging: {
        mainQualified,
        altQualified,
        mainOnTicket: picks.filter((pick) => pick.ticketRole === "main").length,
        altOnTicket: picks.filter((pick) => pick.ticketRole === "alt").length,
      },
      note: picks.length
        ? `Scoring live board — ${picks.length} leg${picks.length === 1 ? "" : "s"} ready so far (${opts.totalScanned} markets scanned)…`
        : "",
      scanComplete: false,
      requestedLegs: opts.target,
      requestId: opts.requestId,
    };
  }
  const staged = buildStagedTicketFromScan(
    scored,
    opts.target,
    opts.varietySeed,
    {
      ...opts.varietyContext,
      ticketStyle: opts.ticketStyle,
      mixConstraints: opts.mixConstraints,
    },
  );
  const picks = staged.picks;
  const breakdown = staged.breakdown;

  const totalQualified = breakdown.mainQualified + breakdown.altQualified;
  const scanComplete = !opts.preview && opts.boardExhausted === true;
  // The exhaustive manifest is final-only. Recomputing it for every preview
  // wave blocks the mobile JS thread without affecting preview picks.
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
  traceCoachTicket("board-scan-staged", {
    requestedLegs: opts.target,
    pickIds: picks,
    source: opts.preview ? "buildScanResult-preview" : "buildScanResult-final",
    extra: { scanComplete: !opts.preview && opts.boardExhausted === true },
  });
  return {
    picks,
    evalLinesByGame: opts.evalLinesByGame,
    gameSimulations: opts.gameSimulations,
    totalScanned: opts.totalScanned,
    totalQualified,
    staging: breakdown,
    familyVariety: staged.familyVariety,
    note,
    scanComplete,
    requestedLegs: opts.target,
    requestId: opts.requestId,
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
  varietySeed?: string;
  varietyContext?: Partial<import("./parlayVarietyMemory.ts").CoachParlayVarietyContext>;
  mixConstraints?: CoachTicketMixConstraints;
  ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
  requestId?: string;
}): Promise<FullBoardScanResult> {
  const startedAt = Date.now();
  const traceTiming = (stage: string, extra: Record<string, unknown> = {}) => {
    console.log(
      "[coach-final-trace]",
      JSON.stringify({
        stage,
        elapsedMs: Date.now() - startedAt,
        target: opts.target,
        ...extra,
      }),
    );
  };
  const traceRequest = (
    stage: Parameters<typeof recordCoachRequestTrace>[0],
    extra: {
      candidateCount?: number;
      qualifiedCount?: number;
      returnedPickCount?: number;
      simulatedCount?: number;
      skippedCount?: number;
      durationMs?: number;
      error?: string;
    } = {},
  ) =>
    recordCoachRequestTrace(stage, {
      requestId: opts.requestId,
      ...extra,
    });
  if (opts.requestId && isCoachBoardScanAborted(opts.requestId)) {
    traceRequest("request_terminal", {
      error: "scan_ignored_after_terminal",
    });
    return {
      picks: [],
      evalLinesByGame: new Map(),
      gameSimulations: new Map(),
      totalScanned: 0,
      totalQualified: 0,
      staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
      note: "",
      scanComplete: true,
      requestedLegs: opts.target,
      requestId: opts.requestId,
    };
  }
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
    opts.liveOdds ?? [],
    ...evalLinesByGame.values(),
  );
  traceCoachMarketStage(
    "INGESTED",
    [...[...evalLinesByGame.values()].flat().map((e) => ({ game: e.game, market: e.market, pick: e.pick, odds: e.odds, sport: e.sport, isProp: false as const })), ...poolBase.map(parsedPickFromPoolEntry)],
  );

  // Always expand to the full posted prop board when ESPN games are available.
  let pool = filterBettablePropPool(poolBase);
  const poolExpandP = opts.espnGames?.length
    ? fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
        .then((rows) => filterBettablePropPool(rows))
        .catch(() => null)
    : null;
  traceTiming("board_scan_started", {
    gameCount: oddsGames.length,
    seedPropCount: poolBase.length,
  });
  traceRequest("scan_start", {
    candidateCount: poolBase.length + [...evalLinesByGame.values()].flat().length,
  });
  traceRequest("prop_expansion_start", { candidateCount: poolBase.length });

  const scored: BoardScoredLeg[] = [];
  let totalScanned = 0;
  const gameSimulations = new Map<string, CoachGameSimEntry>();
  const gameEntries = [...evalLinesByGame.entries()];
  const SLATE_SIM_BATCH = 2;
  const manifestRecorder = createCoachBoardScanManifestRecorder(opts.target);
  const pipelineAudit = createCoachMarketPipelineAudit(opts.requestId ?? "unknown");

  const rawFeedPicks = [
    ...[...evalLinesByGame.values()].flat().map((e) => ({
      game: e.game,
      market: e.market,
      pick: e.pick,
      odds: e.odds,
      sport: e.sport,
      isProp: false as const,
    })),
    ...poolBase.map(parsedPickFromPoolEntry),
  ];
  pipelineAudit.recordRawFeed(rawFeedPicks);
  for (const pick of rawFeedPicks) {
    pipelineAudit.recordNonPropCandidate(pick, "raw_feed", {
      unresolvedEvent: !pick.game?.trim(),
      missingOdds: pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0,
    });
  }

  for (const [, lines] of gameEntries) {
    for (const entry of lines ?? []) {
      manifestRecorder.recordMarketFound({
        game: entry.game,
        market: entry.market,
        pick: entry.pick,
        odds: entry.odds,
        sport: entry.sport,
        startsAt: entry.startsAt,
        isProp: false,
      });
    }
  }

  let lastPartialEmissionMs = 0;
  const emitBoardScanPartial = () => {
    if (!opts.onPartial) return;
    const now = Date.now();
    if (!shouldEmitPartialUpdate(now, lastPartialEmissionMs, 400)) return;
    lastPartialEmissionMs = now;
    const previewStartedAt = Date.now();
    traceRequest("preview_construction_start", {
      candidateCount: totalScanned,
      qualifiedCount: scored.length,
    });
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
    const previewDurationMs = Date.now() - previewStartedAt;
    traceRequest("preview_construction_complete", {
      candidateCount: totalScanned,
      qualifiedCount: partial.totalQualified,
      returnedPickCount: partial.picks.length,
      durationMs: previewDurationMs,
    });
    if (previewDurationMs > 100) {
      console.log(
        "[coach-ui-diagnostics]",
        JSON.stringify({
          stage: "UI_LONG_TASK",
          function: "buildScanResult",
          durationMs: previewDurationMs,
          requestId: opts.requestId ?? "",
        }),
      );
      traceRequest("UI_LONG_TASK", {
        candidateCount: totalScanned,
        qualifiedCount: partial.totalQualified,
        returnedPickCount: partial.picks.length,
        durationMs: previewDurationMs,
        error: "function=buildScanResult",
      });
    }
    if (partial.picks.length > 0) {
      traceRequest("partial_candidates_emitted", {
        candidateCount: totalScanned,
        qualifiedCount: partial.totalQualified,
        returnedPickCount: partial.picks.length,
      });
      // A scanner wave must return control to React Native before its preview
      // state patch runs. Final ticket construction remains synchronous only on
      // the completed-board path.
      setTimeout(() => opts.onPartial?.(partial), 0);
    }
  };

  traceRequest("game_sim_start", { candidateCount: gameEntries.length });
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
        const simHit = gameSimHitForPick(row.pick, sim, (diagnostic) => {
          pipelineAudit.recordGameSimulation(diagnostic);
        });
        pipelineAudit.recordFunnel("simulationAttempted", [row.pick]);
        if (sim) pipelineAudit.recordFunnel("simulationReturned", [row.pick]);
        if (sim) manifestRecorder.recordGameLineSimulated();
        const leg = scoredFromEvalRow(row, opts.perfByFamily, simHit, opts.calibration);
        if (leg) {
          scored.push(leg);
          pipelineAudit.recordScoredFunnel(row.pick, leg.pick.finalAiScore);
        } else {
          pipelineAudit.recordNonPropCandidate(row.pick, "simulation_eligible", {
            simFailure: true,
            simulationFailureReason: sim
              ? "Simulation did not produce a gradable hit rate"
              : "No simulation result returned for this event",
          });
          if (sim) {
          manifestRecorder.recordPreScoreGateFailure(row.pick, {
            ...row.finalAiScore,
            simHit: simHit ?? row.finalAiScore.simHit ?? null,
          });
          }
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
  traceTiming("game_simulations_finished", {
    simulatedGameCount: gameSimulations.size,
    scoredCount: scored.length,
  });
  traceRequest("game_sim_complete", {
    candidateCount: totalScanned,
    qualifiedCount: scored.length,
  });

  const expandedPool = await poolExpandP;
  if (expandedPool?.length) pool = expandedPool;
  traceTiming("prop_board_expansion_finished", { propCount: pool.length });
  traceRequest("prop_expansion_complete", { candidateCount: pool.length });
  const normalized = [
    ...[...evalLinesByGame.values()].flat().map((e) => ({ game: e.game, market: e.market, pick: e.pick, odds: e.odds, sport: e.sport, isProp: false as const })),
    ...pool.map(parsedPickFromPoolEntry),
  ];
  pipelineAudit.recordNormalized(normalized);
  const simEligible = picksSimulationEligible(normalized);
  pipelineAudit.recordSimulationEligible(simEligible);
  // Game rows were recorded as their simulator was invoked. Props have their
  // own deep-MC queue; recording eligibility here preserves the complete
  // request funnel without changing which rows that queue evaluates.
  pipelineAudit.recordFunnel("simulationAttempted", simEligible.filter((pick) => pick.isProp));
  traceCoachMarketStage("NORMALIZED", normalized);
  traceCoachMarketStage("SIMULATION_ATTEMPTED", normalized);

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

  traceRequest("prop_sim_start", { candidateCount: pool.length, qualifiedCount: scored.length });
  const propSim = await simPropPoolUntilQualified(
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

  scored.push(...propSim.propScored);
  pipelineAudit.recordPropSimulationSummary(propSim.inputCount, propSim.simulatedCount);
  for (const leg of propSim.propScored) {
    pipelineAudit.recordFunnel("simulationReturned", [leg.pick]);
    pipelineAudit.recordScoredFunnel(leg.pick, leg.pick.finalAiScore);
  }
  traceTiming("prop_simulations_finished", {
    propScoredCount: propSim.propScored.length,
    totalScoredCount: scored.length,
    simulatedCount: propSim.simulatedCount,
    skippedCount: propSim.skippedCount,
  });
  traceRequest("prop_sim_complete", {
    candidateCount: propSim.inputCount,
    qualifiedCount: propSim.qualifiedCount,
    returnedPickCount: propSim.propScored.length,
    simulatedCount: propSim.simulatedCount,
    skippedCount: propSim.skippedCount,
    durationMs: propSim.durationMs,
    error: propSim.error,
  });

  totalScanned += propSim.simulatedCount;
  const qualifiedLegs = legsQualifiedForStaging(scored);
  pipelineAudit.recordQualified(qualifiedLegs);
  auditNonPropQualificationFailures(pipelineAudit, scored.map((leg) => leg.pick), "qualified");
  traceCoachMarketStage("SIMULATION_SUCCEEDED", scored.map((leg) => leg.pick));
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  collapsed.sort((a, b) => compareBoardLegsForRank(a, b, opts.varietySeed));
  pipelineAudit.recordRanked(collapsed);
  traceCoachMarketStage("QUALIFIED", collapsed.map((leg) => leg.pick));
  traceRequest("qualification_complete", {
    candidateCount: totalScanned,
    qualifiedCount: collapsed.length,
  });
  traceCoachMarketStage("RANKED_TOP_25", collapsed.slice(0, 25).map((leg) => leg.pick));
  const rejectedNonOu = scored
    .filter((leg) => !leg.pick.isProp && !explainBoardLegQualification(leg.pick, leg.pick.finalAiScore).qualifies)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 20)
    .map((leg) => {
      const qualification = explainBoardLegQualification(leg.pick, leg.pick.finalAiScore);
      return nonOuCandidateDiagnostic(leg.pick, leg.pick.finalAiScore, `${qualification.gate}: ${qualification.reason}`);
    });
  console.log("[coach-market-diagnostics]", JSON.stringify({ stage: "TOP_20_NON_OU", candidates: rejectedNonOu }));
  manifestRecorder.recomputeQualificationFromScored(collapsed);
  const result = buildScanResult(collapsed, {
    target: opts.target,
    evalLinesByGame,
    gameSimulations,
    totalScanned,
    boardExhausted: true,
    manifestRecorder,
    varietySeed: opts.varietySeed,
    varietyContext: opts.varietyContext,
    ticketStyle: opts.ticketStyle,
    requestId: opts.requestId,
    mixConstraints: opts.mixConstraints,
  });
  if (result.familyVariety) pipelineAudit.recordTicketVariety(result.familyVariety);
  pipelineAudit.recordFinalSelected(result.picks);
  pipelineAudit.emitTrace();
  if (opts.onPartial) opts.onPartial(result);
  traceTiming("board_scan_finished", {
    qualifiedCount: result.totalQualified,
    deliveredCount: result.picks.length,
  });
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

/** Full-board scan wrapper — single-flight per requestId; never throws to coach UI. */
export async function tryReachFullBoardScan(
  opts: Parameters<typeof buildTopLegsFromFullBoardScan>[0],
): Promise<FullBoardScanResult | null> {
  const requestId = opts.requestId ?? "";
  if (requestId && isCoachBoardScanAborted(requestId)) {
    return null;
  }

  try {
    return await runExclusiveCoachBoardScan(requestId, async (scanSignal) => {
      if (requestId && isCoachBoardScanAborted(requestId)) return null;
      const signal = mergeAbortSignals(opts.signal, scanSignal);
      return buildTopLegsFromFullBoardScan({ ...opts, signal });
    });
  } catch {
    return null;
  }
}

export { abortCoachBoardScan, isCoachBoardScanAborted } from "./coachBoardScanGuard.ts";
