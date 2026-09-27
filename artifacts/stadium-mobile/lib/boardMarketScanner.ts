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
  formatCoachScanFailureTrace,
  type CoachScanFailureReason,
} from "./coachScanFailureReason.ts";
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
import {
  enforceMultiSportFloorOnTicket,
  injectPrioritySportsIntoTicket,
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
  finalizeFootballPropMixPicks,
  footballSkillPropRank,
  isFootballHeavyPickList,
  shouldKeepAwaitingPropSlots,
  shouldReservePropSeats,
  applyReservedPropSeatCap,
} from "./boardScanPropDelivery.ts";
import { interleaveSidesWithProps } from "./boardMarketPools.ts";
import {
  boardScanGamePhaseBudgetMs,
  boardScanMaxPropsToSim,
  boardScanMaxPropsToSimForMix,
  boardScanMixGamePhaseBudgetMs,
  boardScanPropPhaseDeadlineMs,
  boardScanPropSimBatchTimeoutMs,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";
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
  hits: Map<string, { hitProbability: number | null }>,
): boolean {
  const raw = hits.get(propSimKeyForPick(pick, poolRowForPropPick(pick, pool)) ?? "")?.hitProbability ?? null;
  return propHasSimGrade(pick, raw);
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
  };
  /** HR board ranking diagnostics — selected vs next-best components. */
  hrRankDiagnostics?: ReturnType<typeof hrSelectionDiagnostics>;
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

async function simPropBatch(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  teamIdsByGame?: Map<string, GameTeamIds>,
  signal?: AbortSignal,
  batchOpts?: { enrichTimeoutMs?: number },
): Promise<{
  hits: Map<string, { hitProbability: number | null; nullReason?: string | null }>;
  timedOut: boolean;
  playerHistory: Record<string, PlayerHistorySlice>;
}> {
  const out = new Map<string, { hitProbability: number | null; nullReason?: string | null }>();
  if (!batch.length) return { hits: out, timedOut: false, playerHistory: {} };
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
  // Bound local history enrich — unbounded ESPN lookups were the hang that left
  // boardScanPending true forever while Coach sat at 84% Scoring player props.
  // Football skill path uses a longer enrich window so athleteId history can
  // land grades (phone PROP_ALL_NO_SIM_GRADE: 500 deep-simmed, 0 cleared).
  const PROP_ENRICH_TIMEOUT_MS = batchOpts?.enrichTimeoutMs ?? 12_000;
  let enriched: Awaited<ReturnType<typeof enrichCoachPropSimHits>>;
  try {
    enriched = await Promise.race([
      enrichCoachPropSimHits(batch, pool, aliasPropSimHitsForBatch(batch, out), signal),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("prop-enrich-timeout")), PROP_ENRICH_TIMEOUT_MS),
      ),
    ]);
  } catch {
    timedOut = true;
    enriched = { hits: out, playerHistory: {} };
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
    injuryTeams: opts.injuryTeams,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    propSimulations: propHits,
    perfByFamily: opts.perfByFamily,
  });

  for (const pick of scoredPicks) {
    const fp = pickLegFingerprint(pick);
    if (seenFp.has(fp)) continue;
    const simHit = pick.finalAiScore?.simHit ?? null;
    let leg = scoredFromPropPick(pick, simHit, opts.perfByFamily, opts.calibration);
    if (!leg) continue;
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
    propScored.push(leg);
  }
}

function prescorePropRank(pick: ParsedPick, opts?: { hrBoard?: boolean }): number {
  if (opts?.hrBoard || isBatterHomeRunPick(pick)) {
    return hrBoardPrescoreRank(pick);
  }
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
    injuryTeams?: import("./api.ts").InjuryTeam[];
    mlbPlatoon?: Record<string, unknown>;
    mlbGameEnv?: Record<string, unknown>;
    perfByFamily?: Map<string, MarketPerf>;
    calibration?: Map<string, CalibrationBucket>;
    onWave?: (scored: BoardScoredLeg[]) => void;
    onPropBatch?: (size: number, timedOut: boolean, batch?: ParsedPick[]) => void;
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

  const prescorePool = attachPickScores(pool.map(parsedPickFromPoolEntry), {
    realOdds: mergedOdds,
    propPool: pool,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    injuryTeams: opts.injuryTeams,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
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
  const maxToSim = footballSkill
    ? boardScanMaxPropsToSimForMix(opts.target, rankedAll.length)
    : boardScanMaxPropsToSim(opts.target, rankedAll.length);
  // Football skill (mix OR props-only NFL): finishable yards/TD quota set.
  // Generic 500-row board path → phone PROP_ALL_NO_SIM_GRADE (0 grades).
  const { selected: rankedProps } = footballSkill
    ? selectFootballMixPropSimCandidates(rankedAll, maxToSim)
    : selectBoardPropSimCandidates(rankedAll, maxToSim);

  const scoreOpts = {
    pool,
    mergedOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: { ...(opts.playerHistory ?? {}) },
    injuryTeams: opts.injuryTeams,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    perfByFamily: opts.perfByFamily,
    calibration: opts.calibration,
    manifestRecorder: opts.manifestRecorder,
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
    if (signal?.aborted) {
      stoppedEarly = true;
      break;
    }
    if (Date.now() - phaseStartedAt >= phaseDeadlineMs) {
      stoppedEarly = true;
      break;
    }

    const batch = rankedProps.slice(simIndex, simIndex + batchSize);
    simIndex += batch.length;
    const wave = await simPropBatch(batch, pool, opts.teamIdsByGame, signal, {
      enrichTimeoutMs,
    });
    for (const [k, v] of wave.hits) propHits.set(k, v);
    for (const [k, v] of Object.entries(wave.playerHistory)) {
      scoreOpts.playerHistory[k] = v;
    }
    opts.onPropBatch?.(batch.length, wave.timedOut, batch);

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

    if (
      shouldStopPropSimForTicketMix({
        scored: combinedScored(),
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
    /** Stage only player-prop legs (props-only asks). Qual gates unchanged. */
    propsOnly?: boolean;
    /** Drop props from staging (game-lines-only asks). */
    gameLinesOnly?: boolean;
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
  },
): FullBoardScanResult {
  const stagePool = opts.propsOnly
    ? scored.filter((leg) => !!leg.pick.isProp)
    : opts.gameLinesOnly
      ? scored.filter((leg) => !leg.pick.isProp)
      : scored;
  const staged = buildStagedTicketFromScan(
    stagePool,
    opts.target,
    opts.varietySeed,
    {
      ...opts.varietyContext,
      ticketStyle: opts.ticketStyle,
      legsPerGameCap: opts.legsPerGameCap,
    },
  );
  let picks = injectPrioritySportsIntoTicket(
    staged.picks,
    stagePool,
    opts.target,
    opts.prioritySports,
  );
  // When qualified props exist, fill ~40–50% reserved prop slots (TD / pass /
  // rec / rush yards preferred) so gameLines-first combinators cannot ship
  // ML/totals-only tickets.
  if (!opts.gameLinesOnly && !opts.propsOnly) {
    picks = fillReservedPropSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
  }
  // Prop-slot fill can evict soft football injects; restore multi-sport floor after.
  picks = enforceMultiSportFloorOnTicket(
    picks,
    stagePool,
    opts.target,
    opts.prioritySports ?? undefined,
  );
  // Multi-sport floor can displace props — restore the reserved prop mix.
  if (!opts.gameLinesOnly && !opts.propsOnly) {
    picks = fillReservedPropSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
  }
  // Final tickets: if combinators left seats empty while more AI-qualified legs
  // already cleared scoring, top up from those — never invent ungraded filler.
  // Props-first inside topUp; game-line relax only after prop seats get a shot.
  if (!opts.preview && picks.length < opts.target) {
    picks = topUpTicketFromQualifiedScored(
      picks,
      stagePool,
      opts.target,
      opts.varietySeed,
      opts.legsPerGameCap,
    );
    // Top-up may have added game lines first on short tickets — enforce prop mix again.
    if (!opts.gameLinesOnly && !opts.propsOnly) {
      picks = fillReservedPropSlots(picks, stagePool, opts.target, opts.legsPerGameCap);
    }
  }
  // Football mix finals: hold reserved prop seats while props are incomplete;
  // deliver cleared GLs only after the prop phase finished with 0 props.
  let propCount = picks.filter((p) => p.isProp).length;
  const propFraction =
    opts.requirePropMix || isFootballHeavyPickList(picks) ? 0.4 : 0.5;
  if (opts.requirePropMix && !opts.propsOnly && !opts.gameLinesOnly) {
    picks = finalizeFootballPropMixPicks(picks, opts.target, {
      preview: opts.preview,
      propPhaseIncomplete: opts.propPhaseIncomplete,
    });
    propCount = picks.filter((p) => p.isProp).length;
  } else if (
    shouldReservePropSeats({
      preview: opts.preview,
      propsOnly: opts.propsOnly,
      gameLinesOnly: opts.gameLinesOnly,
      targetLegs: opts.target,
      propCount,
      propPhaseIncomplete: opts.propPhaseIncomplete,
      requirePropMix: opts.requirePropMix,
    })
  ) {
    picks = applyReservedPropSeatCap(picks, opts.target, propFraction);
    propCount = picks.filter((p) => p.isProp).length;
  }
  // Preview-only awaiting flag. Finals keep reserved seats via applyReservedPropSeatCap
  // above — never wipe cleared game lines to an instant empty ticket.
  const awaitingPropSlots = shouldKeepAwaitingPropSlots({
    preview: opts.preview,
    propsOnly: opts.propsOnly,
    gameLinesOnly: opts.gameLinesOnly,
    targetLegs: opts.target,
    propCount,
    propPhaseIncomplete: opts.propPhaseIncomplete,
    requirePropMix: opts.requirePropMix,
  });
  const breakdown = staged.breakdown;

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
            { propsOnly: opts.propsOnly },
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
  const noteWithTrace =
    failureReason && !opts.preview && picks.length === 0
      ? `${note}${formatCoachScanFailureTrace(failureReason)}`
      : note;

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

  return {
    picks,
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
  injuryTeams?: import("./api.ts").InjuryTeam[];
  mlbPlatoon?: Record<string, unknown>;
  mlbGameEnv?: Record<string, unknown>;
  perfByFamily?: Map<string, MarketPerf>;
  calibration?: Map<string, CalibrationBucket>;
  signal?: AbortSignal;
  onPartial?: (result: FullBoardScanResult) => void;
  varietySeed?: string;
  varietyContext?: Partial<import("./parlayVarietyMemory.ts").CoachParlayVarietyContext>;
  ticketStyle?: import("./coachTicketQualityTiers.ts").CoachTicketStyle;
  requestId?: string;
  propsOnly?: boolean;
  /** Simulate every eligible prop (HR boards) — do not stop after N qualify. */
  exhaustPropBoard?: boolean;
  /** When set, overrides default max legs per game (game-lines-only / N-game asks). */
  legsPerGameCap?: number;
  /** Drop player props from staging (game lines / alts / periods only). */
  gameLinesOnly?: boolean;
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
  const poolBase = filterBettablePropPool(
    opts.excludedSports?.size ? filterForExcludedSports(opts.propPool, opts.excludedSports) : opts.propPool,
  );
  const oddsGamesRaw = opts.excludedSports?.size
    ? opts.oddsGames.filter((g) => !opts.excludedSports!.has(g.sport))
    : opts.oddsGames;
  const oddsGames = filterBettableOddsGames(oddsGamesRaw);

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
  // liveOdds is RealOddsEntry[] — pass the array as one source. Spreading it
  // fed mergeOddsEntries individual entries; for..of then threw TypeError and
  // tryReachFullBoardScan returned null → phone SCAN_THREW empty tickets.
  const mergedOdds = mergeOddsEntries(
    opts.realOdds,
    opts.liveOdds ?? [],
    ...evalLinesByGame.values(),
  );

  // Expand to the full posted prop board unless the caller already loaded it.
  let pool = filterBettablePropPool(poolBase);
  const poolExpandP =
    opts.espnGames?.length && !opts.skipPropPoolExpand
      ? fetchFullBoardPropPool(oddsGames, opts.espnGames, poolBase, opts.signal)
          .then((rows) => filterBettablePropPool(rows))
          .catch(() => null)
      : null;

  const scored: BoardScoredLeg[] = [];
  let totalScanned = 0;
  let gameLegsScored = 0;
  let gameLegsDroppedNoSim = 0;
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

  // Mid-scan partials must stage from the *current* scored set. Prop waves pass
  // game+prop combined legs — never emit from outer `scored` alone during props,
  // or onPartial stays empty until the final boardExhausted result.
  const emitBoardScanPartial = (legs: BoardScoredLeg[] = scored) => {
    if (!opts.onPartial) return;
    manifestRecorder.recomputeQualificationFromScored(legs);
    const partial = buildScanResult(legs, {
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
      legsPerGameCap: opts.legsPerGameCap,
      requirePropMix: opts.requirePropMix,
      prioritySports: opts.prioritySports,
    });
    if (shouldEmitBoardScanPartial(partial)) opts.onPartial(partial);
  };

  const scoreGamesAndMaybePartial = (games: string[]) => {
    for (const game of games) {
      const lines = evalLinesByGame.get(game);
      if (!lines?.length) continue;
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
        manifestRecorder.recordMarketFound(row.pick);
        const simHit = gameSimHitForPick(row.pick, sim);
        if (sim) manifestRecorder.recordGameLineSimulated();
        const leg = scoredFromEvalRow(row, opts.perfByFamily, simHit, opts.calibration);
        if (leg) {
          scored.push(leg);
          if (!leg.pick.isProp) gameLegsScored += 1;
        } else {
          // Always record — missing sims used to drop silently and look like a quality-bar miss.
          manifestRecorder.recordPreScoreGateFailure(row.pick, {
            ...row.finalAiScore,
            simHit: simHit ?? row.finalAiScore.simHit ?? null,
          });
          if (!sim) gameLegsDroppedNoSim += 1;
        }
      }
    }
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
      manifestRecorder.recordPropPoolRow(parsedPickFromPoolEntry(entry));
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
      perfByFamily: opts.perfByFamily,
      calibration: opts.calibration,
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
        onWave: (combined) => {
          emitBoardScanPartial(combined);
        },
        onPropBatch: (size, timedOut, batch) => {
          // Fail-safe: batch football counters must never abort the prop sim loop.
          safeCoachManifestInstrument("onPropBatch-manifest", () => {
            manifestRecorder.recordPropSimBatch(size, timedOut, batch);
          });
        },
        manifestRecorder,
      },
      opts.signal,
    );
  };

  // Football mix rebuild: PROPS-FIRST on a finishable skill set (~80 rows with
  // yards/TD quotas), THEN game lines. Parallel props∥games (#530/#533) let GLs
  // clear while the 360-row deep-sim timed out → phone "holding reserved prop
  // seats" with 0 skill props. Serial on a huge cap (#532) never finished either.
  let propPhaseP: Promise<{
    propScored: BoardScoredLeg[];
    propHits: Map<string, { hitProbability: number | null }>;
    simEvaluated: number;
    incomplete: boolean;
  } | null> | null = null;
  const propsOnlyPath = !!opts.propsOnly;
  const footballMixPath = !!opts.requirePropMix && !propsOnlyPath;

  if (footballMixPath && pool.length > 0) {
    try {
      const propResult = await runPropPhase(pool);
      propScoredAcc = propResult.propScored;
      propSimEvaluatedAcc += propResult.simEvaluated;
      if (propResult.incomplete) propPhaseIncomplete = true;
    } catch {
      propPhaseIncomplete = true;
    }
  } else if (propsOnlyPath) {
    propPhaseP = runPropPhase(pool)
      .then((r) => r)
      .catch(() => {
        propPhaseIncomplete = true;
        return null;
      });
  } else if (overlapProps) {
    // Prefetched non-football pools still overlap props with games.
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
  if (!opts.propsOnly) {
    gameSimsAttempted = gameEntries.length > 0;
    const gamePhaseBudgetMs =
      footballMixPath || overlapProps
        ? Math.max(
            footballMixPath
              ? boardScanMixGamePhaseBudgetMs(opts.target)
              : boardScanGamePhaseBudgetMs(opts.target),
            footballMixPath ? 36_000 : 48_000,
          )
        : null;
    const gamePhaseStartedAt = Date.now();
    const SLATE_SIM_BATCH_REBUILD = footballMixPath || opts.requirePropMix ? 4 : SLATE_SIM_BATCH;
    for (let i = 0; i < gameEntries.length; i += SLATE_SIM_BATCH_REBUILD) {
      if (opts.signal?.aborted) break;
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
        scoreGamesAndMaybePartial(batch.map(([game]) => game));
      } catch {
        // Keep scanning remaining games + props. A thrown slate batch used to
        // abort buildTopLegsFromFullBoardScan → tryReachFullBoardScan(null) →
        // instant 0-of-N on phone.
        gameSimsFetchNull += batch.length;
        continue;
      }
    }
  }

  const expandedPool = await Promise.race([
    poolExpandP ?? Promise.resolve(null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000)),
  ]);
  if (expandedPool?.length) pool = expandedPool;

  if (footballMixPath) {
    // Props already ran first; only rescore if expand grew an empty skill wave.
    if (propScoredAcc.length === 0 && pool.length > 0 && expandedPool?.length) {
      try {
        const propResult = await runPropPhase(pool);
        propScoredAcc = propResult.propScored;
        propSimEvaluatedAcc += propResult.simEvaluated;
        if (propResult.incomplete) propPhaseIncomplete = true;
      } catch {
        propPhaseIncomplete = true;
      }
    }
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
  };
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
    propsOnly: opts.propsOnly,
    gameLinesOnly: opts.gameLinesOnly,
    legsPerGameCap: opts.legsPerGameCap,
    propPhaseIncomplete,
    requirePropMix: opts.requirePropMix,
    failureDiagnostics,
    prioritySports: opts.prioritySports,
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
    return null;
  }
}
