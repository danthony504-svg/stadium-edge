import { propRequestCooldown } from "./propRequestCooldown.ts";
import { prioritizeUnscannedPropSeeds, distinctPropSimSeeds, postedPropCoverageForBatch, propDistributionIdentity } from "./coachPropSimCoverage.ts";
import { runCoachBounded } from "./coachAbortable.ts";
import { filterGameLinesForCoachSimulation, parseCoachAskMarketConstraint } from "./coachAskMarketFilter.ts";
import { bestPostedPropQuoteCandidates } from "./coachPropQuoteCandidates.ts";
import type { CoachPropAudit } from "./coachPropAudit.ts";
import { canCompleteAutomaticSmallTicket, runScanUntilTargetSatisfied } from "./coachSmallTicketCompletion.ts";
// Full-board scan: sim every posted game-line rung + prop pool row, rank by composite
// score (EV/sim/matchup/form/injury/line-move/market-efficiency), top N.
// Scan policy: coachScanPolicy.ts — AI Recommended picks only, never filler.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, GameMeta, OddsGame, PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchFullBoardPropPool, fetchPropSimulations } from "./api.ts";
import { enrichCoachPropSimHits } from "./coachPropSimFallback.ts";
import {
  exactMarket10kProvenance,
  propProvenanceAllowsSeating,
  type PropProbabilityProvenance,
} from "./coachPropProbabilityProvenance.ts";
import { filterForExcludedSports } from "./chatContextPriority.ts";
import {
  filterOddsGamesExcludingTeams,
  filterPicksExcludingTeams,
  filterPicksForAskTeam,
  filterScoredLegsForAskTeam,
  type CoachAskExcludedTeam,
  type CoachAskTeamScope,
} from "./coachAskTeamScope.ts";
import {
  createCoachBoardScanManifestRecorder,
  type CoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import { filterBettableOddsGames, filterBettablePropPool } from "./slate.ts";
import { bindOddsLabelsToTeamIdMap } from "./coachTeamIdResolve.ts";
import { fetchSlateGameSimulationsWithStatus, type GameTeamIds, type CoachGameSimEntry } from "./coachGameMonteCarlo.ts";
import {
  buildEvalLinesForAllGames,
  evaluateGameLines,
  mergeOddsEntries,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import { gameSimHitForPick, lookupGameSim } from "./gameSimScoring.ts";
import {
  deriveCoachScanFailureReason,
  type CoachScanFailureReason,
} from "./coachScanFailureReason.ts";
import { sanitizeCoachUserNote } from "./sanitizeCoachUserNote.ts";
import {
  deriveGameSimLineMetrics,
  simEvPct,
} from "./gameSimQualityGates.ts";
import {
  fullBoardScanShortfallNote,
  fullBoardScanSuccessNote,
  type TicketStagingBreakdown,
} from "./fullBoardMarketCopy.ts";
import {
  coachPerfElapsedMs,
  coachPerfNowMs,
} from "./coachPerfDiagnostics.ts";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import {
  opponentTeamIdForProp,
  ownTeamIdForProp,
  oppDefensePackForOpponent,
  ownTeamPackForProp,
  type FootballOppDefenseMap,
} from "./footballOppDefenseContext.ts";
import {
  missingRequiredOpponentEvidence,
  shouldBlockRushOverVsDefense,
  shouldDropPropMissingOppDefense,
} from "./footballRushDefense.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import { enforceSeatedPropProviderProvenance } from "./propProviderProvenance.ts";
import { augmentEvalLinesWithPostedOdds } from "./postedGameLineMerge.ts";
import { buildFullEvalLinesForGame } from "./postedMarketDiscovery.ts";
import {
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
  interleaveEntriesBySport,
} from "./coachPrioritySports.ts";
import { collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import { marketConfidenceDelta } from "./marketWeighting.ts";
import { scoreLineShopping } from "./pickScore.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { MatchupHistoryEntry } from "./api.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, parseMarketPeriod, pickHasSimGrade, sanitizeSimHitForGrade, clipPropSimHitForGrade } from "./simMarketSupport.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import { propSimKey, propSimLookupKey } from "./propSelection.ts";
import {
  boardLegPoolRole,
  buildStagedTicketFromScan,
  collapseSameTeamGameLineSides,
  tagTicketRoles,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import { safeCoachManifestInstrument } from "./coachFootballPropFunnel.ts";
export { buildStagedTicketFromScan, selectTopBoardLegs, tagTicketRoles, type BoardScoredLeg } from "./ticketStaging.ts";
import type { CalibrationBucket } from "./modelCalibration.ts";
import { calibrationDeltaForPick } from "./modelCalibration.ts";
import { coachCompositeRankScore, type BoardScoredLegHrMeta } from "./coachCompositeRank.ts";
import {
  buildCoachHrRankComponents,
  hrBoardPrescoreRank,
  hrSelectionDiagnostics,
  isBatterHomeRunPick,
  isHrOnlyScoredPool,
} from "./coachHrRank.ts";
import type { MlbGameEnvSlice, MlbPlatoonSlice } from "./propHolisticRecommendation.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import {
  isRareMultiCountOver,
  rareHrHardContextOk,
  rareMultiCountLotteryPathOpen,
} from "./rareMultiCountCoachGate.ts";
import { gameValueForMarket } from "./propStats.ts";

import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  boardPropSimMixBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  selectBoardPropSimCandidates,
  selectFootballMixPropSimCandidates,
  shouldStopPropSimForTicketMix,
  shouldUseFootballSkillPropSim,
} from "./boardPropSimExpansion.ts";
import {
  fillReservedPropSlots,
  fillReservedPeriodSlots,
  fillReservedTeamTotalSlots,
  finalizeFootballPropMixPicks,
  finalizeGeneralPropMixPicks,
  footballSkillPropRank,
  filterNcaafPlayerPropsUnlessAsked,
  isFootballHeavyPickList,
  shouldKeepAwaitingPropSlots,
} from "./boardScanPropDelivery.ts";
import { dedupePicksByMarketLadder } from "./marketLadderKey.ts";
import { interleaveSidesWithProps } from "./boardMarketPools.ts";
import {
  boardScanFootballMixOverlapGameBudgetMs,
  boardScanGamePhaseBudgetMs,
  boardScanMaxPropsToSim,
  boardScanMaxPropsToSimForMix,
  boardScanMixGamePhaseBudgetMs,
  boardScanPropPhaseDeadlineMs,
  boardScanPropSimBatchTimeoutMs,
  shouldOverlapFootballMixSims,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";
import {
  beginCoachSimulateSession,
  endCoachSimulateSession,
  type CoachSimulateOverlapMetrics,
} from "./coachSimulateLimiter.ts";
import {
  coachAbsoluteBudgetMs,
  coachFinalizationReserveMs,
  coachScoringWorkBudgetMs,
} from "./coach/session.ts";
export {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  boardPropSimMixBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  selectBoardPropSimCandidates,
  selectFootballMixPropSimCandidates,
  shouldStopPropSimForTicketMix,
  shouldUseFootballSkillPropSim,
} from "./boardPropSimExpansion.ts";

const PROP_SIM_BATCH_TIMEOUT_MS = boardScanPropSimBatchTimeoutMs();

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
  hits: Map<
    string,
    {
      hitProbability: number | null;
      probabilityProvenance?: PropProbabilityProvenance | null;
    }
  >,
): boolean {
  const row = hits.get(propSimKeyForPick(pick, poolRowForPropPick(pick, pool)) ?? "");
  const raw = row?.hitProbability ?? null;
  if (!propHasSimGrade(pick, raw)) return false;
  // Option C: when provenance is attached, only authorized sources may score/seat.
  if (row?.probabilityProvenance != null) {
    return propProvenanceAllowsSeating(row.probabilityProvenance);
  }
  return true;
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
        ? propSimKey(pick.player ?? "", altMarket, pick.propLine, pick.propSide ?? "")
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

export type FullBoardScanResult = {
  picks: ParsedPick[];
  /**
   * Staging-qualified scored picks (mains + alts) available for lean substitution
   * and post-seat integrity checks. May be larger than `picks`.
   */
  qualifiedCandidates?: ParsedPick[];
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
  /**
   * Preview truncated to leave room for ~50% prop slots that are not filled yet.
   * Must not be forceShow-escaped as a real under-count ticket — that published
   * "3 of 6 game lines" before prop sims started.
   */
  awaitingPropSlots?: boolean;
  /**
   * Prop scoring was cut short (abort/deadline) before any prop legs landed.
   * Callers must not treat a game-line-only shortfall as "every market scanned".
   */
  propPhaseIncomplete?: boolean;
  /** Exhaustive scan audit — families found, sim counts, gate failures, sample rejections. */
  manifest?: CoachBoardScanManifest;
  /** When picks are empty, stable code explaining why — for phone/OTA triage. */
  failureReason?: CoachScanFailureReason;
  /** Counters used to derive failureReason (also useful in logs). */
  failureDiagnostics?: {
    oddsGameCount: number;
    teamIdMapSize: number;
    gameEntryCount: number;
    gameSimsLoaded: number;
    gameLegsScored: number;
    gameLegsDroppedNoSim: number;
    propPoolSize: number;
    propLegsScored: number;
    propPhaseIncomplete: boolean;
    scoredBeforeStage: number;
    /** When true, gameSimsLoaded=0 is expected (game slate skipped). */
    propsOnly?: boolean;
    requirePropMix?: boolean;
    gameSimsAttempted?: boolean;
    oddsLabelsBound?: number;
    oddsLabelsUnresolved?: number;
    gameSimsFetchNull?: number;
    gameSimsTimedOut?: number;
    propSimEvaluated?: number;
    /** Wall ms for sequential game-sim batches (observe-only). */
    gameSimMs?: number;
    /** Wall ms for prop deep-sim phase when measured (observe-only). */
    propSimMs?: number;
  };
  /** HR board ranking diagnostics — selected vs next-best components. */
  hrRankDiagnostics?: ReturnType<typeof hrSelectionDiagnostics>;
  /** Football mix prop∥game overlap timings (request-scoped). */
  simulateOverlapMetrics?: CoachSimulateOverlapMetrics;
};

function unifiedRankScore(leg: Omit<BoardScoredLeg, "rankScore">): number {
  return coachCompositeRankScore(leg as BoardScoredLeg);
}

function lineShoppingFromPick(pick: ParsedPick, entry?: RealOddsEntry): number | null {
  const rubric = pick.finalAiScore?.rubric?.scores?.lineShopping ?? pick.scores?.scores?.lineShopping ?? null;
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
  const clipped = clipPropSimHitForGrade(pick, simHit);
  if (!pickHasSimGrade(pick, clipped)) return false;
  return marketSupportsSimulation(pick.market ?? "", pick);
}

function scoredFromEvalRow(
  row: EvaluatedGameLine,
  perfByFamily?: Map<string, MarketPerf>,
  simHit?: number | null,
  calibration?: Map<string, CalibrationBucket>,
): BoardScoredLeg | null {
  const rawHit = simHit ?? row.winProb ?? row.finalAiScore.simHit;
  const hit =
    sanitizeSimHitForGrade(rawHit, {
      market: row.pick.market,
      sport: row.pick.sport,
      isProp: !!row.pick.isProp,
      period: parseMarketPeriod(row.pick.market ?? ""),
      line: null,
      odds: row.pick.odds ?? null,
      simulationStatKey: "game_line_eval",
      edge: row.edgePct ?? row.finalAiScore.edgePct,
    }) ?? null;
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
  const clipped = clipPropSimHitForGrade(pick, simHit);
  const hit = sanitizeSimHitForGrade(clipped, {
    market: pick.market,
    sport: pick.sport,
    isProp: true,
    period: parseMarketPeriod(pick.market ?? ""),
    line: pick.propLine ?? null,
    odds: pick.odds ?? null,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
  });
  if (!propHasSimGrade(pick, hit)) return null;
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

export async function simPropBatch(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  teamIdsByGame?: Map<string, GameTeamIds>,
  signal?: AbortSignal,
  batchOpts?: { enrichTimeoutMs?: number; coverage?: ParsedPick[] },
): Promise<{
  hits: Map<string, { hitProbability: number | null; nullReason?: string | null }>;
  timedOut: boolean;
  playerHistory: Record<string, PlayerHistorySlice>;
}> {
  const out = new Map<string, { hitProbability: number | null; nullReason?: string | null; simulations?: number; probabilityProvenance?: PropProbabilityProvenance | null }>();
  if (!batch.length) return { hits: out, timedOut: false, playerHistory: {} };
  let timedOut = false;
  let sharedHistories: Record<string, import("./api.ts").PropSimPlayerHistoryPayload> = {};
  try {
    const simResult = await runCoachBounded(
      childSignal => fetchPropSimulations(batch, pool,
        { tier: "deep", teamIdsByGame: teamIdsByGame as Map<string, PropSimTeamIds> | undefined }, childSignal),
      PROP_SIM_BATCH_TIMEOUT_MS, signal,
    );
    const postedCoverage = postedPropCoverageForBatch(batchOpts?.coverage ?? batch, batch);
    for (const [k, v] of simResult.hits) {
      const batchPick = postedCoverage.get(k);
      if (!batchPick) continue; // Never authorize unposted or ambiguous response keys.
      const poolRow = poolRowForPropPick(batchPick, pool);
      const side =
        (v.side as "Over" | "Under" | undefined) ??
        (batchPick?.propSide === "Under" ? "Under" : batchPick?.propSide === "Over" ? "Over" : null);
      const athleteId = batchPick?.athleteId ?? poolRow?.athleteId ?? null;
      const eventId = batchPick?.eventId ?? poolRow?.eventId ?? null;
      const marketKey = v.market ?? batchPick?.propMarketKey ?? batchPick?.market;
      const sport = batchPick?.sport ?? (v as { sport?: string | null }).sport ?? null;
      const line = v.line ?? batchPick?.propLine ?? null;
      const probabilityProvenance = exactMarket10kProvenance({
        hitProbability: v.hitProbability,
        simulations: v.simulations,
        sport,
        marketKey,
        nullReason: v.nullReason ?? null,
        athleteId,
        eventId,
        side,
        line,
      });
      out.set(k, {
        hitProbability: probabilityProvenance.hitProbability,
        nullReason: probabilityProvenance.nullReason,
        simulations: v.simulations,
        probabilityProvenance,
      });
    }
    sharedHistories = simResult.playerHistories ?? {};
  } catch {
    if (propRequestCooldown.isBlocked("/sports/simulate/props")) return { hits: out, timedOut: false, playerHistory: {} };
    timedOut = true;
  }
  // Bound local history enrich — unbounded ESPN lookups were the hang that left
  // boardScanPending true forever while Coach sat at 84% Scoring player props.
  // Football skill path uses a longer enrich window so athleteId history can
  // land grades (phone PROP_ALL_NO_SIM_GRADE: 500 deep-simmed, 0 cleared).
  // Phase 2.3: pass authoritative histories from prop-sim so enrich reuses them.
  const PROP_ENRICH_TIMEOUT_MS = batchOpts?.enrichTimeoutMs ?? 12_000;
  let enriched: Awaited<ReturnType<typeof enrichCoachPropSimHits>>;
  try {
    enriched = await runCoachBounded(
      childSignal => enrichCoachPropSimHits(batch, pool, aliasPropSimHitsForBatch(batch, out), childSignal, sharedHistories),
      PROP_ENRICH_TIMEOUT_MS, signal,
    );
  } catch {
    timedOut = true;
    enriched = { hits: out, playerHistory: {}, historyReused: 0, historyFetched: 0 };
  }
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
    injuryTeams?: import("./api.ts").InjuryTeam[];
    mlbPlatoon?: Record<string, unknown>;
    mlbGameEnv?: Record<string, unknown>;
    oppRushDefense?: FootballOppDefenseMap;
    espnGames?: EspnGame[];
    teamIdMap?: Map<string, GameTeamIds>;
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
    propAudit?: CoachPropAudit;
    manifestRecorder?: ReturnType<typeof createCoachBoardScanManifestRecorder>;
    askText?: string | null;
    allowRareMultiCount?: boolean;
    ticketStyle?: string | null;
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
    injuryTeams: opts.injuryTeams,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    oppRushDefense: opts.oppRushDefense,
    espnGames: opts.espnGames,
    teamIdMap: opts.teamIdMap,
    propSimulations: propHits,
    perfByFamily: opts.perfByFamily,
  });

  for (const pick of scoredPicks) {
    opts.propAudit?.observe(pick, "grading", "graded");
    const fp = pickLegFingerprint(pick);
    if (seenFp.has(fp)) continue;
    const poolRow = opts.pool.find(
      (e) =>
        e.game === pick.game &&
        e.player === pick.player &&
        e.side === pick.propSide,
    );
    const sportKey = pick.sport ?? poolRow?.sport;
    const pack = oppDefensePackForOpponent({
      sport: sportKey,
      opponentTeamId: opponentTeamIdForProp({
        sport: sportKey,
        game: pick.game,
        teamAbbr: poolRow?.teamAbbr,
        espnGames: opts.espnGames,
        teamIdMap: opts.teamIdMap,
      }),
      map: opts.oppRushDefense,
    });
    const ownPack = ownTeamPackForProp({
      sport: sportKey,
      ownTeamId: ownTeamIdForProp({
        sport: sportKey,
        game: pick.game,
        teamAbbr: poolRow?.teamAbbr,
        espnGames: opts.espnGames,
        teamIdMap: opts.teamIdMap,
      }),
      map: opts.oppRushDefense,
    });
    const propPh =
      (opts.playerHistory &&
        ((pick.player &&
          pick.athleteId &&
          opts.playerHistory[`${pick.player}#${pick.athleteId}`]) ||
          Object.entries(opts.playerHistory).find(([k]) =>
            pick.athleteId
              ? k.endsWith(`#${pick.athleteId}`)
              : pick.player
                ? k.startsWith(`${pick.player}#`)
                : false,
          )?.[1])) ||
      null;
    opts.propAudit?.observe(pick, "grading", "graded", { historyGames: propPh?.recent?.length ?? null });
    if (
      shouldDropPropMissingOppDefense({
        sport: sportKey,
        market: pick.propMarketKey ?? pick.market,
        side: pick.propSide,
        line: pick.propLine,
        pack,
        vsOpponentGames: propPh?.vsOpponent?.length ?? 0,
      })
    ) {
      opts.propAudit?.observe(pick, "grading", "opponent_evidence_missing");
      continue;
    }
    if (
      shouldBlockRushOverVsDefense({
        sport: sportKey,
        market: pick.propMarketKey ?? pick.market,
        side: pick.propSide,
        defense: pack?.rush ?? null,
        pack,
        ownPack,
      })
    ) {
      opts.propAudit?.observe(pick, "grading", "rush_over_defense_block");
      continue;
    }
    const simHit = pick.finalAiScore?.simHit ?? null;
    let leg = scoredFromPropPick(pick, simHit, opts.perfByFamily, opts.calibration);
    if (!leg) { opts.propAudit?.observe(pick, "grading", "simulation_or_grade_unavailable"); continue; }
    // Option C — unauthorized / missing provenance never enters the scored pool.
    const scoredProv =
      (pick as { propProbabilityProvenance?: PropProbabilityProvenance | null })
        .propProbabilityProvenance ??
      pick.finalAiScore?.propProbabilityProvenance ??
      null;
    if (
      !propProvenanceAllowsSeating(scoredProv, {
        athleteId: pick.athleteId,
        eventId: pick.eventId,
        propMarketKey: pick.propMarketKey ?? pick.market,
        propSide: pick.propSide,
        propLine: pick.propLine,
      })
    ) {
      opts.propAudit?.observe(pick, "grading", "simulation_identity_or_evidence_invalid");
      continue;
    }
    // Carry rare-count reliability from enrich (null for ordinary markets).
    const simKey = propSimKeyForPick(pick, poolRowForPropPick(pick, opts.pool));
    const hitMeta = simKey ? propHits.get(simKey) : null;
    if (
      hitMeta &&
      "hitReliability" in hitMeta &&
      (hitMeta as { hitReliability?: number | null }).hitReliability != null
    ) {
      leg = {
        ...leg,
        hitReliability: (hitMeta as { hitReliability?: number | null }).hitReliability,
      };
    }
    // Normal Coach: rare multi-count HR needs hard context (pitcher/park/history).
    // Lottery / 2+ asks skip this — still need sim + #711 qualify.
    if (
      isRareMultiCountOver({
        market: pick.propMarketKey ?? pick.market,
        side: pick.propSide,
        line: pick.propLine,
      }) &&
      isBatterHomeRunPick(pick) &&
      !rareMultiCountLotteryPathOpen({
        askText: opts.askText,
        ticketStyle: opts.ticketStyle,
        allowLotteryPath: opts.allowRareMultiCount,
      })
    ) {
      const ids = opts.teamIdMap?.get(pick.game);
      const rawPlatoon =
        (pick.player &&
          pick.athleteId &&
          opts.mlbPlatoon?.[`${pick.player}#${pick.athleteId}`]) ||
        null;
      const rawEnv = opts.mlbGameEnv?.[pick.game] ?? null;
      const ph =
        (opts.playerHistory &&
          pick.player &&
          pick.athleteId &&
          opts.playerHistory[`${pick.player}#${pick.athleteId}`]) ||
        null;
      const ambiguous = new Set<string>();
      const hrVals =
        ph?.recent
          ?.map((g) =>
            gameValueForMarket("batter_home_runs", g.stats ?? {}, ambiguous),
          )
          .filter((v): v is number => v != null && Number.isFinite(v)) ?? [];
      const pt = String(poolRow?.playerTeamId ?? pick.playerTeamId ?? "").trim();
      const homeId = String(ids?.homeTeamId ?? "").trim();
      const isHome = pt && homeId ? pt === homeId : null;
      const ctx = rareHrHardContextOk({
        playerTeamId: pt || null,
        homeTeamId: ids?.homeTeamId,
        awayTeamId: ids?.awayTeamId,
        gameEnv: (rawEnv as MlbGameEnvSlice | null) ?? null,
        platoon: (rawPlatoon as MlbPlatoonSlice | null) ?? null,
        hrHistoryValues: hrVals,
        playerTeamIsHome: isHome,
      });
      if (!ctx.ok) { opts.propAudit?.observe(pick, "grading", "rare_home_run_missing_hard_context"); continue; }
    }
    if (isBatterHomeRunPick(pick)) {
      const rawPlatoon =
        (pick.player &&
          pick.athleteId &&
          opts.mlbPlatoon?.[`${pick.player}#${pick.athleteId}`]) ||
        (pick.athleteId &&
          opts.mlbPlatoon &&
          Object.entries(opts.mlbPlatoon).find(([k]) => k.endsWith(`#${pick.athleteId}`))?.[1]) ||
        (pick.player &&
          opts.mlbPlatoon &&
          Object.entries(opts.mlbPlatoon).find(([k]) => k.startsWith(`${pick.player}#`))?.[1]) ||
        null;
      const rawEnv = opts.mlbGameEnv?.[pick.game] ?? null;
      const hrRank = buildCoachHrRankComponents({
        pick,
        simHit: leg.simHit,
        evPct: leg.evPct,
        platoon: (rawPlatoon as MlbPlatoonSlice | null) ?? null,
        gameEnv: (rawEnv as MlbGameEnvSlice | null) ?? null,
        playerHistory:
          (opts.playerHistory &&
            ((pick.player &&
              pick.athleteId &&
              opts.playerHistory[`${pick.player}#${pick.athleteId}`]) ||
              Object.entries(opts.playerHistory).find(([k]) =>
                pick.athleteId ? k.endsWith(`#${pick.athleteId}`) : pick.player ? k.startsWith(`${pick.player}#`) : false,
              )?.[1])) ||
          null,
      });
      const withHr = { ...leg, hrRank } as typeof leg & BoardScoredLegHrMeta;
      withHr.rankScore = unifiedRankScore(withHr);
      leg = withHr;
    }
    seenFp.add(fp);
    opts.propAudit?.observe(leg.pick, "grading", "graded");
    propScored.push(leg);
  }
}

function prescorePropRank(pick: ParsedPick, opts?: { hrBoard?: boolean }): number {
  if (opts?.hrBoard || isBatterHomeRunPick(pick)) {
    return hrBoardPrescoreRank(pick);
  }
  // Alts often lack two-sided book EV before MC. Use neutral 0 so missing EV
  // does not double-penalize them in the sim queue vs mains with book edges.
  // Post-sim qualification / EV gates are unchanged.
  const rawEdge = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const isAlt = !!pick.propIsAlt || /\balt\b/i.test(String(pick.market ?? ""));
  const edgeForPrescore = rawEdge != null ? rawEdge : isAlt ? 0 : null;
  const leg: BoardScoredLeg = {
    pick,
    evPct: edgeForPrescore,
    edgePct: edgeForPrescore,
    confidencePct: pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null,
    impliedProbPct: null,
    lineShoppingScore:
      pick.finalAiScore?.rubric?.scores?.lineShopping ??
      pick.scores?.scores?.lineShopping ??
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
export async function simPropPoolUntilQualified(
  pool: PropPoolEntry[],
  mergedOdds: RealOddsEntry[],
  gameScored: BoardScoredLeg[],
  opts: {
    target: number;
    ticketStyle?: string | null;
    varietyContext?: import("./ticketStaging.ts").CoachTicketStagingContext;
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    playerHistory?: Record<string, PlayerHistorySlice>;
    injuryTeams?: import("./api.ts").InjuryTeam[];
    mlbPlatoon?: Record<string, unknown>;
    mlbGameEnv?: Record<string, unknown>;
    oppRushDefense?: FootballOppDefenseMap;
    espnGames?: EspnGame[];
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
    onWave?: (scored: BoardScoredLeg[]) => FullBoardScanResult;
    onPropBatch?: (size: number, timedOut: boolean, batch?: ParsedPick[]) => void;
    propAudit?: CoachPropAudit;
    manifestRecorder?: ReturnType<typeof createCoachBoardScanManifestRecorder>;
    teamIdsByGame?: Map<string, GameTeamIds>;
    propsOnly?: boolean;
    /** Football mix — skill-prop-first ranking + mix deadline. */
    requirePropMix?: boolean;
  /** Score every eligible prop (HR boards) — do not stop after N qualify. */
  exhaustPropBoard?: boolean;
    phaseStartedAtMs?: number;
  },
  signal?: AbortSignal,
): Promise<{
  propScored: BoardScoredLeg[];
  propHits: Map<string, { hitProbability: number | null }>;
  simEvaluated: number;
  /** True when abort/deadline stopped scoring before the candidate pool was exhausted. */
  incomplete: boolean;
}> {
  const propHits = new Map<string, { hitProbability: number | null }>();
  const propScored: BoardScoredLeg[] = [];
  const seenFp = new Set<string>();
  const footballSkill = shouldUseFootballSkillPropSim({
    requirePropMix: opts.requirePropMix,
    propsOnly: opts.propsOnly,
    pool,
  });
  const phaseDeadlineMs = boardScanPropPhaseDeadlineMs(opts.target, {
    exhaustPropBoard: opts.exhaustPropBoard,
    // Props-only NFL gets the finishable deadline (not generic 500-row path).
    requirePropMix: footballSkill || opts.requirePropMix,
  });

  const quoteCandidates = bestPostedPropQuoteCandidates(pool);
  for (const quote of quoteCandidates.discarded) {
    opts.propAudit?.observe(parsedPickFromPoolEntry(quote), "scope_excluded", "equivalent_wager_better_posted_price");
  }
  const prescorePool = attachPickScores(quoteCandidates.selected.map(parsedPickFromPoolEntry), {
    realOdds: mergedOdds,
    propPool: pool,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    injuryTeams: opts.injuryTeams,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    oppRushDefense: opts.oppRushDefense,
    espnGames: opts.espnGames,
    teamIdMap: opts.teamIdsByGame,
    perfByFamily: opts.perfByFamily,
  });
  const hrBoard =
    !!opts.exhaustPropBoard ||
    (prescorePool.length > 0 &&
      prescorePool.every((p) => isBatterHomeRunPick(p)));
  const rankedAll = [...prescorePool]
    .filter(isRealisticBoardPropCandidate)
    .sort((a, b) => {
      if (footballSkill) {
        const skill =
          footballSkillPropRank(b.propMarketKey ?? b.market) -
          footballSkillPropRank(a.propMarketKey ?? a.market);
        if (skill !== 0) return skill;
        const id = (b.athleteId ? 1 : 0) - (a.athleteId ? 1 : 0);
        if (id !== 0) return id;
      }
      return (
        prescorePropRank(b, { hrBoard }) - prescorePropRank(a, { hrBoard })
      );
    });
  // Spend the existing simulation budget on candidates whose required opponent
  // evidence is present first. Missing evidence remains blocked by the same gate.
  const evidenceReady = (pick: ParsedPick) => {
    const pack = oppDefensePackForOpponent({
      sport: pick.sport,
      opponentTeamId: opponentTeamIdForProp({ sport: pick.sport, game: pick.game,
        teamAbbr: pick.teamAbbr, espnGames: opts.espnGames, teamIdMap: opts.teamIdsByGame }),
      map: opts.oppRushDefense,
    });
    return !missingRequiredOpponentEvidence({ sport: pick.sport,
      market: pick.propMarketKey ?? pick.market, pack });
  };
  const simReady = rankedAll.filter(evidenceReady);
  for (const pick of rankedAll) {
    if (!evidenceReady(pick)) opts.propAudit?.observe(pick, "grading", "opponent_evidence_missing");
  }
  const maxToSim = footballSkill
    ? boardScanMaxPropsToSimForMix(opts.target, rankedAll.length)
    : boardScanMaxPropsToSim(opts.target, rankedAll.length);
  // Football skill (mix OR props-only NFL): finishable yards/TD quota set.
  // Generic 500-row board path → phone PROP_ALL_NO_SIM_GRADE (0 grades).
  const { selected: rankedProps } = footballSkill
    ? selectFootballMixPropSimCandidates(distinctPropSimSeeds(simReady), maxToSim)
    : selectBoardPropSimCandidates(distinctPropSimSeeds(simReady), maxToSim);

  const scoreOpts = {
    pool,
    mergedOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: { ...(opts.playerHistory ?? {}) },
    injuryTeams: opts.injuryTeams,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    oppRushDefense: opts.oppRushDefense,
    espnGames: opts.espnGames,
    teamIdMap: opts.teamIdsByGame,
    perfByFamily: opts.perfByFamily,
    calibration: opts.calibration,
    propAudit: opts.propAudit,
    manifestRecorder: opts.manifestRecorder,
    askText: opts.varietyContext?.askText ?? null,
    allowRareMultiCount: opts.varietyContext?.allowRareMultiCount,
    ticketStyle: opts.ticketStyle ?? opts.varietyContext?.ticketStyle ?? null,
  };

  const combinedScored = () => [...gameScored, ...propScored];

  if (rankedProps.length === 0) {
    return { propScored, propHits, simEvaluated: 0, incomplete: false };
  }

  // Start the prop MC clock AFTER sync ranking. attachPickScores used to burn the
  // entire deadline before the first sim batch — Coach then finalized 0 props as
  // a "complete" empty ticket.
  const phaseStartedAt = Date.now();

  let simIndex = 0;
  let batchSize = footballSkill
    ? boardPropSimMixBatchSize(opts.target)
    : boardPropSimInitialBatchSize(opts.target);
  let stoppedEarly = false;
  const enrichTimeoutMs = footballSkill ? 22_000 : 12_000;

  while (simIndex < rankedProps.length) {
    if (signal?.aborted || propRequestCooldown.isBlocked("/sports/simulate/props")) {
      stoppedEarly = true;
      break;
    }
    if (Date.now() - phaseStartedAt >= phaseDeadlineMs) {
      stoppedEarly = true;
      break;
    }

    if (simIndex > 0) rankedProps.splice(simIndex, rankedProps.length - simIndex,
      ...prioritizeUnscannedPropSeeds(rankedProps.slice(simIndex), rankedProps.slice(0, simIndex)));
    const batch = rankedProps.slice(simIndex, simIndex + batchSize);
    simIndex += batch.length;
    const wave = await simPropBatch(batch, pool, opts.teamIdsByGame, signal, {
      enrichTimeoutMs, coverage: rankedAll,
    });
    for (const [k, v] of wave.hits) propHits.set(k, v);
    for (const [k, v] of Object.entries(wave.playerHistory)) {
      scoreOpts.playerHistory[k] = v;
    }
    opts.onPropBatch?.(batch.length, wave.timedOut, batch);

    for (const pick of batch) {
      const key = propSimKeyForPick(pick, poolRowForPropPick(pick, pool));
      if (!key) {
        opts.propAudit?.observe(pick, "simulation", "simulation_lookup_identity_missing");
        opts.manifestRecorder?.recordPreScoreGateFailure(pick, { simHit: null });
        continue;
      }
      const evidence = wave.hits.get(key);
      const simHit = evidence?.hitProbability ?? null;
      opts.propAudit?.observe(pick, "simulation", simHit == null ? "simulation_unavailable" : "simulation_completed", {
        nullReason: evidence?.nullReason ?? (wave.timedOut ? "batch_timeout" : simHit == null ? "no_simulation_response" : null),
      });
      if (!propHasSimGrade(pick, simHit)) {
        opts.manifestRecorder?.recordPreScoreGateFailure(pick, { simHit });
      }
    }

    appendPropScoredLegs(rankedAll, propHits, propScored, seenFp, scoreOpts);
    const assembled = opts.onWave?.(combinedScored());

    if (
      shouldStopPropSimForTicketMix({
        scored: combinedScored(),
        assembledTicket: assembled?.picks,
        target: opts.target,
        propsOnly: opts.propsOnly,
        exhaustPropBoard: opts.exhaustPropBoard,
      })
    ) {
      break;
    }

    if (simIndex >= rankedProps.length) break;

    batchSize = footballSkill
      ? boardPropSimMixBatchSize(opts.target)
      : boardPropSimExpansionBatchSize(opts.target);
  }

  const selectedDistributions = new Set(rankedProps.map(propDistributionIdentity));
  const attemptedDistributions = new Set(rankedProps.slice(0, simIndex).map(propDistributionIdentity));
  for (const pick of rankedAll) {
    const key = propSimKeyForPick(pick, poolRowForPropPick(pick, pool));
    if (key && propHits.has(key)) continue;
    const distribution = propDistributionIdentity(pick);
    const reason = !selectedDistributions.has(distribution) ? "scan_distribution_budget" :
      !attemptedDistributions.has(distribution) ? (propRequestCooldown.isBlocked("/sports/simulate/props") ? "simulation_rate_limited" : signal?.aborted ? "scan_cancelled" : stoppedEarly ? "scan_deadline" : "scan_ticket_target_reached") :
      "shared_draw_exact_line_response_missing";
    opts.propAudit?.observe(pick, "not_evaluated", reason);
  }
  return {
    propScored,
    propHits,
    simEvaluated: simIndex,
    incomplete: stoppedEarly && simIndex < rankedProps.length,
  };
}


export function buildScanResult(
  scored: BoardScoredLeg[],
  opts: {
    propAudit?: CoachPropAudit;
    target: number;
    evalLinesByGame: Map<string, RealOddsEntry[]>;
    gameSimulations: Map<string, CoachGameSimEntry>;
    totalScanned: number;
    preview?: boolean;
    boardExhausted?: boolean;
    manifestRecorder: ReturnType<typeof createCoachBoardScanManifestRecorder>;
    varietySeed?: string;
    // CoachTicketStagingContext carries askText / single-event scope (#712) and
    // allowRareMultiCount (#713) — richer than a Partial variety-memory bag.
    varietyContext?: import("./ticketStaging.ts").CoachTicketStagingContext;
    ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
    requestId?: string;
    /** Stage only player-prop legs (props-only asks). Qual gates unchanged. */
    propsOnly?: boolean;
    /** Drop props from staging (game-lines-only asks). */
    gameLinesOnly?: boolean;
    /**
     * College team-market fills: keep FG + Q2 + team totals under the
     * per-game cap instead of collapsing to one side per team.
     */
    collegeTeamMarketStacks?: boolean;
    /** Override max game-line legs per matchup. */
    legsPerGameCap?: number;
    /** Prop scoring was cut short before any prop legs landed. */
    propPhaseIncomplete?: boolean;
    /**
     * Football mix asks ("10 leg nfl"): keep reserved prop seats open on the
     * FINAL ticket — never pad them with spreads/totals when props are late.
     */
    requirePropMix?: boolean;
    failureDiagnostics?: FullBoardScanResult["failureDiagnostics"];
    /** Limit NFL/NCAAF priority inject to leagues named in the ask. */
    prioritySports?: readonly string[];
    /** Drop scored leftovers from excluded matchups before staging/top-up. */
    excludedTeams?: readonly CoachAskExcludedTeam[];
    /**
     * Positive franchise/game include-scope. Immutable seating constraint —
     * not a grade gate. When set, cross-sport inject/floor is disabled and
     * every fill helper may only seat matching legs.
     */
    teamScope?: CoachAskTeamScope | null;
  },
): FullBoardScanResult {
  // Drop excluded-matchup leftovers before staging/top-up can re-seat them.
  const exclusionSafe = opts.excludedTeams?.length
    ? scored.filter(
        (leg) =>
          filterPicksExcludingTeams([leg.pick], opts.excludedTeams).length > 0,
      )
    : scored;
  // Include-scope before any staging/fill — generic qualified leftovers cannot
  // re-enter a team-scoped ticket (Buffalo ask must not seat Guardians/Dodgers).
  const scopeSafe = filterScoredLegsForAskTeam(exclusionSafe, opts.teamScope);
  const teamScopedAsk = !!opts.teamScope;
  // Preview + final: collapse ladder rungs before staging so Colts +4.5 / +3.5
  // cannot both land on the hang-guard buffer or the terminal ticket.
  // Prefer scopeSafe (#712 include-scope) over exclusionSafe alone.
  const ladderCollapsed = collapseScoredLegsByMarketLadder(scopeSafe);
  const stagePoolRaw = opts.propsOnly
    ? ladderCollapsed.filter((leg) => !!leg.pick.isProp)
    : opts.gameLinesOnly
      ? ladderCollapsed.filter((leg) => !leg.pick.isProp)
      : ladderCollapsed;
  // Stamp lottery / 2+ intent onto the stage pool so bare boardLegPoolRole
  // (fill / qualifiedCandidates / priority inject) still allows rare multi-count.
  const stagePool =
    opts.varietyContext?.allowRareMultiCount
      ? stagePoolRaw.map((leg) => ({
          ...leg,
          pick: {
            ...leg.pick,
            allowRareMultiCount: true as const,
          },
        }))
      : stagePoolRaw;
  const staged = buildStagedTicketFromScan(
    stagePool,
    opts.target,
    opts.varietySeed,
    {
      ...opts.varietyContext,
      ticketStyle: opts.ticketStyle,
      legsPerGameCap: opts.legsPerGameCap,
      collegeTeamMarketStacks: opts.collegeTeamMarketStacks,
      askText: opts.varietyContext?.askText,
      singleEventKey: opts.varietyContext?.singleEventKey,
      singleEventSport:
        opts.varietyContext?.singleEventSport ?? opts.teamScope?.sport ?? undefined,
    },
  );
  let picks = teamScopedAsk
    ? staged.picks
    : injectPrioritySportsIntoTicket(
        staged.picks,
        stagePool,
        opts.target,
        opts.prioritySports,
      );
  // When qualified props exist, fill ~40–50% reserved prop slots (TD / pass /
  // rec / rush yards preferred) so gameLines-first combinators cannot ship
  // ML/totals-only tickets. Scoped pool only — never foreign games.
  if (!opts.gameLinesOnly && !opts.propsOnly) {
    picks = fillReservedPropSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
  }
  // Prop-slot fill can evict soft football injects; restore multi-sport floor after.
  // Scoped asks disable cross-sport/cross-game variety entirely.
  if (!teamScopedAsk) {
    picks = enforceMultiSportFloorOnTicket(
      picks,
      stagePool,
      opts.target,
      opts.prioritySports ?? undefined,
    );
  }
  // Multi-sport floor can displace props — restore the reserved prop mix.
  if (!opts.gameLinesOnly && !opts.propsOnly) {
    picks = fillReservedPropSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
  }
  // College mix: reserve half/quarter seats so FG alts cannot crowd out period
  // team markets (1H / Q2 spreads + period team totals).
  if (opts.collegeTeamMarketStacks && !opts.propsOnly) {
    picks = fillReservedPeriodSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
    picks = fillReservedTeamTotalSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
  }
  // Team props / game-lines-only: one side per team before top-up (no FG+Q2
  // Browns). College team-market boards intentionally keep period + team-total
  // stacks so "7 leg college" can fill toward N from qualified team markets.
  if (opts.gameLinesOnly && !opts.collegeTeamMarketStacks) {
    picks = collapseSameTeamGameLineSides(picks);
  }
  // Collapse same-team game-line nick buckets (FG + period share a nick bucket).
  // College team-market boards intentionally keep period stacks via top-up opts.
  if (!opts.gameLinesOnly) {
    picks = collapseSameTeamGameLineSides(picks);
  }
  // Final safety: one rung per market ladder on the published ticket.
  picks = dedupePicksByMarketLadder(picks);
  // Include-scope belt — fills must never reintroduce foreign games/sports.
  picks = filterPicksForAskTeam(picks, opts.teamScope ?? null);
  // Top up from AI-qualified scored leftovers whenever under target — including
  // mid-scan previews. Preview used to skip this then seat-cap to exactly
  // boardScanNonPropPreviewCap(N) (phone 5→2 / 6→3) for the hang-guard buffer.
  // Never invents ungraded filler. Football finalize still re-caps while props
  // are incomplete; non-football keeps every cleared leg for terminal flush.
  // stagePool is already include-scoped — top-up cannot pull generic leftovers.
  if (picks.length < opts.target) {
    picks = topUpTicketFromQualifiedScored(
      picks,
      stagePool,
      opts.target,
      opts.varietySeed,
      opts.legsPerGameCap,
      opts.gameLinesOnly || opts.collegeTeamMarketStacks
        ? {
            collapseSameTeamSides: !!(opts.gameLinesOnly && !opts.collegeTeamMarketStacks),
            collegeTeamMarketStacks: !!opts.collegeTeamMarketStacks,
          }
        : undefined,
    );
    picks = filterPicksForAskTeam(picks, opts.teamScope ?? null);
    // Top-up may have added game lines first on short tickets — enforce prop mix again.
    if (!opts.gameLinesOnly && !opts.propsOnly) {
      picks = fillReservedPropSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
    }
    if (opts.collegeTeamMarketStacks && !opts.propsOnly) {
      picks = fillReservedPeriodSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
      picks = fillReservedTeamTotalSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
    }
    // Hard seating constraints after every fill path — nickname-normalized
    // ladder keys block Cowboys -5.5 / Dallas Cowboys -8.5 reintroduction.
    picks = dedupePicksByMarketLadder(picks);
  }
  // Football mix finals: hold reserved prop seats while props are incomplete;
  // deliver cleared GLs only after the prop phase finished with 0 props.
  // Non-football finals: ship every qualified leg toward N (never re-cap GLs
  // into a fake "quality bar" shortfall — phone 6-leg MLB → 3 alt spreads).
  let propCount = picks.filter((p) => p.isProp).length;
  const propFraction =
    opts.requirePropMix || isFootballHeavyPickList(picks) ? 0.4 : 0.5;
  if (opts.requirePropMix && !opts.propsOnly && !opts.gameLinesOnly) {
    picks = finalizeFootballPropMixPicks(picks, opts.target, {
      preview: opts.preview,
      propPhaseIncomplete: opts.propPhaseIncomplete,
    });
    propCount = picks.filter((p) => p.isProp).length;
  } else if (!opts.propsOnly && !opts.gameLinesOnly) {
    picks = finalizeGeneralPropMixPicks(picks, opts.target, {
      preview: opts.preview,
      propFraction,
    });
    propCount = picks.filter((p) => p.isProp).length;
  }
  // Last pass: one rung per market ladder (assembly / fills cannot reintroduce).
  picks = dedupePicksByMarketLadder(picks);
  propCount = picks.filter((p) => p.isProp).length;
  // Preview-only awaiting flag. Finals never wipe cleared game lines to empty.
  const awaitingPropSlots = shouldKeepAwaitingPropSlots({
    preview: opts.preview,
    propsOnly: opts.propsOnly,
    gameLinesOnly: opts.gameLinesOnly,
    targetLegs: opts.target,
    propCount,
    propPhaseIncomplete: opts.propPhaseIncomplete,
    requirePropMix: opts.requirePropMix,
  });
  // Tag AFTER fill / dedupe / top-up / prop-mix finalize so main/alt on-ticket
  // counts match the delivered ticket. staged.breakdown.mainOnTicket is an
  // intermediate staged snapshot (phone: Filled 3+1 while These 7…).
  picks = tagTicketRoles(picks);
  // Fail-closed: seated player props must retain provider side/line/price/book/
  // eventId/athleteId/marketKey. Never invent Under from Over. Game lines pass.
  {
    const provenanced = enforceSeatedPropProviderProvenance(picks);
    if (provenanced.stripped.length > 0) {
      console.warn(
        "[coach-prop-provenance] stripped seated props missing provider fields",
        provenanced.stripped.slice(0, 12),
      );
    }
    picks = provenanced.picks;
  }
  const breakdown: TicketStagingBreakdown = {
    mainQualified: staged.breakdown.mainQualified,
    altQualified: staged.breakdown.altQualified,
    mainOnTicket: picks.filter((p) => p.ticketRole === "main").length,
    altOnTicket: picks.filter((p) => p.ticketRole === "alt").length,
  };

  const totalQualified = breakdown.mainQualified + breakdown.altQualified;
  const scanComplete = !opts.preview && opts.boardExhausted === true && !opts.propPhaseIncomplete;
  // NFL/NCAAF funnel bookkeeping — fail-safe; never alters picks or staging.
  safeCoachManifestInstrument("football-prop-delivery-funnel", () => {
    const qualifiedFootballProps = scored
      .map((leg) => leg.pick)
      .filter((pick) => {
        if (!pick.isProp) return false;
        const sport = String(pick.sport ?? "").toLowerCase();
        if (sport !== "nfl" && sport !== "ncaaf") return false;
        const role = boardLegPoolRole(pick, pick.finalAiScore);
        return role === "main" || role === "alt";
      });
    opts.manifestRecorder.recordFootballPropDeliveryFunnel(qualifiedFootballProps, picks);
  });
  const manifest = opts.manifestRecorder.finalize({
    scanComplete,
    boardExhausted: opts.boardExhausted === true && !opts.propPhaseIncomplete,
    deliveredLegs: scanComplete ? picks.length : 0,
  });
  const note =
    picks.length >= opts.target
      ? fullBoardScanSuccessNote(opts.totalScanned, picks.length)
      : picks.length > 0 && opts.preview
        ? `Scoring live board — ${picks.length} leg${picks.length === 1 ? "" : "s"} ready so far (${opts.totalScanned} markets scanned)…`
        : fullBoardScanShortfallNote(
            opts.totalScanned,
            totalQualified,
            picks.length,
            breakdown,
            { propsOnly: opts.propsOnly, requested: opts.target },
          );
  // Final display order: lead with a side when props+sides both exist so
  // LIVE "7 leg nfl" does not open as a wall of Over props. Must run AFTER
  // prop-slot fill / multi-sport floor (those mutate membership).
  if (!opts.propsOnly) {
    picks = interleaveSidesWithProps(picks);
  }
  traceCoachTicket("board-scan-staged", {
    requestedLegs: opts.target,
    pickIds: picks,
    source: opts.preview ? "buildScanResult-preview" : "buildScanResult-final",
    extra: { scanComplete },
  });
  const failureReason =
    !opts.preview && picks.length === 0 && opts.failureDiagnostics
      ? deriveCoachScanFailureReason({
          ...opts.failureDiagnostics,
          stagedPickCount: picks.length,
          propPhaseIncomplete: opts.propPhaseIncomplete,
          propsOnly: opts.propsOnly ?? opts.failureDiagnostics.propsOnly,
          requirePropMix: opts.requirePropMix ?? opts.failureDiagnostics.requirePropMix,
        })
      : null;
  // Empty tickets keep failureReason on the scan result for logs/manifest —
  // never append `[CODE: detail]` to the user-facing Coach note (phone leak).
  const noteWithTrace = sanitizeCoachUserNote(note);

  let hrRankDiagnostics: ReturnType<typeof hrSelectionDiagnostics> | undefined;
  if (isHrOnlyScoredPool(scored)) {
    const componentsByFp = new Map<
      string,
      NonNullable<ReturnType<typeof buildCoachHrRankComponents>>
    >();
    for (const leg of scored) {
      if (!isBatterHomeRunPick(leg.pick)) continue;
      const attached = (leg as BoardScoredLeg & BoardScoredLegHrMeta).hrRank;
      const components =
        attached ??
        buildCoachHrRankComponents({
          pick: leg.pick,
          simHit: leg.simHit,
          evPct: leg.evPct,
        });
      componentsByFp.set(pickLegFingerprint(leg.pick), components);
    }
    hrRankDiagnostics = hrSelectionDiagnostics(scored, picks, componentsByFp);
  }

  if (opts.propAudit) {
    const fingerprints = (legs: BoardScoredLeg[]) => new Set(legs.map(leg => pickLegFingerprint(leg.pick)));
    const excludedSafeKeys = fingerprints(exclusionSafe), scopeSafeKeys = fingerprints(scopeSafe);
    const ladderKeys = fingerprints(ladderCollapsed), stageKeys = fingerprints(stagePool);
    for (const leg of scored) {
      const key = pickLegFingerprint(leg.pick);
      const reason = !excludedSafeKeys.has(key) ? "excluded_team"
        : !scopeSafeKeys.has(key) ? "request_team_scope"
        : !ladderKeys.has(key) ? "duplicate_market_ladder"
        : !stageKeys.has(key) ? "request_market_type" : null;
      if (reason) opts.propAudit.observe(leg.pick, "scope_excluded", reason);
    }
  }
  const qualifiedCandidates = stagePool
    .filter((leg) => {
      const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore, {
        onRejected: reason => opts.propAudit?.observe(leg.pick, "grading", reason),
      });
      if (role != null) opts.propAudit?.observe(leg.pick, "grading", "graded");
      return role != null;
    })
    .map((leg) => leg.pick);

  return {
    picks,
    qualifiedCandidates,
    evalLinesByGame: opts.evalLinesByGame,
    gameSimulations: opts.gameSimulations,
    totalScanned: opts.totalScanned,
    totalQualified,
    staging: breakdown,
    note: noteWithTrace,
    scanComplete,
    requestedLegs: opts.target,
    requestId: opts.requestId,
    ...(awaitingPropSlots ? { awaitingPropSlots: true } : {}),
    ...(opts.propPhaseIncomplete ? { propPhaseIncomplete: true } : {}),
    manifest,
    ...(failureReason ? { failureReason } : {}),
    ...(opts.failureDiagnostics ? { failureDiagnostics: opts.failureDiagnostics } : {}),
    ...(hrRankDiagnostics ? { hrRankDiagnostics } : {}),
  };
}

async function buildTopLegsFromFullBoardScanImpl(opts: {
  propAudit?: CoachPropAudit;
  target: number;
  oddsGames: OddsGame[];
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  liveOdds?: RealOddsEntry[];
  espnGames?: EspnGame[];
  gameMeta: GameMeta[];
  teamIdMap: Map<string, GameTeamIds>;
  excludedSports?: Set<string>;
  /** Explicit franchise exclusions — drop entire matchups before sim/staging. */
  excludedTeams?: readonly CoachAskExcludedTeam[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  playerHistory?: Record<string, PlayerHistorySlice>;
  injuryTeams?: import("./api.ts").InjuryTeam[];
  mlbPlatoon?: Record<string, unknown>;
  mlbGameEnv?: Record<string, unknown>;
  oppRushDefense?: FootballOppDefenseMap;
  perfByFamily?: Map<string, MarketPerf>;
  calibration?: Map<string, CalibrationBucket>;
  signal?: AbortSignal;
  onPartial?: (result: FullBoardScanResult) => void;
  stopWhenTargetQualified?: boolean;
  onTargetSatisfied?: (result: FullBoardScanResult) => void;
  varietySeed?: string;
  varietyContext?: import("./ticketStaging.ts").CoachTicketStagingContext;
  ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
  requestId?: string;
  propsOnly?: boolean;
  /** Positive franchise/game include-scope for seating (not a grade gate). */
  teamScope?: CoachAskTeamScope | null;
  /** Simulate every eligible prop (HR boards) — do not stop after N qualify. */
  exhaustPropBoard?: boolean;
  /** When set, overrides default max legs per game (game-lines-only / N-game asks). */
  legsPerGameCap?: number;
  /** Drop player props from staging (game lines / alts / periods only). */
  gameLinesOnly?: boolean;
  /**
   * College team-market fills: allow FG + Q2 + team totals under per-game caps
   * instead of collapsing same-team period sides (NHL team props still collapse).
   */
  collegeTeamMarketStacks?: boolean;
  /**
   * College books mostly post team markets — when true, strip NCAAF/CFB
   * player props from the scan pool (mixed "soccer and college" keeps soccer).
   */
  excludeNcaafPlayerProps?: boolean;
  /**
   * Football mix asks: score props before game lines, and keep reserved prop
   * seats open on the final ticket so spreads cannot pad a full GL board.
   */
  requirePropMix?: boolean;
  /**
   * When the caller already prefetched the full posted prop board, skip a
   * second fan-out so prop scoring can start right after game-line sims.
   * Fixes greenfield "2 game totals" tickets that latched before props loaded.
   */
  skipPropPoolExpand?: boolean;
  /** Limit priority-sport inject to leagues named in the user ask. */
  prioritySports?: readonly string[];
}): Promise<FullBoardScanResult> {
  const excludedTeams = opts.excludedTeams ?? [];
  const poolAfterSports = opts.excludedSports?.size
    ? filterForExcludedSports(opts.propPool, opts.excludedSports)
    : opts.propPool;
  const poolBase = filterBettablePropPool(
    filterPicksExcludingTeams(poolAfterSports, excludedTeams),
  );
  const oddsGamesRaw = opts.excludedSports?.size
    ? opts.oddsGames.filter((g) => !opts.excludedSports!.has(g.sport))
    : opts.oddsGames;
  const oddsGames = filterBettableOddsGames(
    filterOddsGamesExcludingTeams(oddsGamesRaw, excludedTeams),
  );

  // Pre-bind odds labels → ESPN ids so slate sims hit direct keys. Capture
  // bind counts — map.size alone overstates health (many keys per game).
  const oddsBind = bindOddsLabelsToTeamIdMap(
    opts.teamIdMap as unknown as Map<
      string,
      import("./coachTeamIdResolve.ts").CoachGameTeamIds
    >,
    oddsGames,
  );

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
  // Apply request/football period exclusions before any simulation queries.
  // Final delivery repeats the same constraint; discarded markets never qualify.
  const simulationConstraint = parseCoachAskMarketConstraint(opts.varietyContext?.askText);
  for (const [label, lines] of evalLinesByGame) {
    const eligible = filterGameLinesForCoachSimulation(lines, simulationConstraint);
    if (opts.propAudit) {
      const allowed = new Set(eligible);
      for (const line of lines) {
        opts.propAudit.observe(line as ParsedPick, "posted", "posted");
        opts.propAudit.observe(line as ParsedPick, allowed.has(line) ? "eligible" : "scope_excluded", allowed.has(line) ? "eligible" : "request_market_or_period_exclusion");
      }
    }
    if (eligible.length) evalLinesByGame.set(label, eligible);
    else evalLinesByGame.delete(label);
  }
  // liveOdds is RealOddsEntry[] — pass the array as one source. Spreading it
  // fed mergeOddsEntries individual entries; for..of then threw TypeError and
  // tryReachFullBoardScan returned null → phone SCAN_THREW empty tickets.
  const mergedOdds = mergeOddsEntries(
    opts.realOdds,
    opts.liveOdds ?? [],
    ...evalLinesByGame.values(),
  );

  // Expand to the full posted prop board unless the caller already loaded it.
  // Game-lines-only asks (team props / bare college) never expand into player props.
  let pool = opts.gameLinesOnly ? [] : filterBettablePropPool(poolBase);
  if (opts.excludeNcaafPlayerProps && pool.length > 0) {
    // Ask text already decided exclude — pass a non-allowing sentinel.
    pool = filterNcaafPlayerPropsUnlessAsked(pool, "team markets only");
  }
  const poolExpandP =
    opts.espnGames?.length && !opts.skipPropPoolExpand && !opts.gameLinesOnly
      ? fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
          .then((rows) => {
            let next = filterPicksExcludingTeams(
              filterBettablePropPool(rows),
              excludedTeams,
            );
            if (opts.excludeNcaafPlayerProps) {
              next = filterNcaafPlayerPropsUnlessAsked(next, "team markets only");
            }
            return next;
          })
          .catch(() => null)
      : null;

  const scored: BoardScoredLeg[] = [];
  let totalScanned = 0;
  let gameLegsScored = 0;
  let gameLegsDroppedNoSim = 0;
  const gameSimulations = new Map<string, CoachGameSimEntry>();
  // Round-robin by sport so NHL/WNBA/tennis receive sim coverage on thin
  // multi-sport slates instead of starving behind one league's Map order.
  const gameEntries = interleaveEntriesBySport(
    [...evalLinesByGame.entries()],
    (_game, lines) => String(lines?.[0]?.sport ?? "").toLowerCase(),
  );
  // Phase 2.3: outer batch 4 matches inner SLATE_SIM_CONCURRENCY (was effective 2).
  // Progressive partials preserved — still awaited per batch; scoring order follows
  // gameEntries insertion order independent of Promise completion order.
  const SLATE_SIM_BATCH = 4;
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

  // Mid-scan partials must stage from the *current* scored set. Prop waves pass
  // game+prop combined legs — never emit from outer `scored` alone during props,
  // or onPartial stays empty until the final boardExhausted result.
  const emitBoardScanPartial = (legs: BoardScoredLeg[] = scored) => {
    manifestRecorder.recomputeQualificationFromScored(legs);
    const partial = buildScanResult(legs, {
      propAudit: opts.propAudit,
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
      propsOnly: opts.propsOnly,
      gameLinesOnly: opts.gameLinesOnly,
      collegeTeamMarketStacks: opts.collegeTeamMarketStacks,
      legsPerGameCap: opts.legsPerGameCap,
      requirePropMix: opts.requirePropMix,
      prioritySports: opts.prioritySports,
      excludedTeams,
      teamScope: opts.teamScope,
    });
    if (canCompleteAutomaticSmallTicket({ enabled: opts.stopWhenTargetQualified, target: opts.target, picks: partial.picks, awaitingPropSlots: partial.awaitingPropSlots, propPhaseIncomplete: partial.propPhaseIncomplete })) {
      opts.onTargetSatisfied?.({ ...partial, scanComplete: true, note: "", manifest: manifestRecorder.finalize({ scanComplete: true, boardExhausted: false, deliveredLegs: partial.picks.length }) });
      return partial;
    }
    if (shouldEmitBoardScanPartial(partial)) opts.onPartial?.(partial);
    return partial;
  };

  /**
   * Score game lines, cooperatively yielding between games so prop-sim /
   * UI work can run (Phase 2.4 Option C). Yielding changes scheduling only —
   * same draws, same ordering within a game, same outputs. Abort mid-yield
   * stops this scan cleanly without touching shared game-sim caches.
   */
  const scoreGamesAndMaybePartial = async (games: string[]) => {
    for (let gi = 0; gi < games.length; gi++) {
      if (opts.signal?.aborted) return;
      const game = games[gi]!;
      const lines = evalLinesByGame.get(game);
      if (!lines?.length) {
        if (gi + 1 < games.length) {
          await new Promise<void>((r) => setImmediate(r));
          if (opts.signal?.aborted) return;
        }
        continue;
      }
      // Fuzzy bind — sims may be keyed under ESPN labels while eval uses odds labels.
      const sim = lookupGameSim(game, gameSimulations);
      const evaluated = evaluateGameLines({
        lines,
        gameSim: sim,
        realOdds: mergedOdds,
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
      });
      totalScanned += evaluated.length;
      for (const row of evaluated) {
        opts.propAudit?.observe(row.pick, "posted", "posted");
        opts.propAudit?.observe(row.pick, "simulation", sim ? "simulation_completed" : "simulation_unavailable");
        manifestRecorder.recordMarketFound(row.pick);
        const simHit = gameSimHitForPick(row.pick, sim);
        if (sim) manifestRecorder.recordGameLineSimulated();
        const leg = scoredFromEvalRow(row, opts.perfByFamily, simHit, opts.calibration);
        if (leg) {
          opts.propAudit?.observe(leg.pick, "grading", "graded");
          scored.push(leg);
          if (!leg.pick.isProp) gameLegsScored += 1;
        } else {
          opts.propAudit?.observe(row.pick, "grading", "simulation_or_grade_unavailable");
          // Always record — missing sims used to drop silently and look like a quality-bar miss.
          manifestRecorder.recordPreScoreGateFailure(row.pick, {
            ...row.finalAiScore,
            simHit: simHit ?? row.finalAiScore.simHit ?? null,
          });
          if (!sim) gameLegsDroppedNoSim += 1;
        }
      }
      // Yield between games (not mid-game) so RNG/call order inside one game
      // stays identical; no simulation is skipped because of the yield.
      if (gi + 1 < games.length) {
        await new Promise<void>((r) => setImmediate(r));
        if (opts.signal?.aborted) return;
      }
    }
    if (opts.signal?.aborted) return;
    emitBoardScanPartial();
  };

  const overlapProps = shouldOverlapPropPhaseWithGames(
    opts.skipPropPoolExpand,
    pool.length,
    opts.propsOnly,
  );
  let propPhaseIncomplete = false;
  let propScoredAcc: BoardScoredLeg[] = [];
  let propSimEvaluatedAcc = 0;

  const runPropPhase = (activePool: PropPoolEntry[]) => {
    for (const entry of activePool) {
      const auditPick = parsedPickFromPoolEntry(entry);
      opts.propAudit?.observe(auditPick, "posted", "posted");
      opts.propAudit?.observe(auditPick, "eligible", "eligible");
      manifestRecorder.recordPropPoolRow(auditPick);
    }
    const propScoreOpts = {
      pool: activePool,
      mergedOdds,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
      playerHistory: opts.playerHistory,
      injuryTeams: opts.injuryTeams,
      mlbPlatoon: opts.mlbPlatoon,
      mlbGameEnv: opts.mlbGameEnv,
      oppRushDefense: opts.oppRushDefense,
      espnGames: opts.espnGames,
      perfByFamily: opts.perfByFamily,
      calibration: opts.calibration,
      ticketStyle: opts.ticketStyle,
      varietyContext: opts.varietyContext,
    };
    const propPhaseStartedAt = Date.now();
    return simPropPoolUntilQualified(
      activePool,
      mergedOdds,
      scored,
      {
        target: opts.target,
        ...propScoreOpts,
        teamIdsByGame: opts.teamIdMap,
        propsOnly: opts.propsOnly,
        requirePropMix: opts.requirePropMix,
        exhaustPropBoard: opts.exhaustPropBoard,
        phaseStartedAtMs: propPhaseStartedAt,
        onWave: (combined) => emitBoardScanPartial(combined),
        onPropBatch: (size, timedOut, batch) => {
          // Fail-safe: batch football counters must never abort the prop sim loop.
          safeCoachManifestInstrument("onPropBatch-manifest", () => {
            manifestRecorder.recordPropSimBatch(size, timedOut, batch);
          });
        },
        propAudit: opts.propAudit,
        manifestRecorder,
      },
      opts.signal,
    );
  };

  // Football mix: overlap finishable skill deep-sim (≤72/96) with game lines
  // under a prop-priority shared simulate limiter. The old 360-row parallel path
  // starved props; the finishable cap + prop priority keeps both phases complete.
  // Game completion never aborts the prop phase — we always await propPhaseP.
  let propPhaseP: Promise<{
    propScored: BoardScoredLeg[];
    propHits: Map<string, { hitProbability: number | null }>;
    simEvaluated: number;
    incomplete: boolean;
  } | null> | null = null;
  const propsOnlyPath = !!opts.propsOnly;
  const footballMixPath = !!opts.requirePropMix && !propsOnlyPath;
  const footballMixOverlap = shouldOverlapFootballMixSims(
    opts.requirePropMix,
    opts.propsOnly,
    pool.length,
  );
  // Limiter + overlap metrics are football-mix-only. Non-football overlapProps
  // must keep its pre-PR unbounded-simulate timing (no shared session).
  const simulateSession = footballMixOverlap ? beginCoachSimulateSession() : null;

  if (footballMixOverlap) {
    simulateSession!.markPropPhaseStart();
    propPhaseP = runPropPhase(pool)
      .then((r) => {
        simulateSession?.markPropPhaseEnd();
        return r;
      })
      .catch(() => {
        simulateSession?.markPropPhaseEnd();
        propPhaseIncomplete = true;
        return null;
      });
  } else if (propsOnlyPath) {
    propPhaseP = runPropPhase(pool)
      .then((r) => r)
      .catch(() => {
        propPhaseIncomplete = true;
        return null;
      });
  } else if (opts.gameLinesOnly) {
    // Team props / bare college — never score player props.
    propPhaseP = null;
  } else if (overlapProps) {
    // Prefetched non-football pools — baseline overlap (no simulate limiter).
    propPhaseP = runPropPhase(pool)
      .then((r) => r)
      .catch(() => {
        propPhaseIncomplete = true;
        return null;
      });
  }

  let gameSimsAttempted = false;
  let gameSimsFetchNull = 0;
  let gameSimsTimedOut = 0;
  let slateUnresolved = 0;
  let gameSimMs: number | undefined;
  if (!opts.propsOnly) {
    gameSimsAttempted = gameEntries.length > 0;
    const gamePhaseBudgetMs = footballMixOverlap
      ? boardScanFootballMixOverlapGameBudgetMs(
          opts.target,
          coachAbsoluteBudgetMs(opts.target),
          coachFinalizationReserveMs(),
        )
      : footballMixPath || overlapProps
        ? Math.max(
            footballMixPath
              ? boardScanMixGamePhaseBudgetMs(opts.target)
              : boardScanGamePhaseBudgetMs(opts.target),
            footballMixPath ? 36_000 : 48_000,
          )
        : null;
    // Football-mix finalization reserve only — non-football keeps prior timing.
    const scoringWorkBudgetMs = footballMixOverlap
      ? coachScoringWorkBudgetMs(opts.target)
      : null;
    const gamePhaseStartedAt = Date.now();
    const gamePhasePerfStartedAt = coachPerfNowMs();
    const scoringStartedAt = simulateSession?.scoringStartedAtMs ?? gamePhaseStartedAt;
    if (footballMixOverlap && gameEntries.length > 0) {
      simulateSession?.markGamePhaseStart();
    }
    const SLATE_SIM_BATCH_REBUILD = footballMixPath || opts.requirePropMix ? 4 : SLATE_SIM_BATCH;
    for (let i = 0; i < gameEntries.length; i += SLATE_SIM_BATCH_REBUILD) {
      if (opts.signal?.aborted) break;
      // Football mix only: stop starting new game simulate work so staging
      // still runs inside the absolute budget. Does not abort in-flight props.
      if (
        scoringWorkBudgetMs != null &&
        Date.now() - scoringStartedAt >= scoringWorkBudgetMs
      ) {
        gameSimsTimedOut += gameEntries.length - i;
        break;
      }
      if (gamePhaseBudgetMs != null && Date.now() - gamePhaseStartedAt >= gamePhaseBudgetMs) {
        gameSimsTimedOut += gameEntries.length - i;
        break;
      }
      const batch = gameEntries.slice(i, i + SLATE_SIM_BATCH_REBUILD);
      try {
        const batchResult = await fetchSlateGameSimulationsWithStatus(
          new Map(batch),
          opts.teamIdMap,
          opts.signal,
        );
        for (const [label, sim] of batchResult.sims) gameSimulations.set(label, sim);
        gameSimsFetchNull += batchResult.fetchNull.length;
        slateUnresolved += batchResult.unresolved.length;
        await scoreGamesAndMaybePartial(batch.map(([game]) => game));
        if (opts.signal?.aborted) break;
      } catch {
        // Keep scanning remaining games + props. A thrown slate batch used to
        // abort buildTopLegsFromFullBoardScan → tryReachFullBoardScan(null) →
        // instant 0-of-N on phone.
        gameSimsFetchNull += batch.length;
        continue;
      }
    }
    gameSimMs = coachPerfElapsedMs(gamePhasePerfStartedAt);
    if (footballMixOverlap && gameEntries.length > 0) {
      simulateSession?.markGamePhaseEnd();
    }
  }

  const expandedPool = poolExpandP
    ? await runCoachBounded(() => poolExpandP!, 25_000, opts.signal).catch(() => null)
    : null;
  if (expandedPool?.length) pool = expandedPool;

  if (footballMixPath) {
    // Await overlapped prop phase — never cancelled by game completion above.
    if (propPhaseP) {
      const propResult = await propPhaseP;
      if (propResult) {
        propScoredAcc = propResult.propScored;
        propSimEvaluatedAcc += propResult.simEvaluated;
        if (propResult.incomplete) propPhaseIncomplete = true;
      } else {
        propPhaseIncomplete = true;
      }
    }
    // Only rescore if expand grew an empty skill wave after the overlapped pass.
    if (propScoredAcc.length === 0 && pool.length > 0 && expandedPool?.length) {
      try {
        simulateSession?.markPropPhaseStart();
        const propResult = await runPropPhase(pool);
        simulateSession?.markPropPhaseEnd();
        propScoredAcc = propResult.propScored;
        propSimEvaluatedAcc += propResult.simEvaluated;
        if (propResult.incomplete) propPhaseIncomplete = true;
      } catch {
        simulateSession?.markPropPhaseEnd();
        propPhaseIncomplete = true;
      }
    }
  } else if (opts.gameLinesOnly) {
    // Keep propScoredAcc empty — team-market tickets stay on spreads/totals.
  } else if (!propPhaseP) {
    try {
      const propResult = await runPropPhase(pool);
      propScoredAcc = propResult.propScored;
      propSimEvaluatedAcc += propResult.simEvaluated;
      if (propResult.incomplete) propPhaseIncomplete = true;
    } catch {
      propPhaseIncomplete = true;
    }
  } else {
    const propResult = await propPhaseP;
    if (propResult) {
      propScoredAcc = propResult.propScored;
      propSimEvaluatedAcc += propResult.simEvaluated;
      if (propResult.incomplete) propPhaseIncomplete = true;
    } else {
      propPhaseIncomplete = true;
    }
  }
  // Props-only: expand may have grown the pool after an early empty wave.
  if (
    !footballMixPath &&
    propScoredAcc.length === 0 &&
    pool.length > 0 &&
    opts.propsOnly &&
    expandedPool?.length
  ) {
    try {
      const propResult = await runPropPhase(pool);
      propScoredAcc = propResult.propScored;
      propSimEvaluatedAcc += propResult.simEvaluated;
      if (propResult.incomplete) propPhaseIncomplete = true;
    } catch {
      propPhaseIncomplete = true;
    }
  }
  scored.push(...propScoredAcc);
  if (
    pool.length > 0 &&
    !opts.propsOnly &&
    propScoredAcc.length === 0 &&
    (propPhaseIncomplete || opts.signal?.aborted)
  ) {
    propPhaseIncomplete = true;
  }

  totalScanned += pool.length;
  simulateSession?.markFinalizationStart();
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  collapsed.sort((a, b) => compareBoardLegsForRank(a, b, opts.varietySeed));
  manifestRecorder.recomputeQualificationFromScored(collapsed);
  const propLegsScored = collapsed.filter((leg) => !!leg.pick.isProp).length;
  const failureDiagnostics = {
    oddsGameCount: oddsGames.length,
    teamIdMapSize: opts.teamIdMap.size,
    gameEntryCount: gameEntries.length,
    gameSimsLoaded: gameSimulations.size,
    gameLegsScored,
    gameLegsDroppedNoSim,
    propPoolSize: pool.length,
    propLegsScored,
    propPhaseIncomplete,
    scoredBeforeStage: collapsed.length,
    propsOnly: !!opts.propsOnly,
    requirePropMix: !!opts.requirePropMix,
    gameSimsAttempted,
    oddsLabelsBound: oddsBind.bound,
    oddsLabelsUnresolved: Math.max(oddsBind.unresolved.length, slateUnresolved),
    gameSimsFetchNull,
    gameSimsTimedOut,
    propSimEvaluated: propSimEvaluatedAcc,
    ...(gameSimMs != null ? { gameSimMs } : {}),
  };
  const result = buildScanResult(collapsed, {
    propAudit: opts.propAudit,
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
    propsOnly: opts.propsOnly,
    gameLinesOnly: opts.gameLinesOnly,
    collegeTeamMarketStacks: opts.collegeTeamMarketStacks,
    legsPerGameCap: opts.legsPerGameCap,
    propPhaseIncomplete,
    requirePropMix: opts.requirePropMix,
    failureDiagnostics,
    prioritySports: opts.prioritySports,
    excludedTeams,
    teamScope: opts.teamScope,
  });
  simulateSession?.markFinalizationEnd();
  const overlapMetrics = simulateSession ? endCoachSimulateSession() : null;
  if (overlapMetrics) {
    result.simulateOverlapMetrics = overlapMetrics;
  }
  if (opts.onPartial) opts.onPartial(result);
  return result;
}

export async function buildTopLegsFromFullBoardScan(opts: Parameters<typeof buildTopLegsFromFullBoardScanImpl>[0]): Promise<FullBoardScanResult> {
  return runScanUntilTargetSatisfied(opts.signal, opts.stopWhenTargetQualified === true && opts.target === 2, (signal, complete) =>
    buildTopLegsFromFullBoardScanImpl({ ...opts, signal, onTargetSatisfied: complete }));
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

/**
 * Mid-scan onPartial gate: emit staged picks, or qualifying-candidate progress
 * when the gated ticket is still empty so Coach is not stuck with zero cards
 * while the board has already produced candidates.
 */
export function shouldEmitBoardScanPartial(partial: {
  picks: readonly unknown[];
  totalQualified: number;
}): boolean {
  return partial.picks.length > 0 || partial.totalQualified > 0;
}

/** True for explicit 3+ leg parlay asks that should always full-board scan. */
export function reachBoardScanEligible(opts: {
  isAnalyze?: boolean;
  requestedLegs?: number;
  propsOnly?: boolean;
  explicitSingleGame?: boolean;
  oddsThreshold?: unknown;
  confidenceThreshold?: unknown;
  /**
   * When the Coach parlay kernel skips the LLM, props-only has no alternate
   * delivery path — board-scan must stay eligible or the ticket finishes empty.
   */
  kernelOnly?: boolean;
}): boolean {
  if (opts.isAnalyze) return false;
  const asked = opts.requestedLegs ?? 0;
  if (asked < 3) return false;
  if (opts.explicitSingleGame || opts.oddsThreshold || opts.confidenceThreshold) {
    return false;
  }
  if (opts.propsOnly) {
    return opts.kernelOnly === true;
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
    // Clear any leaked simulate session if the scan threw mid-overlap.
    endCoachSimulateSession();
    return null;
  }
}
