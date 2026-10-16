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
  finalizeFootballPropMixPicks,
  finalizeGeneralPropMixPicks,
  asksSpreadAndMoneylineOnly,
  spreadMoneylineOnlyShortfallLead,
} from "@/lib/boardScanPropDelivery";
import {
  askWantsAllNewPicks,
  recentParlayVarietyContext,
  rememberParlayBuild,
} from "@/lib/parlayVarietyMemory";
import { dedupePicksByMarketLadder } from "@/lib/marketLadderKey";
import {
  recoverQualifiedDeliveryPicks,
  revalidateDeliveryPicks,
} from "@/lib/coachDeliveryQualification";
import { finalizeCoachDeliveryPicks } from "@/lib/ticketDiversity";
import { shouldBuildFootballPropsOnlyTicket } from "@/lib/coachFootballPropsOnly";
import { buildFootballPropsOnlyTicket } from "@/lib/coachFootballPropsOnlyTicket";
import { isRareCountPropMarket } from "@/lib/rareCountPropModel";
import { rareMultiCountLotteryPathOpen } from "@/lib/rareMultiCountCoachGate";
import { detectCoachTicketStyle } from "@/lib/coachTicketQualityTiers";
import { buildGameTeamIdMap } from "@/lib/coachGameMonteCarlo";
import { coachAbsoluteBudgetMs } from "@/lib/coach/session";
import { linkDeadlineAbort, raceAbortableDeadline } from "@/lib/coach/abortableDeadline";
import { shouldSkipScannerPropExpand } from "@/lib/coach/propPoolPolicy";
import { prioritySportsForAsk } from "@/lib/chatContextPriority";
import { classifySportCategoryFromAsk } from "@/lib/coachReliabilityClassify";
import { reportCoachScanReliability } from "@/lib/coachReliabilityReporter";
import { footballPropFunnelSummaryForRequest } from "@/lib/coachBoardScanManifest";
import {
  slateAwarePrioritySports,
  sportsPresentOnSlate,
} from "@/lib/coachPrioritySports";
import { coachBoardSportsForAsk } from "@/lib/coachPropBoardCoverage";
import {
  bareCollegeClarificationNote,
  canonicalizeCoachAskSport,
  filterPicksForAskSports,
  hardLockedSportsFromAsk,
  sportScopeShortfallNote,
} from "@/lib/coachAskSportScope";
import {
  coachAskTeamMissNote,
  coachAskTeamScope,
  coachAskTeamShortfallNote,
  buildCoachTeamGameScopeDiagnostics,
  excludedTeamScopesFromText,
  filterOddsGamesForCoachAskTeams,
  filterPicksForAskTeamPlayers,
  filterPicksForCoachAskTeams,
  filterPropPoolForAskTeamPlayers,
  resolveAskTeamIdFromGames,
  resolveExcludedTeamIdsFromGames,
  wantsAskTeamPlayersOnly,
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
import { joinCoachNoteParts, sanitizeCoachUserNote } from "@/lib/sanitizeCoachUserNote";
import {
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
} from "@/lib/coachAskMarketFilter";
import {
  ncaafGameLineAskIsP0Blocked,
  p0BlockedNcaafGameLineAskNote,
  P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
} from "@/lib/coachP0UnvalidatedTotals";
import {
  filterPoolForFootballSkillRecovery,
  footballSkillRecoveryNote,
  shouldRecoverPropsOnlyWithFootballSkillBoard,
} from "@/lib/coachFootballPropsOnlyRecovery";
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
  const lockedSports = hardLockedSportsFromAsk(askText);
  const stampAndKeepSport = <T extends { sport?: string | null }>(
    rows: T[],
    sport: string,
  ): T[] => {
    const want = canonicalizeCoachAskSport(sport);
    return rows
      .map((g) => {
        const tagged = canonicalizeCoachAskSport(g.sport);
        // Drop rows explicitly tagged to a different league (cache / feed leak).
        if (tagged && tagged !== want) return null;
        return { ...g, sport: tagged || want };
      })
      .filter((g): g is T => !!g);
  };
  const [espnGamesRaw, oddsRaw, liveFeed] = await Promise.all([
    Promise.all(
      sports.map((s) =>
        getGames(s, signal)
          .catch(() => [] as EspnGame[])
          .then((rows) => stampAndKeepSport(rows, s)),
      ),
    ).then((rows) => rows.flat()),
    Promise.all(
      sports.map((s) =>
        getOdds(s, signal)
          .catch(() => [] as OddsGame[])
          .then((rows) => stampAndKeepSport(rows, s)),
      ),
    ).then((rows) => filterBettableOddsGames(rows.flat())),
    getLiveOdds(sports, signal).catch(() => ({ games: [], odds: [] as RealOddsEntry[] })),
  ]);

  // "6 leg Saints" / "4 leg Troy" → keep only that franchise's matchup.
  // "6 leg NHL not the ducks" → drop the entire excluded matchup (both clubs).
  // Sport scoping alone still allowed other NFL games to fill a team ask.
  const teamScope = coachAskTeamScope(askText);
  let excludedTeams = excludedTeamScopesFromText(askText);
  excludedTeams = resolveExcludedTeamIdsFromGames(excludedTeams, espnGamesRaw);
  // Hard sport belt on the loaded board (college must never keep MLB/NFL rows).
  const sportBeltGames = <T extends { sport?: string | null }>(rows: T[]): T[] =>
    lockedSports?.length
      ? rows.filter((g) => {
          const s = canonicalizeCoachAskSport(g.sport);
          return !!s && lockedSports.includes(s);
        })
      : rows;
  const oddsGamesBeforeTeamFilter = sportBeltGames(oddsRaw);
  let oddsGames = filterOddsGamesForCoachAskTeams(
    oddsGamesBeforeTeamFilter,
    teamScope,
    excludedTeams,
  );
  let espnGames = filterOddsGamesForCoachAskTeams(
    sportBeltGames(espnGamesRaw),
    teamScope,
    excludedTeams,
  );

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

  // Spreads/moneylines and other game-lines-only asks never score player props.
  // Fetching the full prop board here was the multi-second stall before scoring
  // even started, and a later mix path could still seat those props.
  const loadConstraint = parseCoachAskMarketConstraint(askText, priorUserTexts);
  const skipPropPool = loadConstraint.gameLinesOnly && !loadConstraint.propsOnly;
  let propPool: PropPoolEntry[] = [];
  if (skipPropPool) {
    onStatus?.(
      loadConstraint.excludeTotals
        ? "Loading spreads and moneylines…"
        : "Loading game lines…",
    );
  } else {
    onStatus?.("Loading player props and alt lines across the board…");
    propPool = await fetchFullBoardPropPool(oddsGames, espnGames, [], signal).catch(
      () => [] as PropPoolEntry[],
    );
  }
  // Belt: drop any row whose kickoff slipped outside the requested local day.
  propPool = filterOddsForSlateDay(propPool, slateDay);
  // Exclusions already removed games before prop fetch; belt-and-suspenders on
  // pool rows so a stale basePool cannot reintroduce an excluded matchup.
  propPool = filterPicksForCoachAskTeams(propPool, teamScope, excludedTeams);
  // "Seahawks players only" — drop opponent props at candidate load (not just
  // final delivery). Shortfall counts only this franchise's player props.
  if (wantsAskTeamPlayersOnly(askText, teamScope)) {
    const askTeamId = resolveAskTeamIdFromGames(teamScope, oddsGames);
    propPool = filterPropPoolForAskTeamPlayers(propPool, teamScope, askTeamId);
  }

  // Live odds can carry foreign-tagged rows from a multi-sport feed — belt
  // hard-locked asks the same way as games/odds so college never merges MLB.
  const liveOdds = filterPicksForAskSports(
    filterPicksForCoachAskTeams(
      filterOddsForSlateDay(liveFeed.odds ?? [], slateDay),
      teamScope,
      excludedTeams,
    ),
    lockedSports,
  );

  return {
    espnGames,
    oddsGames,
    propPool,
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

export async function buildCoachParlay(opts: {
  requestedLegs: number;
  /** User ask — scopes sports (college football) and priority inject. */
  askText?: string | null;
  /** Prior user turns — inherit props-only like tonight/tomorrow slate. */
  priorUserTexts?: string[];
  signal: AbortSignal;
  onStatus?: (status: string) => void;
  onPartialPicks?: (picks: ParsedPick[]) => void;
  /** Fires after prop/alt board load. The request deadline already started at send. */
  onReadyToScan?: (info: { propPoolSize: number }) => void;
  /** Absolute end of the send, from the session clock. Defaults to now plus the request deadline. */
  deadlineAtMs?: number;
}): Promise<CoachParlayBuildResult> {
  const target = Math.max(3, Math.min(opts.requestedLegs || 6, 25));
  const budgetMs = coachAbsoluteBudgetMs(target);
  const deadlineAt = opts.deadlineAtMs ?? Date.now() + budgetMs;
  // Observe-only reliability markers — never touch selection / UI.
  const coachRelStarted = Date.now();
  const coachRelRequestId = `greenfield-${Date.now()}`;
  const coachRelSport = classifySportCategoryFromAsk(opts.askText ?? "");

  // Ask-only gate — before loadScanInputs / slate sims. Bare "7 leg college" is
  // gameLinesOnly + NCAAF-locked; every FG market is P0 while unvalidated, so
  // waiting on fetchSlateGameSimulations only stalls the progress card.
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
      const note = sanitizeCoachUserNote(
        [
          bareCollegeClarificationNote(opts.askText),
          p0BlockedNcaafGameLineAskNote(target),
        ]
          .filter((s) => s && String(s).trim())
          .join("\n\n"),
      );
      reportCoachScanReliability({
        requestId: coachRelRequestId,
        sportCategory: coachRelSport === "unspecified" ? "ncaaf" : coachRelSport,
        requestedLegCount: target,
        returnedLegCount: 0,
        durationMs: Date.now() - coachRelStarted,
        realOddsAvailable: null,
        picks: [],
        // Mapped digest-only (legitimate_underfill) — never pages as sim failure.
        scanFailureCode: "P0_UNVALIDATED_MARKETS",
        scanFailureDetail: P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
        rootCause: P0_UNVALIDATED_NCAAF_GAME_LINE_REASON,
      });
      return {
        picks: [],
        note,
        scan: null,
        timedOut: false,
        propPoolSize: 0,
      };
    }
  }

  const linked = linkDeadlineAbort(opts.signal, deadlineAt);
  try {
  return await (async (): Promise<CoachParlayBuildResult> => {
  const inputs = await loadScanInputs(
    linked.signal,
    target,
    opts.askText,
    opts.onStatus,
    opts.priorUserTexts ?? [],
  );
  if (linked.signal.aborted || opts.signal.aborted) {
    return {
      picks: [],
      note: "",
      scan: null,
      timedOut: !opts.signal.aborted,
      propPoolSize: 0,
    };
  }

  // Yards asks ("rushing and passing yards") → props-only + market allowlist.
  // Does not change hold/delivery — only which markets enter the scan pool.
  const marketConstraint = parseCoachAskMarketConstraint(
    opts.askText,
    opts.priorUserTexts ?? [],
  );
  const askTeamPlayersOnly = wantsAskTeamPlayersOnly(
    opts.askText,
    inputs.teamScope,
  );
  const askTeamId = askTeamPlayersOnly
    ? resolveAskTeamIdFromGames(inputs.teamScope, inputs.oddsGames)
    : null;
  /** Market allowlist + "<Team> players only" franchise-player belt. */
  const applyAskMarketFilters = <
    T extends {
      game?: string | null;
      sport?: string | null;
      isProp?: boolean;
      market?: string | null;
      pick?: string | null;
      propMarketKey?: string | null;
      playerTeamId?: string | null;
      teamAbbr?: string | null;
      playerTeam?: string | null;
      player?: string | null;
    },
  >(
    picks: T[],
    constraint = marketConstraint,
  ): T[] => {
    let out = filterPicksByAskMarketConstraint(picks, constraint);
    if (askTeamPlayersOnly) {
      out = filterPicksForAskTeamPlayers(out, inputs.teamScope, askTeamId);
    }
    return out;
  };
  const scanPropPool = filterPropPoolByAskMarkets(
    inputs.propPool,
    marketConstraint.allowedMarketKeys,
  );
  const propsOnly = marketConstraint.propsOnly;
  const gameLinesOnly = marketConstraint.gameLinesOnly && !propsOnly;
  const excludeTotals = marketConstraint.excludeTotals && !propsOnly;
  const fullGameOnly = !!marketConstraint.fullGameOnly && !propsOnly;
  // One pass: totals, period markets, and props leave before any sim work.
  const boardConstraint = fullGameOnly
    ? marketConstraint
    : { ...marketConstraint, fullGameOnly: false };
  const scanRealOdds = applyAskMarketFilters(inputs.realOdds, boardConstraint);
  const scanLiveOdds = applyAskMarketFilters(inputs.liveOdds, boardConstraint);
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
  const hrBoardAsk =
    propsOnly &&
    (marketConstraint.allowedMarketKeys ?? []).some((k) => isBatterHomeRunMarket(k));
  let mlbPlatoon: Record<string, unknown> | undefined;
  let mlbGameEnv: Record<string, unknown> | undefined;
  // Home-run asks want scorers — drop Under/No so MC budget hits Over 0.5.
  const activePropPool = hrBoardAsk
    ? filterHrScorerPoolEntries(collegeTeamPropPool)
    : collegeTeamPropPool;
  const propPoolSize = activePropPool.length;

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
  const contextPromise = Promise.all([
    loadBoardInjuries(boardSports, linked.signal).catch(() => ({
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
          signal: linked.signal,
        }).catch(() => ({ mlbPlatoon: {}, mlbGameEnv: {} }))
      : Promise.resolve({ mlbPlatoon: {}, mlbGameEnv: {} }),
    (hrBoardAsk || hasMlbProps) && activePropPool.length > 0
      ? prefetchPropPlayerHistory(activePropPool, {
          signal: linked.signal,
          maxPlayers: hrBoardAsk ? 24 : 16,
          concurrency: 6,
        }).catch(() => ({}))
      : Promise.resolve({} as Record<string, import("@/lib/pickScoreContext").PlayerHistorySlice>),
    boardSports.some((s) =>
      ["nfl", "ncaaf", "nba", "wnba", "ncaab", "nhl", "soccer", "mlb"].includes(s),
    )
      ? loadFootballOppRushDefense({
          espnGames: inputs.espnGames,
          signal: linked.signal,
        }).catch(() => ({}))
      : Promise.resolve({} as import("@/lib/footballOppDefenseContext").FootballOppDefenseMap),
    needFootballWx
      ? loadFootballScanContext({
          espnGames: inputs.espnGames,
          sports: boardSports,
          signal: linked.signal,
        }).catch(() => ({ footballGameEnv: {} }))
      : Promise.resolve({ footballGameEnv: {} }),
    // Game-line / mixed tickets need mlLean opponent comparison (NFL parity).
    !propsOnly || gameLinesOnly
      ? fetchBoardMatchupHistory({
          espnGames: inputs.espnGames,
          realOdds: scanRealOdds,
          signal: linked.signal,
          focalText: opts.askText,
          matchupCap: gameLinesOnly ? 20 : 12,
        }).catch(() => ({} as Record<string, MatchupHistoryEntry>))
      : Promise.resolve({} as Record<string, MatchupHistoryEntry>),
  ]);

  const [injuryPack, mlb, earlyHistory, oppRushDefense, football, matchupHistoryRaw] =
    await contextPromise;
  const matchupInjuries = attachMatchupInjuries(
    inputs.espnGames,
    injuryPack.injuriesBySport,
  );
  const injuryTeams = injuryPack.injuryTeams;
  mlbPlatoon = Object.keys(mlb.mlbPlatoon).length ? mlb.mlbPlatoon : undefined;
  const mergedEnv = {
    ...(mlb.mlbGameEnv ?? {}),
    ...(football.footballGameEnv ?? {}),
  };
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
    const built = await buildFootballPropsOnlyTicket({
      target,
      pool: activePropPool,
      realOdds: inputs.realOdds,
      teamIdMap,
      signal: linked.signal,
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
      onPartialPicks: (picks) => {
        opts.onPartialPicks?.(
          filterPicksForAskSports(
            filterPicksForCoachAskTeams(
              applyAskMarketFilters(picks),
              inputs.teamScope,
              inputs.excludedTeams,
            ),
            hardLockedSportsFromAsk(opts.askText),
          ),
        );
      },
    });
    const lockedSportsPropsOnly = hardLockedSportsFromAsk(opts.askText);
    let picks = filterPicksForAskSports(
      filterPicksForCoachAskTeams(
        applyAskMarketFilters(selectFinalCoachParlayPicks(built.picks)),
        inputs.teamScope,
        inputs.excludedTeams,
      ),
      lockedSportsPropsOnly,
    );

    // Locked market family graded but staged 0 — recover with the SAME allowlist
    // (more / same-stat `_alternate` posted lines + recovery odds slack).
    // Never clear allowedMarketKeys or cross-fill another stat family.
    let recoveredNote = "";
    const isMarketLocked = lockedKeys != null && lockedKeys.length > 0;
    // Canonical lock label from EXPLICIT_MARKET_LOCK_RULES (any sport/family).
    const lockedMarketLabel = lockedMarketLabelForAsk(opts.askText) ?? "market";
    const recoveryPool = isMarketLocked
      ? filterPropPoolByAskMarkets(
          askAllowsNcaafPlayerProps(opts.askText)
            ? inputs.propPool
            : filterNcaafPlayerPropsUnlessAsked(inputs.propPool, opts.askText),
          lockedKeys,
        )
      : filterPoolForFootballSkillRecovery(
          askAllowsNcaafPlayerProps(opts.askText)
            ? inputs.propPool
            : filterNcaafPlayerPropsUnlessAsked(inputs.propPool, opts.askText),
        );
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
        target,
        pool: recoveryPool.length ? recoveryPool : activePropPool,
        realOdds: inputs.realOdds,
        teamIdMap,
        signal: linked.signal,
        onStatus: opts.onStatus,
        playerHistory,
        oppRushDefense,
        espnGames: inputs.espnGames,
        mlbPlatoon,
        mlbGameEnv,
        recoveryFill: true,
        allowRareCountFamilyStack,
        onPartialPicks: (partial) => {
          // Preserve the original market lock when present.
          // Scope + delivery qualification before UI buffer — unsupported
          // period legs (e.g. Q3) must never paint mid-scan.
          opts.onPartialPicks?.(
            revalidateDeliveryPicks(
              filterPicksForAskSports(
                filterPicksForCoachAskTeams(
                  applyAskMarketFilters(partial),
                  inputs.teamScope,
                  inputs.excludedTeams,
                ),
                lockedSportsPropsOnly,
              ),
            ).picks,
          );
        },
      });
      const recoveredPicks = recoverQualifiedDeliveryPicks(
        filterPicksForAskSports(
          filterPicksForCoachAskTeams(
            applyAskMarketFilters(selectFinalCoachParlayPicks(recovered.picks)),
            inputs.teamScope,
            inputs.excludedTeams,
          ),
          lockedSportsPropsOnly,
        ),
        marketConstraint,
        { requestedLegs: target },
      );
      if (recoveredPicks.length > 0) {
        picks = recoveredPicks;
        recoveredNote = isMarketLocked
          ? recovered.picks.length < target
            ? lockedMarketQualityShortfallNote({
                requestedLegs: target,
                analyzed: built.propLegsScored,
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
          target,
          pool: activePropPool,
          realOdds: inputs.realOdds,
          teamIdMap,
          signal: linked.signal,
          onStatus: opts.onStatus,
          playerHistory,
          oppRushDefense,
          espnGames: inputs.espnGames,
          mlbPlatoon,
          mlbGameEnv,
          recoveryFill: true,
          allowRareCountFamilyStack,
          onPartialPicks: (partial) => {
            opts.onPartialPicks?.(
              revalidateDeliveryPicks(
                filterPicksForAskSports(
                  filterPicksForCoachAskTeams(
                    applyAskMarketFilters(partial),
                    inputs.teamScope,
                    inputs.excludedTeams,
                  ),
                  lockedSportsPropsOnly,
                ),
              ).picks,
            );
          },
        });
        const softPicks = recoverQualifiedDeliveryPicks(
          filterPicksForAskSports(
            filterPicksForCoachAskTeams(
              applyAskMarketFilters(selectFinalCoachParlayPicks(softPreferred.picks)),
              inputs.teamScope,
              inputs.excludedTeams,
            ),
            lockedSportsPropsOnly,
          ),
          marketConstraint,
          { requestedLegs: target },
        );
        if (softPicks.length > 0) {
          picks = softPicks;
          recoveredNote =
            softPicks.length < target
              ? lockedMarketQualityShortfallNote({
                  requestedLegs: target,
                  analyzed: built.propLegsScored,
                  qualified: picks.length,
                  marketLabel: lockedMarketLabel,
                })
              : `Staged ${picks.length} matching real lines for the requested market.`;
        } else {
          recoveredNote = isMarketLocked
            ? lockedMarketQualityShortfallNote({
                requestedLegs: target,
                analyzed: built.propLegsScored,
                qualified: 0,
                marketLabel: lockedMarketLabel,
              })
            : `Graded ${built.propLegsScored} locked-market props and ${recovered.propLegsScored} skill alts (yards / receptions / sacks) — none cleared recovery odds. No ungraded filler was added.`;
        }
      }
    }

    // Locked-market shortfall copy (0 analyzed, 0/N, or partial) — UI only; selection unchanged.
    if (isMarketLocked && picks.length < target) {
      const shortfallNote = lockedMarketQualityShortfallNote({
        requestedLegs: target,
        analyzed: built.propLegsScored,
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
    // Final belt — recovery/top-up must not reintroduce another local day,
    // excluded matchup, opposing players, or foreign sport on a hard-locked ask.
    picks = filterPicksForSlateDay(picks, inputs.slateDay);
    picks = filterPicksForCoachAskTeams(picks, inputs.teamScope, inputs.excludedTeams);
    picks = applyAskMarketFilters(picks);
    picks = filterPicksForAskSports(picks, lockedSportsPropsOnly);
    const shortfall = resolveCoachParlayShortfallLead({
      askText: opts.askText ?? "",
      requestedLegs: target,
      qualified: picks.length,
      analyzed: built.propLegsScored,
      isMarketLocked,
    });
    const sportShortfall = sportScopeShortfallNote(
      opts.askText,
      target,
      picks.length,
      lockedSportsPropsOnly,
    );
    const mismatchLead = coachPropsAskGameLineMismatchNote({
      askText: opts.askText,
      propsOnly: true,
      picks,
    });
    // built.note may be null (e.g. bareCollegeClarificationNote) — never call .trim on it.
    const body =
      recoveredNote ||
      joinCoachNoteParts([built.note]) ||
      buildFinalCoachParlayNote({
        target,
        picks,
        propPoolSize,
        propsPending: false,
        shortfallLead: teamMiss || teamShortfall || sportShortfall || shortfall,
        propsOnly: true,
        requirePropMix: false,
      });
    // Mismatch lead first — phone shows it above pick cards when game lines leak.
    const note = sanitizeCoachUserNote(joinCoachNoteParts([mismatchLead, body]));
    const teamGameScopeDiagnostics = buildCoachTeamGameScopeDiagnostics({
      requestedLegs: target,
      scope: inputs.teamScope,
      gamesBeforeFilter: inputs.oddsGamesBeforeTeamFilter,
      gamesAfterFilter: inputs.oddsGames,
      finalLegCount: picks.length,
    });
    // Fire-and-forget reliability — props-only early return must still emit.
    // Do not await; grounding vs legitimate-underfill is classified inside.
    reportCoachScanReliability({
      requestId: coachRelRequestId,
      sportCategory: coachRelSport,
      requestedLegCount: target,
      returnedLegCount: picks.length,
      durationMs: Date.now() - coachRelStarted,
      realOddsAvailable:
        (inputs.realOdds?.length ?? 0) > 0 || (inputs.oddsGames?.length ?? 0) > 0,
      picks,
      timedOut: false,
      scanMissing: false,
    });
    // If post-filters wiped a non-empty ticket, keep the honest empty lead —
    // never append `[POST_FILTER_EMPTY: …]` into the Coach chat bubble.
    if (built.picks.length > 0 && picks.length === 0 && !recoveredNote) {
      return {
        picks,
        note,
        scan: null,
        timedOut: false,
        propPoolSize,
        teamGameScopeDiagnostics,
      };
    }
    return {
      picks,
      note,
      scan: null,
      timedOut: false,
      propPoolSize,
      teamGameScopeDiagnostics,
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
  const scanPromise = tryReachFullBoardScan({
    target,
    oddsGames: inputs.oddsGames,
    propPool: activePropPool,
    realOdds: scanRealOdds,
    liveOdds: scanLiveOdds,
    espnGames: inputs.espnGames,
    gameMeta: [],
    teamIdMap,
    excludedTeams: inputs.excludedTeams,
    signal: linked.signal,
    skipPropPoolExpand: skipPropExpand,
    // Belt expand path even if skipPropExpand is false — never sim off-ask markets.
    propMarketAllowlist: marketConstraint.allowedMarketKeys ?? null,
    prioritySports: inputs.prioritySports,
    propsOnly,
    exhaustPropBoard: hrBoardAsk,
    legsPerGameCap: legsPerGameCap ?? undefined,
    gameLinesOnly,
    fullGameOnly,
    excludeTotals,
    collegeTeamMarketStacks: collegeTeamMarketStacks || undefined,
    requirePropMix,
    excludeNcaafPlayerProps: !askAllowsNcaafPlayerProps(opts.askText),
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
      ...recentParlayVarietyContext({
        allowedSports: hardLockedSportsFromAsk(opts.askText),
      }),
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
      latest = partial;
      // Scope + market + delivery qualification before any UI buffer —
      // unsupported period legs (Q3 etc.) and ask-excluded markets must never
      // paint mid-scan or be counted as "props/alts".
      const scopedPartialPicks = revalidateDeliveryPicks(
        applyAskMarketFilters(
          filterPicksForAskSports(
            filterPicksForCoachAskTeams(
              partial.picks ?? [],
              inputs.teamScope,
              inputs.excludedTeams,
            ),
            hardLockedSportsFromAsk(opts.askText),
          ),
        ),
      ).picks;
      const propLike = countPropLike(scopedPartialPicks);
      if (!gameLinesOnly && partial.awaitingPropSlots && propLike === 0) {
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
          gameLinesOnly
            ? excludeTotals
              ? `Scoring ticket… ${scopedPartialPicks.length} legs (spreads/moneylines)`
              : `Scoring game lines… ${scopedPartialPicks.length} so far`
            : propLike > 0
              ? `Scoring ticket… ${scopedPartialPicks.length} legs (${propLike} props/alts)`
              : `Scoring game lines… ${scopedPartialPicks.length} so far — props next`,
        );
        opts.onPartialPicks?.(scopedPartialPicks);
      }
    },
    requestId: coachRelRequestId,
  });

  const remainingMs = Math.max(0, deadlineAt - Date.now());
  const timed = await raceAbortableDeadline(
    scanPromise.then((scan) => ({ scan, timedOut: false as const })),
    remainingMs,
    linked.signal,
    { scan: null, timedOut: true as const },
  );
  if (timed.timedOut) linked.abort();

  const scan = timed.scan ?? latest ?? null;
  const propsStillPending = (s: FullBoardScanResult | null | undefined) =>
    !!s &&
    countPropLike(s.picks ?? []) === 0 &&
    (!!s.awaitingPropSlots || !!s.propPhaseIncomplete);

  const rawPicks = scan?.picks?.length ? [...scan.picks].slice(0, target) : [];
  const teamScope = inputs.teamScope;
  const lockedSports = hardLockedSportsFromAsk(opts.askText);
  let picks = filterPicksForAskSports(
    filterPicksForCoachAskTeams(
      applyAskMarketFilters(selectFinalCoachParlayPicks(rawPicks)),
      teamScope,
      inputs.excludedTeams,
    ),
    lockedSports,
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
      applyAskMarketFilters(enforced.picks),
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
        allowedSports: lockedSports,
      });
      picks = filterPicksForAskSports(
        filterPicksForCoachAskTeams(
          applyAskMarketFilters(picks),
          teamScope,
          inputs.excludedTeams,
        ),
        lockedSports,
      );
    }
  }
  // Same-ticket ladder ban — never ship Colts +4.5 and +3.5 together.
  picks = dedupePicksByMarketLadder(picks);
  // One team per game (Final AI/value) — ladder keys are side-specific so
  // opposite ML/spread can otherwise both survive. Uses scan sims when present.
  if (!propsOnly && picks.some((p) => !p.isProp)) {
    picks = finalizeCoachDeliveryPicks(picks, {
      simByGame: scan?.gameSimulations ?? latest?.gameSimulations,
      matchupHistory,
      requestedLegs: target,
      legsPerGameCap: legsPerGameCap ?? null,
    });
  }
  // Final belt — staging/top-up must not reintroduce another local day
  // or an explicitly excluded matchup / foreign sport / opposing players.
  picks = filterPicksForSlateDay(picks, inputs.slateDay);
  picks = filterPicksForCoachAskTeams(picks, teamScope, inputs.excludedTeams);
  picks = applyAskMarketFilters(picks);
  picks = filterPicksForAskSports(picks, lockedSports);
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
  // Market restriction, Final AI qualification, ladder dedupe, and the
  // per-game correlation cap. Exception recovery uses the same function.
  picks = recoverQualifiedDeliveryPicks(picks, marketConstraint, {
    requestedLegs: target,
    legsPerGameCap,
  });
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
  const collegeClarify = bareCollegeClarificationNote(opts.askText);
  const sidesShortfall = asksSpreadAndMoneylineOnly(opts.askText)
    ? spreadMoneylineOnlyShortfallLead(target, finalLegCount)
    : "";
  const sportShortfall = sportScopeShortfallNote(
    opts.askText,
    target,
    finalLegCount,
    lockedSports,
  );
  // P0 board exit already wrote an honest note — do not replace with quality-bar copy.
  const p0BoardBlocked = scan?.failureReason?.code === "P0_UNVALIDATED_MARKETS";
  // collegeClarify is string | null. A bare .trim() on that array rejected the
  // whole build after scoring (device stayed on the last "Scoring ticket…" card).
  let note = "";
  try {
    const body = p0BoardBlocked
      ? String(scan?.note ?? "").trim()
      : buildFinalCoachParlayNote({
          target,
          picks,
          propPoolSize,
          propsPending: gameLinesOnly ? false : propsPending,
          shortfallLead:
            teamMiss || teamShortfall || sidesShortfall || sportShortfall || shortfall,
          timedOut: timed.timedOut,
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
    // Clarification / mismatch leads first — phone shows them above pick cards.
    note = sanitizeCoachUserNote(
      joinCoachNoteParts([collegeClarify, mismatchLead, mlLeanNote, body]),
    );
  } catch {
    picks = recoverQualifiedDeliveryPicks(picks, marketConstraint, {
      requestedLegs: target,
      legsPerGameCap,
    });
    const recoveredCount = picks.length;
    const recoveredSides = asksSpreadAndMoneylineOnly(opts.askText)
      ? spreadMoneylineOnlyShortfallLead(target, recoveredCount)
      : "";
    note = sanitizeCoachUserNote(
      joinCoachNoteParts([
        recoveredSides,
        recoveredCount > 0
          ? `Showing ${recoveredCount} qualifying legs.`
          : "No qualifying picks cleared.",
      ]),
    );
  }

  const teamGameScopeDiagnostics = buildCoachTeamGameScopeDiagnostics({
    requestedLegs: target,
    scope: teamScope,
    gamesBeforeFilter: inputs.oddsGamesBeforeTeamFilter,
    gamesAfterFilter: inputs.oddsGames,
    finalLegCount: picks.length,
  });

  // Fire-and-forget reliability — after ticket is finalized; never awaits.
  // Funnel counters stay request-linked; correlation attribution requires
  // confirmed coach-events receipt (Telegram ingest may be UNVERIFIED).
  const funnelSummary = footballPropFunnelSummaryForRequest(scan?.manifest ?? null);
  reportCoachScanReliability({
    requestId: coachRelRequestId,
    sportCategory: coachRelSport,
    requestedLegCount: target,
    returnedLegCount: picks.length,
    durationMs: Date.now() - coachRelStarted,
    realOddsAvailable: (scanRealOdds?.length ?? 0) > 0 || (inputs.oddsGames?.length ?? 0) > 0,
    scanFailureCode: scan?.failureReason?.code ?? null,
    scanFailureDetail: scan?.failureReason?.detail ?? null,
    picks,
    timedOut: timed.timedOut,
    scanMissing: !scan,
    rootCause: funnelSummary,
  });

  return {
    picks,
    note,
    scan,
    timedOut: timed.timedOut,
    propPoolSize,
    teamGameScopeDiagnostics,
  };
  })();
  } finally {
    linked.dispose();
  }
}
