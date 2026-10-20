import { beginCoachPropAuditForeground, createCoachPropAudit, propAuditKey, type CoachPropAudit } from "../coachPropAudit.ts";
import { persistCoachPropAudit } from "../coachPropAuditStore.ts";
import { parsedPickFromPoolEntry } from "../propSelection.ts";
import { isAutomaticFreeCoachAsk } from "../coachSmallTicketCompletion.ts";
import { preparedEnvironmentForGames, filterPreparedDeliveryPicks } from "@/lib/preparedGameContext";
import { coachContextWarmer } from "@/lib/coachContextWarmup";
import { filterUngroundedCoachPropPool } from "@/lib/coachPreSimGrounding";
/**
 * Greenfield parlay build — board scan only, hard wall-clock, no delivery limbo.
 *
 * Must load the full posted prop board (mains + alts) BEFORE scoring. An empty
 * propPool was the "2 game totals for a 5-leg" bug: game lines finished first,
 * absolute budget latched, props never scored.
 */

import type { ParsedPick } from "@/components/PickCard";
import {
  fetchBoardMatchupHistory,
  fetchFullBoardPropPool,
  getGames,
  getLiveOdds,
  getOdds,
  type EspnGame,
  type MatchupHistoryEntry,
  type OddsGame,
  type PropPoolEntry,
  type RealOddsEntry,
} from "@/lib/api";
import { discoverAllPostedGameLines } from "@/lib/postedMarketDiscovery";
import {
  tryReachFullBoardScan,
  type FullBoardScanResult,
} from "@/lib/boardMarketScanner";
import {
  buildFinalCoachParlayNote,
  buildFixedLegPropsPendingShortfallLead,
  selectFinalCoachParlayPicks,
  askRequiresFootballPropMix,
  askAllowsNcaafPlayerProps,
  askAllowsCollegeTeamMarketStacks,
  filterNcaafPlayerPropsUnlessAsked,
  propsOnlySportLabelFromAsk,
  finalizeFootballPropMixPicks,
  finalizeGeneralPropMixPicks,
} from "@/lib/boardScanPropDelivery";
import {
  askWantsAllNewPicks,
  recentParlayVarietyContext,
  rememberParlayBuild,
} from "@/lib/parlayVarietyMemory";
import { dedupePicksByMarketLadder } from "@/lib/marketLadderKey";
import { shouldBuildFootballPropsOnlyTicket } from "@/lib/coachFootballPropsOnly";
import { buildFootballPropsOnlyTicket } from "@/lib/coachFootballPropsOnlyTicket";
import { isRareCountPropMarket } from "@/lib/rareCountPropModel";
import { rareMultiCountLotteryPathOpen } from "@/lib/rareMultiCountCoachGate";
import { detectCoachTicketStyle } from "@/lib/coachTicketQualityTiers";
import { buildGameTeamIdMap } from "@/lib/coachGameMonteCarlo";
import {
  armDeadlineAbort,
  coachPastRequestDeadline,
  coachPhaseBudgetMs,
  coachRemainingBudgetMs,
  coachTimeoutRootCause,
  coachTotalRequestBudgetMs,
  createCoachRequestTiming,
  finalizeCoachRequestTiming,
  markCoachPhase,
  markCoachPending,
  type CoachRequestTiming,
} from "@/lib/coach/coachRequestDeadline";
import { shouldSkipScannerPropExpand } from "@/lib/coach/propPoolPolicy";
import { prioritySportsForAsk } from "@/lib/chatContextPriority";
import { classifySportCategoryFromAsk } from "@/lib/coachReliabilityClassify";
import { reportCoachScanReliability } from "@/lib/coachReliabilityReporter";
import {
  createCoachPerfCounters,
  resolveCoachClientUpdateId,
} from "@/lib/coachPerfDiagnostics";
import { applyDeliveryGroundingGate } from "@/lib/coachDeliveryGrounding";
import { revalidateCoachTerminalDeliveryPicks } from "@/lib/coachTicketHold";
import {
  BLOCKED_UNVALIDATED_MARKET_REASON,
  ncaafGameLineAskIsP0Blocked,
  p0BlockedNcaafGameLineAskNote,
  P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
} from "@/lib/coachP0UnvalidatedTotals";
import {
  slateAwarePrioritySports,
  sportsPresentOnSlate,
} from "@/lib/coachPrioritySports";
import { coachBoardSportsForAsk } from "@/lib/coachPropBoardCoverage";
import {
  coachAskTeamMissNote,
  coachAskTeamScope,
  coachAskTeamShortfallNote,
  buildCoachTeamGameScopeDiagnostics,
  excludedTeamScopesFromText,
  filterOddsGamesForCoachAskTeams,
  filterPicksForCoachAskTeams,
  resolveExcludedTeamIdsFromGames,
  type CoachAskExcludedTeam,
  type CoachTeamGameScopeDiagnostics,
} from "@/lib/coachAskTeamScope";
import { DEFAULT_SPORTS } from "@/lib/sports";
import {
  filterBettableOddsGames,
  filterOddsForSlateDay,
  filterOddsGamesForSlateDay,
  filterPicksForSlateDay,
  slateDayFromThread,
  type SlateDay,
} from "@/lib/slate";
import { sanitizeCoachUserNote } from "@/lib/sanitizeCoachUserNote";
import {
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
} from "@/lib/coachAskMarketFilter";
import {
  filterPoolByFootballRecoverySports,
  filterPoolForFootballSkillRecovery,
  footballSkillRecoveryNote,
  shouldRecoverPropsOnlyWithFootballSkillBoard,
} from "@/lib/coachFootballPropsOnlyRecovery";
import {
  filterPicksByAllowedSports,
  filterPoolByAllowedSports,
  hardLockedSportsFromAsk,
  resolveImmutableAskSportScope,
} from "@/lib/coachAskSportScope";
import {
  preferPropsOnlyFailDiag,
  propsOnlyTerminalEmptyNote,
  reconcileCoachTerminalNote,
} from "@/lib/coachPropsOnlyFailReason";
import { COACH_SIM_MIN_CONFIDENCE } from "@/lib/gameSimQualityGates";
import {
  lockedMarketLabelForAsk,
  lockedMarketQualityShortfallNote,
  lockedMarketAnalyzedFromBoardDiagnostics,
  resolveCoachParlayShortfallLead,
} from "@/lib/lockedMarketQualityShortfall";
import {
  enforceMlLeanOnPicks,
  mlLeanEnforcementNote,
} from "@/lib/mlLeanEnforcement";
import { topUpAfterMlLean } from "@/lib/postLeanFinalFill";
import { marketFamily } from "@/components/PickCard";
import { coachPropsAskGameLineMismatchNote } from "@/lib/coach/parseAsk";
import { legsPerGameCapForAsk } from "@/lib/parlayCorrelationScore";
import { filterHrScorerPoolEntries, isBatterHomeRunMarket } from "@/lib/coachHrRank";
import { loadMlbScanContext } from "@/lib/mlbScanContext";
import { loadFootballScanContext } from "@/lib/footballScanContext";
import {
  attachMatchupInjuries,
  loadBoardInjuries,
  prefetchPropPlayerHistory,
} from "@/lib/coachBoardContext";
import { loadFootballOppRushDefense } from "@/lib/footballOppDefenseContext";


export type CoachParlayBuildResult = {
  picks: ParsedPick[];
  note: string;
  scan: FullBoardScanResult | null;
  timedOut: boolean;
  propPoolSize: number;
  /** Team-scoped ask funnel diagnostics ("4 leg Troy"). */
  teamGameScopeDiagnostics?: CoachTeamGameScopeDiagnostics | null;
  /** Props-only empty/short diagnosis — logs / reliability; never chat copy. */
  failDiag?: import("@/lib/coachPropsOnlyFailReason").PropsOnlyFailDiag;
  /** Shared greenfield id for assembly + UI delivery-commit telemetry. */
  reliabilityRequestId?: string;
  /** Monotonic request timing (observe-only). */
  timing?: CoachRequestTiming;
  /** Observe-only funnel/perf counters for delivery-commit telemetry. */
  perf?: ReturnType<typeof createCoachPerfCounters>;
};

export { shouldSkipScannerPropExpand } from "./propPoolPolicy";

function realOddsFromOddsGames(oddsGames: OddsGame[]): RealOddsEntry[] {
  // Use the same humanized market titles + pick strings as the full eval ladder
  // ("Q2 Spread", "Jayhawks -7.5") — never raw Odds API keys like "spreads_q2"
  // (phone badges were showing SPREADS / SPREADS_Q2).
  const out: RealOddsEntry[] = [];
  for (const g of oddsGames) {
    out.push(...discoverAllPostedGameLines(g));
  }
  return out;
}

function countPropLike(picks: ParsedPick[]): number {
  return picks.filter((p) => !!p.isProp).length;
}

async function loadScanInputs(
  signal: AbortSignal,
  requestedLegs: number,
  askText: string | null | undefined,
  onStatus?: (status: string) => void,
  priorUserTexts: string[] = [],
): Promise<{
  espnGames: EspnGame[];
  oddsGames: OddsGame[];
  propPool: PropPoolEntry[];
  rawPropPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  liveOdds: RealOddsEntry[];
  sports: string[];
  prioritySports: readonly string[];
  teamScope: ReturnType<typeof coachAskTeamScope>;
  excludedTeams: CoachAskExcludedTeam[];
  slateDay: SlateDay;
  /** Games loaded for the board before franchise filter (same sports). */
  oddsGamesBeforeTeamFilter: OddsGame[];
}> {
  // Named league(s) scope the board (CFB stays CFB). Generic asks union every
  // player-prop league (incl. ncaab) so mains+alts across sports enter the pool.
  const sports = coachBoardSportsForAsk(askText, requestedLegs, DEFAULT_SPORTS);
  const askPrioritySports = prioritySportsForAsk(askText);
  onStatus?.(
    sports.length === 1
      ? `Loading ${sports[0]!.toUpperCase()} board…`
      : "Loading tonight's board…",
  );
  const [espnGamesRaw, oddsRaw, liveFeed] = await Promise.all([
    Promise.all(sports.map((s) => getGames(s, signal).catch(() => [] as EspnGame[]))).then((rows) =>
      rows.flat(),
    ),
    Promise.all(sports.map((s) => getOdds(s, signal).catch(() => [] as OddsGame[]))).then((rows) =>
      filterBettableOddsGames(rows.flat()),
    ),
    getLiveOdds(sports, signal).catch(() => ({ games: [], odds: [] as RealOddsEntry[] })),
  ]);

  // "6 leg Saints" / "4 leg Troy" → keep only that franchise's matchup.
  // "6 leg NHL not the ducks" → drop the entire excluded matchup (both clubs).
  // Sport scoping alone still allowed other NFL games to fill a team ask.
  const teamScope = coachAskTeamScope(askText);
  let excludedTeams = excludedTeamScopesFromText(askText);
  excludedTeams = resolveExcludedTeamIdsFromGames(excludedTeams, espnGamesRaw);
  const oddsGamesBeforeTeamFilter = oddsRaw;
  let oddsGames = filterOddsGamesForCoachAskTeams(oddsRaw, teamScope, excludedTeams);
  let espnGames = filterOddsGamesForCoachAskTeams(espnGamesRaw, teamScope, excludedTeams);

  // "7 leg for today" / "tonight" / "tomorrow" — restrict the board BEFORE props
  // and game lines are discovered so recovery/top-up cannot reintroduce other days.
  // Bare "7 leg" keeps the existing 48h bettable window (slateDay null).
  const slateDay = slateDayFromThread(askText ?? "", priorUserTexts);
  oddsGames = filterOddsGamesForSlateDay(oddsGames, slateDay);
  espnGames = filterOddsForSlateDay(espnGames, slateDay);

  // Generic asks: prioritize leagues that actually have upcoming events + odds
  // (NHL/WNBA/tennis on a thin tonight slate — not empty NFL/NCAAF inject).
  const prioritySports = slateAwarePrioritySports(
    askPrioritySports,
    sportsPresentOnSlate(oddsGames),
  );

  onStatus?.("Loading player props and alt lines across the board…");
  let propPool = await fetchFullBoardPropPool(oddsGames, espnGames, [], signal).catch(
    () => [] as PropPoolEntry[],
  );
  const rawPropPool = propPool;
  // Belt: drop any row whose kickoff slipped outside the requested local day.
  propPool = filterOddsForSlateDay(propPool, slateDay);
  // Exclusions already removed games before prop fetch; belt-and-suspenders on
  // pool rows so a stale basePool cannot reintroduce an excluded matchup.
  propPool = filterPicksForCoachAskTeams(propPool, teamScope, excludedTeams);

  const liveOdds = filterPicksForCoachAskTeams(
    filterOddsForSlateDay(liveFeed.odds ?? [], slateDay),
    teamScope,
    excludedTeams,
  );

  return {
    espnGames,
    oddsGames,
    propPool,
    rawPropPool,
    realOdds: realOddsFromOddsGames(oddsGames),
    liveOdds,
    sports,
    prioritySports,
    teamScope,
    excludedTeams,
    slateDay,
    oddsGamesBeforeTeamFilter,
  };
}

async function buildCoachParlayImpl(opts: {
  propAudit?: CoachPropAudit;
  requestedLegs: number;
  /** User ask — scopes sports (college football) and priority inject. */
  askText?: string | null;
  /** Prior user turns — inherit props-only like tonight/tomorrow slate. */
  priorUserTexts?: string[];
  signal: AbortSignal;
  onStatus?: (status: string) => void;
  onPartialPicks?: (picks: ParsedPick[]) => void;
  /**
   * Fires after prop/alt board + context load. UI must NOT reset the absolute
   * clock here — the monotonic deadline already includes load time.
   */
  onReadyToScan?: (info: { propPoolSize: number }) => void;
  /** Shared request start (UI beginCoachSession). Defaults to now. */
  requestStartedAtMs?: number;
  /** Shared greenfield id for delivery-commit correlation. */
  reliabilityRequestId?: string;
}): Promise<CoachParlayBuildResult> {
  const target = Math.max(1, Math.min(opts.requestedLegs || 6, 15));
  const budgetMs = coachTotalRequestBudgetMs(target);
  // Monotonic deadline from request start — load counts against this window.
  const requestStartedAtMs = opts.requestStartedAtMs ?? Date.now();
  const timing = createCoachRequestTiming({ requestStartedAtMs, budgetMs });
  let deliveryTerminalized = false;

  // Observe-only reliability markers — created before the P0 early exit /
  // loadScanInputs so the blocked path can emit without slate sims.
  const coachRelStarted = requestStartedAtMs;
  const coachRelRequestId =
    (opts.reliabilityRequestId && String(opts.reliabilityRequestId).trim()) ||
    `greenfield-${Date.now()}`;
  const coachRelSport = classifySportCategoryFromAsk(opts.askText ?? "");

  const perf = createCoachPerfCounters({
    requestedSport: coachRelSport || null,
  });
  const reportTimingFields = () => {
    finalizeCoachRequestTiming(timing);
    const rc = coachTimeoutRootCause(timing);
    return {
      loadMs: timing.loadMs,
      // enrichmentMs = context Promise.all wall (not a sum of parallel legs).
      enrichmentMs: timing.contextMs,
      scanMs: timing.scanMs,
      finalizationMs: timing.finalizationMs,
      propSimMs: perf.propSimMs,
      gameSimMs: perf.gameSimMs,
      qualificationMs: perf.qualificationMs,
      totalMs: timing.totalMs,
      lastCompletedPhase: timing.lastCompletedPhase,
      pendingOperation: timing.pendingOperation,
      timeoutReason: timing.timeoutReason,
      rootCause: rc?.rootCause ?? undefined,
      rootCauseGrade: rc?.rootCauseGrade ?? undefined,
      durationMs: timing.totalMs ?? Date.now() - coachRelStarted,
      requestedSport: perf.requestedSport ?? coachRelSport,
      effectiveSports: perf.effectiveSports,
      candidatesPoolBefore: perf.candidatesPoolBefore,
      candidatesPoolAfter: perf.candidatesPoolAfter,
      candidatesSelected: perf.candidatesSelected,
      deepSimRequested: perf.deepSimRequested,
      deepSimCompleted: perf.deepSimCompleted,
      qualifiedCount: perf.qualifiedCount,
      updateId: resolveCoachClientUpdateId(),
    };
  };

  // Ask-only gate — before loadScanInputs / slate sims. Bare "6 leg NCAAF" /
  // "8 leg college" is gameLinesOnly + NCAAF-locked; every FG market is P0
  // while NCAAF_GAME_LINE_SIM_VALIDATED=false, so waiting on slate sims only stalls.
  {
    const earlyConstraint = parseCoachAskMarketConstraint(
      opts.askText,
      opts.priorUserTexts ?? [],
    );
    const earlyPropsOnly = earlyConstraint.propsOnly;
    const earlyGameLinesOnly = earlyConstraint.gameLinesOnly && !earlyPropsOnly;
    const earlyLockedSports = hardLockedSportsFromAsk(opts.askText);
    if (
      ncaafGameLineAskIsP0Blocked({
        gameLinesOnly: earlyGameLinesOnly,
        lockedSports: earlyLockedSports,
      })
    ) {
      opts.onStatus?.("College game lines blocked (unvalidated simulation)…");
      // Short fixed copy only — no long clarification / quality-bar wording.
      const note = sanitizeCoachUserNote(p0BlockedNcaafGameLineAskNote(target));
      markCoachPhase(timing, "terminal");
      reportCoachScanReliability({
        requestId: coachRelRequestId,
        sportCategory: coachRelSport || "ncaaf",
        requestedLegCount: target,
        returnedLegCount: 0,
        realOddsAvailable: null,
        picks: [],
        deliveryCommitted: false,
        // Digest-visible policy block — not a scan/qualification/fulfillment miss.
        eventType: "parlay_zero_results",
        failureReason: BLOCKED_UNVALIDATED_MARKET_REASON,
        rootCause: P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
        ...reportTimingFields(),
      });
      return {
        picks: [],
        note,
        scan: null,
        timedOut: false,
        propPoolSize: 0,
        reliabilityRequestId: coachRelRequestId,
        timing,
        perf,
      };
    }
  }

  markCoachPending(timing, "load");
  const loadStarted = Date.now();
  const loadArm = armDeadlineAbort({
    parent: opts.signal,
    remainingMs: coachRemainingBudgetMs(requestStartedAtMs, budgetMs),
  });
  let inputs: Awaited<ReturnType<typeof loadScanInputs>>;
  try {
    inputs = await loadScanInputs(
      loadArm.signal,
      target,
      opts.askText,
      opts.onStatus,
      opts.priorUserTexts ?? [],
    );
  } finally {
    loadArm.dispose();
  }
  markCoachPhase(timing, "load", Date.now() - loadStarted);

  if (opts.signal.aborted || loadArm.signal.aborted) {
    const timedOut =
      !opts.signal.aborted &&
      coachPastRequestDeadline(requestStartedAtMs, budgetMs);
    if (timedOut) {
      timing.timedOut = true;
      timing.timeoutReason = "load_deadline";
    }
    deliveryTerminalized = true;
    reportCoachScanReliability({
      requestId: coachRelRequestId,
      sportCategory: coachRelSport,
      requestedLegCount: target,
      returnedLegCount: 0,
      realOddsAvailable: null,
      picks: [],
      timedOut,
      cancelled: opts.signal.aborted && !timedOut,
      deliveryCommitted: false,
      ...reportTimingFields(),
    });
    return {
      picks: [],
      note: timedOut
        ? "Hit the delivery budget while loading the board — composer unlocked."
        : "",
      scan: null,
      timedOut,
      propPoolSize: 0,
      reliabilityRequestId: coachRelRequestId,
      timing,
      perf,
    };
  }

  // Yards asks ("rushing and passing yards") → props-only + market allowlist.
  // Does not change hold/delivery — only which markets enter the scan pool.
  const marketConstraint = parseCoachAskMarketConstraint(
    opts.askText,
    opts.priorUserTexts ?? [],
  );
  const scanPropPool = filterPropPoolByAskMarkets(
    inputs.propPool,
    marketConstraint.allowedMarketKeys,
    marketConstraint,
  );
  const propsOnly = marketConstraint.propsOnly;
  const gameLinesOnly = marketConstraint.gameLinesOnly && !propsOnly;
  const excludeTotals = marketConstraint.excludeTotals && !propsOnly;
  // Drop Over/Under totals from the odds board when the book/user has no O/U.
  const scanRealOdds = excludeTotals
    ? inputs.realOdds.filter((r) => marketFamily(r.market) !== "total")
    : inputs.realOdds;
  const scanLiveOdds = excludeTotals
    ? inputs.liveOdds.filter((r) => marketFamily(r.market) !== "total")
    : inputs.liveOdds;
  // "10 leg nfl" — not props-only, but props must be scored first and seats reserved.
  const requirePropMix =
    !propsOnly &&
    !gameLinesOnly &&
    askRequiresFootballPropMix(opts.askText);
  const collegeTeamMarketStacks = askAllowsCollegeTeamMarketStacks(opts.askText);
  const legsPerGameCap = legsPerGameCapForAsk(target, {
    gameLinesOnly,
    maxGames: marketConstraint.maxGames,
    collegeTeamMarketStacks,
  });
  // Game-lines-only asks skip the prop board entirely.
  const constrainedPropPool = gameLinesOnly ? [] : scanPropPool;
  // College books mostly post team markets — drop NCAAF player props unless
  // the ask named yards / TD / player props (mixed "soccer and college" still
  // keeps soccer props; only CFB player rows are stripped — even on props-only
  // soccer paths that would otherwise pull CFB yards from the board).
  const collegeTeamPropPool = askAllowsNcaafPlayerProps(opts.askText)
    ? constrainedPropPool
    : filterNcaafPlayerPropsUnlessAsked(constrainedPropPool, opts.askText);
  // Immutable league belt — explicit NFL/NCAAF never admit the other league;
  // multi-sport boards keep inputs.sports. Applied before sim/seat/recovery.
  const askSportScope = {
    allowedSports: resolveImmutableAskSportScope({
      askText: opts.askText,
      boardSports: inputs.sports,
    }),
  };
  perf.effectiveSports = askSportScope.allowedSports.length
    ? [...askSportScope.allowedSports]
    : null;
  const scopedPropPool = filterPoolByAllowedSports(
    collegeTeamPropPool,
    askSportScope,
  );
  const hrBoardAsk =
    propsOnly &&
    (marketConstraint.allowedMarketKeys ?? []).some((k) => isBatterHomeRunMarket(k));
  let mlbPlatoon: Record<string, unknown> | undefined;
  let mlbGameEnv: Record<string, unknown> | undefined;
  // Home-run asks want scorers — drop Under/No so MC budget hits Over 0.5.
  const activePropPool = filterUngroundedCoachPropPool(
    hrBoardAsk ? filterHrScorerPoolEntries(scopedPropPool) : scopedPropPool,
    inputs.espnGames,
  );
  const propPoolSize = activePropPool.length;
  if (opts.propAudit) {
    const keys = (pool: PropPoolEntry[]) => new Set(pool.map(e => propAuditKey(parsedPickFromPoolEntry(e))));
    const inputKeys = keys(inputs.propPool), marketKeys = keys(scanPropPool), collegeKeys = keys(collegeTeamPropPool), sportKeys = keys(scopedPropPool), active = keys(activePropPool);
    for (const entry of inputs.rawPropPool) {
      const p = parsedPickFromPoolEntry(entry), key = propAuditKey(p);
      opts.propAudit.observe(p, "posted", "posted");
      const reason = !inputKeys.has(key) ? "slate_day_or_team_scope_excluded" : !marketKeys.has(key) ? "request_market_excluded" : gameLinesOnly ? "game_lines_only_request" : !collegeKeys.has(key) ? "college_player_props_not_requested" : !sportKeys.has(key) ? "request_sport_scope_excluded" : !active.has(key) ? "scorer_side_or_player_game_grounding_gate" : "eligible";
      opts.propAudit.observe(p, reason === "eligible" ? "eligible" : "scope_excluded", reason);
    }
  }

  const hasMlbProps = activePropPool.some(
    (e) => String(e.sport ?? "").toLowerCase() === "mlb",
  );
  const boardSports = [
    ...new Set(
      [
        ...inputs.sports,
        ...activePropPool.map((e) => String(e.sport ?? "").toLowerCase()),
        ...inputs.espnGames.map((g) => String(g.sport ?? "").toLowerCase()),
      ].filter(Boolean),
    ),
  ];
  const needFootballWx = boardSports.some((s) => s === "nfl" || s === "ncaaf");
  // Injuries + football weather/coaches + opp-D + (any MLB props) platoon —
  // all in parallel so we don't add sequential wall time before scoring.
  opts.onStatus?.(
    gameLinesOnly || !propsOnly
      ? "Loading matchups, injuries, and opponent context…"
      : (hrBoardAsk || hasMlbProps) && activePropPool.length > 0
        ? "Loading matchup, injuries, and recent form…"
        : needFootballWx
          ? "Loading injuries, weather, and coach context…"
          : "Loading injury context…",
  );
  markCoachPending(timing, "context");
  const contextStarted = Date.now();
  const contextArm = armDeadlineAbort({
    parent: opts.signal,
    remainingMs: coachRemainingBudgetMs(requestStartedAtMs, budgetMs),
  });
  const contextSignal = contextArm.signal;
  const contextPromise = Promise.all([
    loadBoardInjuries(boardSports, contextSignal).catch(() => ({
      injuriesBySport: {} as Record<string, import("@/lib/api").InjuryTeam[]>,
      matchupInjuries: {} as Record<string, import("@/lib/injuries").GameInjuryReport>,
      injuryTeams: [] as import("@/lib/api").InjuryTeam[],
    })),
    hasMlbProps && activePropPool.length > 0
      ? loadMlbScanContext({
          propPool: activePropPool,
          espnGames: inputs.espnGames,
          hrOnly: hrBoardAsk,
          maxBatters: hrBoardAsk ? 32 : 16,
          signal: contextSignal,
        }).catch(() => ({ mlbPlatoon: {}, mlbGameEnv: {} }))
      : Promise.resolve({ mlbPlatoon: {}, mlbGameEnv: {} }),
    (hrBoardAsk || hasMlbProps) && activePropPool.length > 0
      ? prefetchPropPlayerHistory(activePropPool, {
          signal: contextSignal,
          maxPlayers: hrBoardAsk ? 24 : 16,
          concurrency: 6,
        }).catch(() => ({}))
      : Promise.resolve({} as Record<string, import("@/lib/pickScoreContext").PlayerHistorySlice>),
    boardSports.some((s) =>
      ["nfl", "ncaaf", "nba", "wnba", "ncaab", "nhl", "soccer", "mlb"].includes(s),
    )
      ? loadFootballOppRushDefense({
          espnGames: inputs.espnGames,
          signal: contextSignal,
        }).catch(() => ({}))
      : Promise.resolve({} as import("@/lib/footballOppDefenseContext").FootballOppDefenseMap),
    needFootballWx
      ? loadFootballScanContext({
          espnGames: inputs.espnGames,
          sports: boardSports,
          signal: contextSignal,
        }).catch(() => ({ footballGameEnv: {} }))
      : Promise.resolve({ footballGameEnv: {} }),
    // Game-line / mixed tickets need mlLean opponent comparison (NFL parity).
    !propsOnly || gameLinesOnly
      ? fetchBoardMatchupHistory({
          espnGames: inputs.espnGames,
          realOdds: scanRealOdds,
          signal: contextSignal,
          focalText: opts.askText,
          matchupCap: gameLinesOnly ? 20 : 12,
        }).catch(() => ({} as Record<string, MatchupHistoryEntry>))
      : Promise.resolve({} as Record<string, MatchupHistoryEntry>),
  ]);

  const [injuryPack, mlb, earlyHistory, oppRushDefense, football, matchupHistoryRaw] =
    await contextPromise;
  contextArm.dispose();
  markCoachPhase(timing, "context", Date.now() - contextStarted);

  if (
    opts.signal.aborted ||
    contextSignal.aborted ||
    coachPastRequestDeadline(requestStartedAtMs, budgetMs)
  ) {
    const timedOut =
      !opts.signal.aborted &&
      coachPastRequestDeadline(requestStartedAtMs, budgetMs);
    if (timedOut) {
      timing.timedOut = true;
      timing.timeoutReason = "context_deadline";
    }
    deliveryTerminalized = true;
    reportCoachScanReliability({
      requestId: coachRelRequestId,
      sportCategory: coachRelSport,
      requestedLegCount: target,
      returnedLegCount: 0,
      realOddsAvailable:
        (inputs.realOdds?.length ?? 0) > 0 || (inputs.oddsGames?.length ?? 0) > 0,
      picks: [],
      timedOut,
      cancelled: opts.signal.aborted && !timedOut,
      deliveryCommitted: false,
      ...reportTimingFields(),
    });
    return {
      picks: [],
      note: timedOut
        ? "Hit the delivery budget while loading matchup context — composer unlocked."
        : "",
      scan: null,
      timedOut,
      propPoolSize,
      reliabilityRequestId: coachRelRequestId,
      timing,
      perf,
    };
  }

  const matchupInjuries = attachMatchupInjuries(
    inputs.espnGames,
    injuryPack.injuriesBySport,
  );
  const injuryTeams = injuryPack.injuryTeams;
  mlbPlatoon = Object.keys(mlb.mlbPlatoon).length ? mlb.mlbPlatoon : undefined;
  const mergedEnv = preparedEnvironmentForGames(inputs.espnGames, {
    ...(mlb.mlbGameEnv ?? {}),
    ...(football.footballGameEnv ?? {}),
  });
  mlbGameEnv = Object.keys(mergedEnv).length ? mergedEnv : undefined;
  const playerHistory = Object.keys(earlyHistory).length ? earlyHistory : undefined;
  const matchupHistory = Object.keys(matchupHistoryRaw).length
    ? matchupHistoryRaw
    : undefined;

  opts.onReadyToScan?.({ propPoolSize });
  opts.onStatus?.(
    propPoolSize > 0
      ? propsOnly
        ? `Scanning ${propPoolSize} posted props/alts for a ${target}-leg ticket…`
        : requirePropMix
          ? `Scanning ${propPoolSize} posted props/alts with game lines (prop seats reserved)…`
          : `Scanning ${propPoolSize} posted props/alts plus game lines for a ${target}-leg ticket…`
      : propsOnly
        ? `No matching props posted for a ${target}-leg ticket…`
        : `Scanning posted game lines for a ${target}-leg ticket…`,
  );

  const teamIdMap = buildGameTeamIdMap(inputs.espnGames);

  // coachRel* markers created at function entry (before P0 early exit).

  // Greenfield props-only rebuild — dedicated local-first history/EV pipeline
  // for EVERY props-only ask (NFL, WNBA, multi-sport). The football-only ≥50%
  // gate used to skip this path on afternoon WNBA boards → generic board scan
  // staged ~3/8 with "4 signals missing" confidence wipe.
  if (
    propsOnly &&
    !hrBoardAsk &&
    shouldBuildFootballPropsOnlyTicket({ propsOnly: true, pool: activePropPool })
  ) {
    // Explicit rare-market locks ("5 stolen bases", "home run longshots" that
    // still hit this path) may stack same-event rare seats. Generic mixed asks
    // keep one rare-family seat per event.
    const lockedKeys = marketConstraint.allowedMarketKeys;
    const allowRareCountFamilyStack =
      lockedKeys != null &&
      lockedKeys.length > 0 &&
      lockedKeys.every((k) => isRareCountPropMarket(k));
    const propsOnlyTicketStyle = detectCoachTicketStyle(opts.askText ?? "");
    const allowRareMultiCount = rareMultiCountLotteryPathOpen({
      askText: opts.askText,
      ticketStyle: propsOnlyTicketStyle,
    });
    markCoachPending(timing, "props_only");
    const propsOnlyStarted = Date.now();
    const propsArm = armDeadlineAbort({
      parent: opts.signal,
      remainingMs: coachRemainingBudgetMs(requestStartedAtMs, budgetMs),
    });
    const built = await buildFootballPropsOnlyTicket({
      propAudit: opts.propAudit,
      target,
      pool: activePropPool,
      realOdds: inputs.realOdds,
      teamIdMap,
      signal: propsArm.signal,
      onStatus: opts.onStatus,
      playerHistory,
      oppRushDefense,
      espnGames: inputs.espnGames,
      mlbPlatoon,
      mlbGameEnv,
      allowRareCountFamilyStack,
      askText: opts.askText,
      ticketStyle: propsOnlyTicketStyle,
      allowRareMultiCount,
      allowedSports: askSportScope.allowedSports,
      onPartialPicks: (picks) => {
        if (deliveryTerminalized) return;
        opts.onPartialPicks?.(
          filterPicksByAllowedSports(
            filterPicksForCoachAskTeams(
              filterPicksByAskMarketConstraint(picks, marketConstraint),
              inputs.teamScope,
              inputs.excludedTeams,
            ),
            askSportScope,
            inputs.espnGames,
          ),
        );
      },
    });
    propsArm.dispose();
    markCoachPhase(timing, "props_only", Date.now() - propsOnlyStarted);
    if (built.perf) {
      perf.propSimMs = built.perf.propSimMs;
      perf.qualificationMs = built.perf.qualificationMs;
      perf.candidatesPoolBefore = built.perf.candidatesPoolBefore;
      perf.candidatesPoolAfter = built.perf.candidatesPoolAfter;
      perf.candidatesSelected = built.perf.candidatesSelected;
      perf.deepSimRequested = built.perf.deepSimRequested;
      perf.deepSimCompleted = built.perf.deepSimCompleted;
      perf.qualifiedCount = built.perf.qualifiedCount;
    }
    const propsOnlyTimedOut =
      propsArm.signal.aborted &&
      !opts.signal.aborted &&
      coachPastRequestDeadline(requestStartedAtMs, budgetMs);
    if (propsOnlyTimedOut) {
      timing.timedOut = true;
      timing.timeoutReason = "scan_deadline";
      deliveryTerminalized = true;
    }
    let propsFailDiag = built.failDiag;
    let picks = filterPicksByAllowedSports(
      filterPicksForCoachAskTeams(
        filterPicksByAskMarketConstraint(
          selectFinalCoachParlayPicks(built.picks),
          marketConstraint,
        ),
        inputs.teamScope,
        inputs.excludedTeams,
      ),
      askSportScope,
      inputs.espnGames,
    );

    // Locked market family graded but staged 0 — recover with the SAME allowlist
    // (more / same-stat `_alternate` posted lines + recovery odds slack).
    // Never clear allowedMarketKeys or cross-fill another stat family.
    let recoveredNote = "";
    const isMarketLocked = lockedKeys != null && lockedKeys.length > 0;
    // Canonical lock label from EXPLICIT_MARKET_LOCK_RULES (any sport/family).
    const lockedMarketLabel = lockedMarketLabelForAsk(opts.askText) ?? "market";
    // Immutable ask sport scope — recovery must not widen beyond resolved sports
    // (college player props must never seat NFL skill rows from a mixed pool).
    const recoverySportScope = askSportScope;
    const recoverySourcePool = filterPoolByFootballRecoverySports(
      askAllowsNcaafPlayerProps(opts.askText)
        ? inputs.propPool
        : filterNcaafPlayerPropsUnlessAsked(inputs.propPool, opts.askText),
      recoverySportScope,
    );
    const recoveryPool = isMarketLocked
      ? filterPropPoolByAskMarkets(recoverySourcePool, lockedKeys, marketConstraint)
      : filterPoolForFootballSkillRecovery(recoverySourcePool, recoverySportScope);
    if (
      shouldRecoverPropsOnlyWithFootballSkillBoard({
        graded: built.propLegsScored,
        staged: picks.length,
        preferredPoolSize: activePropPool.length,
        skillPoolSize: recoveryPool.length,
      })
    ) {
      opts.onStatus?.(
        isMarketLocked
          ? `Locked market missed the quality bar — retrying same-stat lines / alts…`
          : `Locked markets missed the quality bar — scoring yards / receptions / sacks alts…`,
      );
      const recovered = await buildFootballPropsOnlyTicket({
      propAudit: opts.propAudit,
        target,
        pool: recoveryPool.length ? recoveryPool : activePropPool,
        realOdds: inputs.realOdds,
        teamIdMap,
        signal: opts.signal,
        onStatus: opts.onStatus,
        playerHistory,
        oppRushDefense,
        espnGames: inputs.espnGames,
        mlbPlatoon,
        mlbGameEnv,
        recoveryFill: true,
        allowRareCountFamilyStack,
        askText: opts.askText,
        allowedSports: askSportScope.allowedSports,
        onPartialPicks: (partial) => {
          // Preserve the original market lock when present.
          // Scope filter before UI buffer — same as primary props-only path.
          opts.onPartialPicks?.(
            filterPicksByAllowedSports(
              filterPicksForCoachAskTeams(
                filterPicksByAskMarketConstraint(partial, marketConstraint),
                inputs.teamScope,
                inputs.excludedTeams,
              ),
              askSportScope,
              inputs.espnGames,
            ),
          );
        },
      });
      const recoveredPicks = filterPicksByAllowedSports(
        filterPicksForCoachAskTeams(
          filterPicksByAskMarketConstraint(
            selectFinalCoachParlayPicks(recovered.picks),
            marketConstraint,
          ),
          inputs.teamScope,
          inputs.excludedTeams,
        ),
        askSportScope,
        inputs.espnGames,
      );
      propsFailDiag = preferPropsOnlyFailDiag(propsFailDiag, recovered.failDiag);
      if (recoveredPicks.length > 0) {
        picks = recoveredPicks;
        recoveredNote = isMarketLocked
          ? recovered.picks.length < target
            ? lockedMarketQualityShortfallNote({
                requestedLegs: target,
                analyzed: Math.max(built.propLegsScored, propsFailDiag?.graded ?? 0),
                availableCandidates: propsFailDiag?.pool ?? propPoolSize,
                qualified: picks.length,
                marketLabel: lockedMarketLabel,
              })
            : `Staged ${picks.length} matching real lines for the requested market (same-stat alts included where posted).`
          : footballSkillRecoveryNote({
              preferredGraded: built.propLegsScored,
              staged: picks.length,
              target,
            });
      } else if (built.propLegsScored > 0 && picks.length === 0) {
        // Retry preferred (already allowlisted) pool with recovery slack.
        const softPreferred = await buildFootballPropsOnlyTicket({
      propAudit: opts.propAudit,
          target,
          pool: activePropPool,
          realOdds: inputs.realOdds,
          teamIdMap,
          signal: opts.signal,
          onStatus: opts.onStatus,
          playerHistory,
          oppRushDefense,
          espnGames: inputs.espnGames,
          mlbPlatoon,
          mlbGameEnv,
          recoveryFill: true,
          allowRareCountFamilyStack,
          askText: opts.askText,
          allowedSports: askSportScope.allowedSports,
          onPartialPicks: (partial) => {
            opts.onPartialPicks?.(
              filterPicksByAllowedSports(
                filterPicksForCoachAskTeams(
                  filterPicksByAskMarketConstraint(partial, marketConstraint),
                  inputs.teamScope,
                  inputs.excludedTeams,
                ),
                askSportScope,
                inputs.espnGames,
              ),
            );
          },
        });
        // Never let preferred-pool ODDS_GATE wipe skill-board CONFIDENCE_GATE.
        propsFailDiag = preferPropsOnlyFailDiag(propsFailDiag, softPreferred.failDiag);
        const softPicks = filterPicksByAllowedSports(
          filterPicksForCoachAskTeams(
            filterPicksByAskMarketConstraint(
              selectFinalCoachParlayPicks(softPreferred.picks),
              marketConstraint,
            ),
            inputs.teamScope,
            inputs.excludedTeams,
          ),
          askSportScope,
          inputs.espnGames,
        );
        if (softPicks.length > 0) {
          picks = softPicks;
          recoveredNote =
            softPicks.length < target
              ? lockedMarketQualityShortfallNote({
                  requestedLegs: target,
                  analyzed: Math.max(built.propLegsScored, propsFailDiag?.graded ?? 0),
                  availableCandidates: propsFailDiag?.pool ?? propPoolSize,
                  qualified: picks.length,
                  marketLabel: lockedMarketLabel,
                })
              : `Staged ${picks.length} matching real lines for the requested market.`;
        } else {
          const propsSportLabel = propsOnlySportLabelFromAsk(opts.askText, {
            allowedSports: askSportScope.allowedSports,
            failDiagSports: propsFailDiag?.sports,
          });
          const recoveryGraded = {
            preferred: built.propLegsScored,
            skill: recovered.propLegsScored,
          };
          recoveredNote = isMarketLocked
            ? lockedMarketQualityShortfallNote({
                requestedLegs: target,
                analyzed: Math.max(built.propLegsScored, propsFailDiag?.graded ?? 0),
                availableCandidates: propsFailDiag?.pool ?? propPoolSize,
                qualified: 0,
                marketLabel: lockedMarketLabel,
              })
            : propsFailDiag
              ? propsOnlyTerminalEmptyNote(propsFailDiag, {
                  sportLabel: propsSportLabel,
                  confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
                  recoveryGraded,
                })
              : propsOnlyTerminalEmptyNote(
                  {
                    code: "PROPS_ONLY_ODDS_GATE",
                    target,
                    pool: 0,
                    athleteLinked: 0,
                    candidates: 0,
                    historyLoaded: 0,
                    graded: built.propLegsScored,
                    bestEvSides: 0,
                    oddsCleared: 0,
                    staged: 0,
                    nullReasons: {},
                  },
                  {
                    sportLabel: propsSportLabel,
                    confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
                    recoveryGraded,
                  },
                );
        }
      }
    }

    // Locked-market shortfall copy (0 analyzed, 0/N, or partial) — UI only; selection unchanged.
    if (isMarketLocked && picks.length < target) {
      const shortfallNote = lockedMarketQualityShortfallNote({
        requestedLegs: target,
        analyzed: Math.max(built.propLegsScored, propsFailDiag?.graded ?? 0),
        availableCandidates: propsFailDiag?.pool ?? propPoolSize,
        qualified: picks.length,
        marketLabel: lockedMarketLabel,
      });
      if (shortfallNote) recoveredNote = shortfallNote;
    }

    const teamMiss = coachAskTeamMissNote(inputs.teamScope, inputs.oddsGames.length);
    const teamShortfall = coachAskTeamShortfallNote(
      inputs.teamScope,
      target,
      picks.length,
      inputs.oddsGames.length,
    );
    // Final belt — recovery/top-up must not reintroduce another local day
    // or an explicitly excluded matchup.
    picks = filterPicksForSlateDay(picks, inputs.slateDay);
    picks = filterPicksForCoachAskTeams(picks, inputs.teamScope, inputs.excludedTeams);
    // Delivery grounding — remove proven player/team/game mismatches; refill
    // only from qualified leftovers. Unknown identity stays on the ticket.
    // Props-only has no leftover pool → strip + honest shortfall (no refill).
    const deliveryGrounding = applyDeliveryGroundingGate({
      picks,
      qualifiedCandidates: [],
      target,
    });
    picks = filterPreparedDeliveryPicks(deliveryGrounding.picks, inputs.espnGames);
    const shortfall = resolveCoachParlayShortfallLead({
      askText: opts.askText ?? "",
      requestedLegs: target,
      qualified: picks.length,
      analyzed: Math.max(built.propLegsScored, propsFailDiag?.graded ?? 0),
      availableCandidates: propsFailDiag?.pool ?? propPoolSize,
      isMarketLocked,
    });
    const mismatchLead = coachPropsAskGameLineMismatchNote({
      askText: opts.askText,
      propsOnly: true,
      picks,
    });
    const propsSportLabel = propsOnlySportLabelFromAsk(opts.askText, {
      allowedSports: askSportScope.allowedSports,
      failDiagSports: propsFailDiag?.sports,
    });
    // Empty or short ticket: one terminal diagnosis from failDiag
    // (partial/recovery/final agree). Locked-market shortfall copy stays
    // authoritative for explicit market locks.
    const failDiagTerminalBody =
      picks.length < target && propsFailDiag && !isMarketLocked
        ? reconcileCoachTerminalNote({
            priorText: recoveredNote || built.note,
            nextText: recoveredNote || built.note || "",
            priorFailDiag: built.failDiag,
            nextFailDiag: propsFailDiag,
            sportLabel: propsSportLabel,
            confidenceFloor: COACH_SIM_MIN_CONFIDENCE,
            recoveryGraded:
              recoveredNote || built.propLegsScored > 0
                ? {
                    preferred: built.propLegsScored,
                    skill: Math.max(
                      built.propLegsScored,
                      propsFailDiag.graded,
                    ),
                  }
                : undefined,
          })
        : "";
    const body =
      failDiagTerminalBody ||
      recoveredNote ||
      built.note.trim() ||
      buildFinalCoachParlayNote({
        target,
        picks,
        propPoolSize,
        propsPending: false,
        shortfallLead: teamMiss || teamShortfall || shortfall,
        propsOnly: true,
        requirePropMix: false,
      });
    // Mismatch lead first — phone shows it above pick cards when game lines leak.
    const note = sanitizeCoachUserNote(
      [mismatchLead, body].filter((s) => s.trim()).join("\n\n"),
    );
    const teamGameScopeDiagnostics = buildCoachTeamGameScopeDiagnostics({
      requestedLegs: target,
      scope: inputs.teamScope,
      gamesBeforeFilter: inputs.oddsGamesBeforeTeamFilter,
      gamesAfterFilter: inputs.oddsGames,
      finalLegCount: picks.length,
    });
    markCoachPhase(timing, "finalization", 0);
    deliveryTerminalized = true;
    // Fire-and-forget reliability — props-only early return must still emit.
    // Assembly reports deliveryCommitted:false; UI finishSession commits success.
    reportCoachScanReliability({
      requestId: coachRelRequestId,
      sportCategory: coachRelSport,
      requestedLegCount: target,
      returnedLegCount: picks.length,
      realOddsAvailable:
        (inputs.realOdds?.length ?? 0) > 0 || (inputs.oddsGames?.length ?? 0) > 0,
      picks,
      timedOut: !!timing.timedOut,
      scanMissing: false,
      deliveryCommitted: false,
      ...reportTimingFields(),
    });
    // If post-filters wiped a non-empty ticket, keep the honest empty lead —
    // never append `[POST_FILTER_EMPTY: …]` into the Coach chat bubble.
    if (built.picks.length > 0 && picks.length === 0 && !recoveredNote) {
      return {
        picks,
        note,
        scan: null,
        timedOut: !!timing.timedOut,
        propPoolSize,
        teamGameScopeDiagnostics,
        reliabilityRequestId: coachRelRequestId,
        timing,
        perf,
        ...(propsFailDiag ? { failDiag: propsFailDiag } : {}),
      };
    }
    return {
      picks,
      note,
      scan: null,
      timedOut: !!timing.timedOut,
      propPoolSize,
      teamGameScopeDiagnostics,
      reliabilityRequestId: coachRelRequestId,
      timing,
      perf,
      ...(propsFailDiag && picks.length < target ? { failDiag: propsFailDiag } : {}),
    };
  }

  // Allowlisted / props-only pools must not re-expand to the full board
  // (filtered yards pools are often < 40 and would otherwise undo the allowlist).
  // Game-lines-only (team props / no player props) must not re-fetch player props.
  const skipPropExpand =
    propsOnly ||
    gameLinesOnly ||
    marketConstraint.allowedMarketKeys != null ||
    shouldSkipScannerPropExpand(propPoolSize);

  let latest: FullBoardScanResult | null = null;
  markCoachPending(timing, "scan");
  const scanStarted = Date.now();
  const scanRemaining = coachPhaseBudgetMs({
    remainingMs: coachRemainingBudgetMs(requestStartedAtMs, budgetMs),
    phase: "scan",
  });
  const scanArm = armDeadlineAbort({
    parent: opts.signal,
    remainingMs: scanRemaining,
  });
  const scanPromise = tryReachFullBoardScan({
    propAudit: opts.propAudit,
    target,
    stopWhenTargetQualified: target === 2 && isAutomaticFreeCoachAsk(opts.askText),
    oddsGames: inputs.oddsGames,
    propPool: activePropPool,
    realOdds: scanRealOdds,
    liveOdds: scanLiveOdds,
    espnGames: inputs.espnGames,
    gameMeta: [],
    teamIdMap,
    excludedTeams: inputs.excludedTeams,
    signal: scanArm.signal,
    skipPropPoolExpand: skipPropExpand,
    prioritySports: inputs.prioritySports,
    propsOnly,
    exhaustPropBoard: hrBoardAsk,
    legsPerGameCap: legsPerGameCap ?? undefined,
    gameLinesOnly,
    collegeTeamMarketStacks: collegeTeamMarketStacks || undefined,
    requirePropMix,
    // Strip NCAAF player props on expand only when NCAAF is outside immutable scope
    // (explicit NFL / non-football boards). Do not key this off player-prop wording.
    excludeNcaafPlayerProps: !askSportScope.allowedSports
      .map((s) => String(s).toLowerCase())
      .includes("ncaaf"),
    mlbPlatoon,
    mlbGameEnv,
    oppRushDefense: Object.keys(oppRushDefense).length ? oppRushDefense : undefined,
    matchupInjuries: Object.keys(matchupInjuries).length ? matchupInjuries : undefined,
    injuryTeams: injuryTeams.length ? injuryTeams : undefined,
    playerHistory,
    matchupHistory,
    varietySeed: `greenfield-${target}-${Date.now()}`,
    ticketStyle: detectCoachTicketStyle(opts.askText ?? ""),
    teamScope: inputs.teamScope,
    varietyContext: {
      ...recentParlayVarietyContext(),
      ...(askWantsAllNewPicks(opts.askText) ? { hardAvoidRecentLegs: true } : {}),
      // Carry include-scope so single-event seating activates and staging
      // cannot fall back to a multi-game / multi-sport board.
      askText: opts.askText ?? null,
      singleEventSport: inputs.teamScope?.sport ?? null,
      singleEventKey:
        inputs.teamScope && inputs.oddsGames[0]
          ? `${inputs.oddsGames[0].awayTeam ?? ""} @ ${inputs.oddsGames[0].homeTeam ?? ""}`
          : null,
      // Rare multi-count lottery / 2+ / longshot path (#713).
      allowRareMultiCount: rareMultiCountLotteryPathOpen({
        askText: opts.askText,
        ticketStyle: detectCoachTicketStyle(opts.askText ?? ""),
      }),
    },
    onPartial: (partial) => {
      // Late async after terminalization must not overwrite a timed-out request.
      if (deliveryTerminalized) return;
      latest = partial;
      // Scope filter before any UI buffer — foreign legs must never paint mid-scan.
      const scopedPartialPicks = filterPicksForCoachAskTeams(
        partial.picks ?? [],
        inputs.teamScope,
        inputs.excludedTeams,
      );
      const propLike = countPropLike(scopedPartialPicks);
      if (partial.awaitingPropSlots && propLike === 0) {
        // Reserved game-line preview (often exactly 2 on a 5/6-leg) must not paint
        // as the ticket before props/alts have had a chance to score.
        // When propsOnly, skip this game-line preview path entirely.
        if (propsOnly) return;
        opts.onStatus?.(
          propPoolSize > 0
            ? `Scoring game lines… props/alts next (${propPoolSize} posted)`
            : `Scoring game lines… ${scopedPartialPicks.length} so far`,
        );
        // Still buffer reserved game lines for the absolute-budget hang guard —
        // UI publish policy keeps cards hidden until terminal, but an empty
        // buffer was latching "delivery budget… composer unlocked" with 0 cards.
        if (scopedPartialPicks.length) {
          opts.onPartialPicks?.(scopedPartialPicks);
        }
        return;
      }
      if (scopedPartialPicks.length) {
        opts.onStatus?.(
          propLike > 0
            ? `Scoring ticket… ${scopedPartialPicks.length} legs (${propLike} props/alts)`
            : `Scoring game lines… ${scopedPartialPicks.length} so far — props next`,
        );
        opts.onPartialPicks?.(
          propsOnly
            ? filterPicksByAskMarketConstraint(scopedPartialPicks, marketConstraint)
            : scopedPartialPicks,
        );
      }
    },
    requestId: coachRelRequestId,
  });

  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  let scanAbortListener: (() => void) | null = null;
  let timed: { scan: FullBoardScanResult | null; timedOut: boolean };
  try {
    const timeoutPromise = new Promise<{ scan: null; timedOut: true }>((resolve) => {
      // Remaining time only — never a fresh full budget after load.
      const waitMs = Math.max(
        0,
        coachRemainingBudgetMs(requestStartedAtMs, budgetMs),
      );
      scanAbortListener = () => resolve({ scan: null, timedOut: true });
      opts.signal.addEventListener("abort", scanAbortListener, { once: true });
      scanArm.signal.addEventListener("abort", scanAbortListener, { once: true });
      if (opts.signal.aborted || scanArm.signal.aborted) {
        scanAbortListener();
      } else {
        scanTimeout = setTimeout(scanAbortListener, waitMs);
      }
    });
    timed = await Promise.race([
      scanPromise.then((scan) => ({ scan, timedOut: false as const })),
      timeoutPromise,
    ]);
  } finally {
    if (scanTimeout !== null) clearTimeout(scanTimeout);
    if (scanAbortListener) {
      opts.signal.removeEventListener("abort", scanAbortListener);
      scanArm.signal.removeEventListener("abort", scanAbortListener);
    }
    scanArm.dispose();
  }
  markCoachPhase(timing, "scan", Date.now() - scanStarted);

  let scan = timed.scan ?? latest ?? null;
  if (timed.timedOut) {
    timing.timedOut = true;
    timing.timeoutReason = opts.signal.aborted ? "user_cancelled" : "scan_deadline";
  }
  const propsStillPending = (s: FullBoardScanResult | null | undefined) =>
    !!s &&
    countPropLike(s.picks ?? []) === 0 &&
    (!!s.awaitingPropSlots || !!s.propPhaseIncomplete);

  // Grace only within remaining monotonic budget — never extend past deadline.
  if (
    timed.timedOut &&
    !opts.signal.aborted &&
    propPoolSize > 0 &&
    propsStillPending(scan)
  ) {
    const graceRemaining = coachRemainingBudgetMs(requestStartedAtMs, budgetMs);
    if (graceRemaining > 0) {
      opts.onStatus?.(`Finishing prop/alt scoring (${propPoolSize} posted)…`);
      const graceMs = Math.min(
        graceRemaining,
        requirePropMix
          ? Math.min(35_000, Math.max(15_000, Math.round(budgetMs * 0.35)))
          : Math.min(20_000, Math.max(8_000, Math.round(budgetMs * 0.25))),
      );
      let graceTimeout: ReturnType<typeof setTimeout> | null = null;
      let graceAbortListener: (() => void) | null = null;
      let grace: { scan: FullBoardScanResult | null };
      try {
        grace = await Promise.race([
          scanPromise.then((s) => ({ scan: s })),
          new Promise<{ scan: null }>((resolve) => {
            graceAbortListener = () => resolve({ scan: null });
            opts.signal.addEventListener("abort", graceAbortListener, { once: true });
            if (opts.signal.aborted) graceAbortListener();
            else graceTimeout = setTimeout(graceAbortListener, graceMs);
          }),
        ]);
      } finally {
        if (graceTimeout !== null) clearTimeout(graceTimeout);
        if (graceAbortListener) opts.signal.removeEventListener("abort", graceAbortListener);
      }
      if (grace.scan) scan = grace.scan;
      else scan = latest ?? scan;
    } else {
      scan = latest ?? scan;
    }
  } else if (!scan) {
    // Never await a hung scan forever after the delivery budget — that left
    // Coach on "Scoring ticket… 1 legs" with no terminal latch.
    const drainMs = Math.min(
      2_500,
      coachRemainingBudgetMs(requestStartedAtMs, budgetMs) || 2_500,
    );
    let drainTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      scan = await Promise.race([
        scanPromise.catch(() => null),
        new Promise<null>((resolve) => {
          drainTimeout = setTimeout(() => resolve(null), drainMs);
        }),
      ]);
    } finally {
      if (drainTimeout !== null) clearTimeout(drainTimeout);
    }
    if (!scan) scan = latest;
  }

  // Finalization starts — mark so late scan completions cannot re-open limbo.
  markCoachPending(timing, "finalization");
  const finalizationStarted = Date.now();
  if (timed.timedOut) deliveryTerminalized = true;
  // Observe-only: copy sequential game-sim wall from scanner (not overlapping prop work).
  if (scan?.failureDiagnostics?.gameSimMs != null) {
    perf.gameSimMs = scan.failureDiagnostics.gameSimMs;
  }
  if (scan?.failureDiagnostics?.propSimEvaluated != null) {
    perf.candidatesSelected = scan.failureDiagnostics.propSimEvaluated;
  }
  if (scan?.failureDiagnostics?.propPoolSize != null) {
    perf.candidatesPoolAfter = scan.failureDiagnostics.propPoolSize;
  }

  const rawPicks = scan?.picks?.length ? [...scan.picks].slice(0, target) : [];
  const teamScope = inputs.teamScope;
  let picks = filterPicksByAllowedSports(
    filterPicksForCoachAskTeams(
      filterPicksByAskMarketConstraint(
        selectFinalCoachParlayPicks(rawPicks),
        marketConstraint,
      ),
      teamScope,
      inputs.excludedTeams,
    ),
    askSportScope,
    inputs.espnGames,
  );
  // Lock ML / puck-line / spread sides to real mlLean when present — opponent
  // comparison like NFL, not freeform chat inventing home-ice one-liners.
  // Substitutions must already be staging-qualified with preserved finalAiScore.
  let mlLeanNote = "";
  if (!propsOnly && matchupHistory && picks.some((p) => !p.isProp)) {
    const qualifiedCandidates = [
      ...(scan?.qualifiedCandidates ?? []),
      ...(latest?.qualifiedCandidates ?? []),
      ...picks,
    ];
    const enforced = enforceMlLeanOnPicks(picks, {
      matchupHistory,
      realOdds: scanRealOdds,
      gameMeta: [],
      qualifiedCandidates,
      requestedLegs: target,
    });
    picks = filterPicksForCoachAskTeams(
      filterPicksByAskMarketConstraint(enforced.picks, marketConstraint),
      teamScope,
      inputs.excludedTeams,
    );
    mlLeanNote = mlLeanEnforcementNote(enforced);
  }
  const propsPending =
    propsStillPending(scan) ||
    propsStillPending(latest) ||
    !!scan?.propPhaseIncomplete;
  // Football mix: hold prop seats while props incomplete; after props finish
  // with 0 clears, deliver scored game lines (never wipe to empty).
  // Non-football: never re-cap for empty prop seats (preview hang-guard used
  // to publish exactly boardScanNonPropPreviewCap(N) — phone 5→2 / 6→3).
  if (requirePropMix) {
    picks = finalizeFootballPropMixPicks(picks, target, {
      propPhaseIncomplete: propsPending,
    });
  } else if (!propsOnly && !gameLinesOnly) {
    picks = finalizeGeneralPropMixPicks(picks, target);
  }
  // Post-lean final fill — reuse production top-up / progressive GL raise on
  // already-qualified leftovers. Skip while props are still scoring so we do
  // not pack GL seats before skill props land. Never re-runs mlLean.
  if (picks.length < target && !propsPending && !propsOnly) {
    const fillPool = [
      ...(scan?.qualifiedCandidates ?? []),
      ...(latest?.qualifiedCandidates ?? []),
    ];
    if (fillPool.length) {
      picks = topUpAfterMlLean({
        picks,
        qualifiedCandidates: fillPool,
        target,
        varietySeed: opts.askText,
        legsPerGameCap,
        collegeTeamMarketStacks,
      });
      picks = filterPicksForCoachAskTeams(
        filterPicksByAskMarketConstraint(picks, marketConstraint),
        teamScope,
        inputs.excludedTeams,
      );
    }
  }
  // Same-ticket ladder ban — never ship Colts +4.5 and +3.5 together.
  picks = dedupePicksByMarketLadder(picks);
  // Final belt — staging/top-up must not reintroduce another local day
  // or an explicitly excluded matchup / other league.
  picks = filterPicksForSlateDay(picks, inputs.slateDay);
  picks = filterPicksForCoachAskTeams(picks, teamScope, inputs.excludedTeams);
  picks = filterPicksByAllowedSports(picks, askSportScope, inputs.espnGames);
  // Delivery grounding — after belts, before shortfall + reliability report.
  // ALT/backfill/recovery/top-up cannot bypass: this is the last seat check.
  // Final pregame + quality + grounding re-check (incl. ALT). Games can tip
  // during a long scan; unknown startsAt stays (enrichment gaps ≠ started).
  picks = revalidateCoachTerminalDeliveryPicks(picks, {
    target,
    qualifiedCandidates: [
      ...(scan?.qualifiedCandidates ?? []),
      ...(latest?.qualifiedCandidates ?? []),
    ],
  });
  picks = filterPreparedDeliveryPicks(picks, inputs.espnGames);
  if (picks.length) rememberParlayBuild(picks);
  const teamMiss = coachAskTeamMissNote(teamScope, inputs.oddsGames.length);
  const teamShortfall = coachAskTeamShortfallNote(
    teamScope,
    target,
    picks.length,
    inputs.oddsGames.length,
  );
  // Full-board / hrBoardAsk exit — same locked shortfall helper as props-only.
  // Analyzed count = failureDiagnostics.propLegsScored from the allowlisted
  // (HR: scorer-filtered) pool with skipPropPoolExpand — never invent from
  // unrelated board totals (hits / TB / Ks / etc.).
  const isMarketLocked =
    marketConstraint.allowedMarketKeys != null &&
    marketConstraint.allowedMarketKeys.length > 0;
  const lockedAnalyzed = lockedMarketAnalyzedFromBoardDiagnostics(
    scan?.failureDiagnostics,
  );
  // Shortfall copy must use the final delivered ticket length — never a
  // pre-lean / pre-fill staging pool count.
  const finalLegCount = picks.length;
  const shortfall = resolveCoachParlayShortfallLead({
    askText: opts.askText ?? "",
    requestedLegs: target,
    qualified: finalLegCount,
    analyzed: lockedAnalyzed,
    isMarketLocked,
    propsPending,
    buildPendingLead: buildFixedLegPropsPendingShortfallLead,
  });
  const mismatchLead = coachPropsAskGameLineMismatchNote({
    askText: opts.askText,
    propsOnly,
    picks,
  });
  const body = buildFinalCoachParlayNote({
    target,
    picks,
    propPoolSize,
    propsPending,
    shortfallLead: teamMiss || teamShortfall || shortfall,
    // Note-only: full N/N tickets must not paint budget-stop copy even when
    // the scan phase flagged timedOut during the finalization reserve.
    timedOut: timed.timedOut && picks.length < target,
    budgetMs,
    scanMissing: !scan,
    // Drop staging scan notes on shortfall — they can claim a larger "qualified"
    // count than the post-lean / post-fill ticket actually delivered.
    scanNote: finalLegCount < target ? undefined : scan?.note,
    failureReason: scan?.failureReason,
    failureDiagnostics: scan?.failureDiagnostics,
    propsOnly,
    requirePropMix,
  });
  // Mismatch lead first — phone shows it above pick cards when game lines leak.
  const note = sanitizeCoachUserNote(
    [mismatchLead, mlLeanNote, body].filter((s) => s.trim()).join("\n\n"),
  );

  const teamGameScopeDiagnostics = buildCoachTeamGameScopeDiagnostics({
    requestedLegs: target,
    scope: teamScope,
    gamesBeforeFilter: inputs.oddsGamesBeforeTeamFilter,
    gamesAfterFilter: inputs.oddsGames,
    finalLegCount: picks.length,
  });

  markCoachPhase(timing, "finalization", Date.now() - finalizationStarted);
  deliveryTerminalized = true;
  perf.qualifiedCount = picks.length;
  // Fire-and-forget reliability — after ticket is finalized; never awaits.
  // Assembly is not delivery success — UI finishSession sets deliveryCommitted.
  reportCoachScanReliability({
    requestId: coachRelRequestId,
    sportCategory: coachRelSport,
    requestedLegCount: target,
    returnedLegCount: picks.length,
    realOddsAvailable: (scanRealOdds?.length ?? 0) > 0 || (inputs.oddsGames?.length ?? 0) > 0,
    scanFailureCode: scan?.failureReason?.code ?? null,
    scanFailureDetail: scan?.failureReason?.detail ?? null,
    picks,
    timedOut: timed.timedOut || !!timing.timedOut,
    scanMissing: !scan,
    deliveryCommitted: false,
    ...reportTimingFields(),
  });

  return {
    picks,
    note,
    scan,
    timedOut: timed.timedOut || !!timing.timedOut,
    propPoolSize,
    teamGameScopeDiagnostics,
    reliabilityRequestId: coachRelRequestId,
    timing,
    perf,
  };
}

/** Preparation never extends the foreground deadline or competes with its queue. */
export async function buildCoachParlay(opts: Parameters<typeof buildCoachParlayImpl>[0]): Promise<CoachParlayBuildResult> {
  const release = coachContextWarmer.beginForeground();
  const releaseAudit = beginCoachPropAuditForeground();
  const audit = createCoachPropAudit(opts.reliabilityRequestId || `prop-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const safePicks = (picks: ParsedPick[]) => picks.filter(p => {
    const issues = audit.deliveryIssues(p);
    if (!issues.length) return true;
    audit.observe(p, "delivery_blocked", `delivery_blocked:${issues.join(",")}`);
    return false;
  });
  try {
    const result = await buildCoachParlayImpl({ ...opts, propAudit: audit,
      onPartialPicks: opts.onPartialPicks ? picks => opts.onPartialPicks?.(safePicks(picks)) : undefined });
    const picks = safePicks(result.picks);
    audit.finish(picks, opts.signal.aborted ? "cancelled" : result.timedOut ? "timed_out" : "completed", report => { void persistCoachPropAudit(report); });
    return { ...result, picks, note: picks.length < result.picks.length ? `Returned ${picks.length} of ${Math.max(1, Math.min(opts.requestedLegs || 6, 15))} requested picks. Some props could not be verified, so I left them out.` : result.note };
  } catch (e) {
    audit.finish([], opts.signal.aborted ? "cancelled" : "error", report => { void persistCoachPropAudit(report); });
    throw e;
  } finally { releaseAudit(); release(); }
}
