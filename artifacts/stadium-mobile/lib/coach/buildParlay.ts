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
import { buildGameTeamIdMap } from "@/lib/coachGameMonteCarlo";
import { coachAbsoluteBudgetMs } from "@/lib/coach/session";
import { shouldSkipScannerPropExpand } from "@/lib/coach/propPoolPolicy";
import { prioritySportsForAsk } from "@/lib/chatContextPriority";
import { coachBoardSportsForAsk } from "@/lib/coachPropBoardCoverage";
import {
  coachAskTeamMissNote,
  coachAskTeamScope,
  filterOddsGamesForAskTeam,
  filterPicksForAskTeam,
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
  slateDay: SlateDay;
}> {
  // Named league(s) scope the board (CFB stays CFB). Generic asks union every
  // player-prop league (incl. ncaab) so mains+alts across sports enter the pool.
  const sports = coachBoardSportsForAsk(askText, requestedLegs, DEFAULT_SPORTS);
  const prioritySports = prioritySportsForAsk(askText);
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

  // "6 leg Saints" / "7 leg saints game" → keep only that franchise's matchup.
  // Sport scoping alone still allowed other NFL games to fill a team ask.
  const teamScope = coachAskTeamScope(askText);
  let oddsGames = filterOddsGamesForAskTeam(oddsRaw, teamScope);
  let espnGames = filterOddsGamesForAskTeam(espnGamesRaw, teamScope);

  // "7 leg for today" / "tonight" / "tomorrow" — restrict the board BEFORE props
  // and game lines are discovered so recovery/top-up cannot reintroduce other days.
  // Bare "7 leg" keeps the existing 48h bettable window (slateDay null).
  const slateDay = slateDayFromThread(askText ?? "", priorUserTexts);
  oddsGames = filterOddsGamesForSlateDay(oddsGames, slateDay);
  espnGames = filterOddsForSlateDay(espnGames, slateDay);

  onStatus?.("Loading player props and alt lines across the board…");
  let propPool = await fetchFullBoardPropPool(oddsGames, espnGames, [], signal).catch(
    () => [] as PropPoolEntry[],
  );
  // Belt: drop any row whose kickoff slipped outside the requested local day.
  propPool = filterOddsForSlateDay(propPool, slateDay);

  return {
    espnGames,
    oddsGames,
    propPool,
    realOdds: realOddsFromOddsGames(oddsGames),
    liveOdds: filterOddsForSlateDay(liveFeed.odds ?? [], slateDay),
    sports,
    prioritySports,
    teamScope,
    slateDay,
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
  /** Fires after prop/alt board load — UI should start the scoring absolute clock here. */
  onReadyToScan?: (info: { propPoolSize: number }) => void;
}): Promise<CoachParlayBuildResult> {
  const target = Math.max(3, Math.min(opts.requestedLegs || 6, 25));
  const budgetMs = coachAbsoluteBudgetMs(target);

  const inputs = await loadScanInputs(
    opts.signal,
    target,
    opts.askText,
    opts.onStatus,
    opts.priorUserTexts ?? [],
  );
  if (opts.signal.aborted) {
    return { picks: [], note: "", scan: null, timedOut: false, propPoolSize: 0 };
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
    loadBoardInjuries(boardSports, opts.signal).catch(() => ({
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
          signal: opts.signal,
        }).catch(() => ({ mlbPlatoon: {}, mlbGameEnv: {} }))
      : Promise.resolve({ mlbPlatoon: {}, mlbGameEnv: {} }),
    (hrBoardAsk || hasMlbProps) && activePropPool.length > 0
      ? prefetchPropPlayerHistory(activePropPool, {
          signal: opts.signal,
          maxPlayers: hrBoardAsk ? 24 : 16,
          concurrency: 6,
        }).catch(() => ({}))
      : Promise.resolve({} as Record<string, import("@/lib/pickScoreContext").PlayerHistorySlice>),
    boardSports.some((s) =>
      ["nfl", "ncaaf", "nba", "wnba", "ncaab", "nhl", "soccer", "mlb"].includes(s),
    )
      ? loadFootballOppRushDefense({
          espnGames: inputs.espnGames,
          signal: opts.signal,
        }).catch(() => ({}))
      : Promise.resolve({} as import("@/lib/footballOppDefenseContext").FootballOppDefenseMap),
    needFootballWx
      ? loadFootballScanContext({
          espnGames: inputs.espnGames,
          sports: boardSports,
          signal: opts.signal,
        }).catch(() => ({ footballGameEnv: {} }))
      : Promise.resolve({ footballGameEnv: {} }),
    // Game-line / mixed tickets need mlLean opponent comparison (NFL parity).
    !propsOnly || gameLinesOnly
      ? fetchBoardMatchupHistory({
          espnGames: inputs.espnGames,
          realOdds: scanRealOdds,
          signal: opts.signal,
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
    const built = await buildFootballPropsOnlyTicket({
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
      allowRareCountFamilyStack,
      onPartialPicks: (picks) => {
        opts.onPartialPicks?.(
          filterPicksByAskMarketConstraint(picks, marketConstraint),
        );
      },
    });
    let picks = filterPicksForAskTeam(
      filterPicksByAskMarketConstraint(
        selectFinalCoachParlayPicks(built.picks),
        marketConstraint,
      ),
      inputs.teamScope,
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
        signal: opts.signal,
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
          opts.onPartialPicks?.(
            filterPicksByAskMarketConstraint(partial, marketConstraint),
          );
        },
      });
      const recoveredPicks = filterPicksForAskTeam(
        filterPicksByAskMarketConstraint(
          selectFinalCoachParlayPicks(recovered.picks),
          marketConstraint,
        ),
        inputs.teamScope,
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
          signal: opts.signal,
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
              filterPicksByAskMarketConstraint(partial, marketConstraint),
            );
          },
        });
        const softPicks = filterPicksForAskTeam(
          filterPicksByAskMarketConstraint(
            selectFinalCoachParlayPicks(softPreferred.picks),
            marketConstraint,
          ),
          inputs.teamScope,
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
    // Final belt — recovery/top-up must not reintroduce another local day.
    picks = filterPicksForSlateDay(picks, inputs.slateDay);
    const shortfall = resolveCoachParlayShortfallLead({
      askText: opts.askText,
      requestedLegs: target,
      qualified: picks.length,
      analyzed: built.propLegsScored,
      isMarketLocked,
    });
    const mismatchLead = coachPropsAskGameLineMismatchNote({
      askText: opts.askText,
      propsOnly: true,
      picks,
    });
    const body =
      recoveredNote ||
      built.note.trim() ||
      buildFinalCoachParlayNote({
        target,
        picks,
        propPoolSize,
        propsPending: false,
        shortfallLead: teamMiss || shortfall,
        propsOnly: true,
        requirePropMix: false,
      });
    // Mismatch lead first — phone shows it above pick cards when game lines leak.
    const note = sanitizeCoachUserNote(
      [mismatchLead, body].filter((s) => s.trim()).join("\n\n"),
    );
    // If post-filters wiped a non-empty ticket, keep the honest empty lead —
    // never append `[POST_FILTER_EMPTY: …]` into the Coach chat bubble.
    if (built.picks.length > 0 && picks.length === 0 && !recoveredNote) {
      return {
        picks,
        note,
        scan: null,
        timedOut: false,
        propPoolSize,
      };
    }
    return {
      picks,
      note,
      scan: null,
      timedOut: false,
      propPoolSize,
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
    signal: opts.signal,
    skipPropPoolExpand: skipPropExpand,
    prioritySports: inputs.prioritySports,
    propsOnly,
    exhaustPropBoard: hrBoardAsk,
    legsPerGameCap: legsPerGameCap ?? undefined,
    gameLinesOnly,
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
    varietyContext: {
      ...recentParlayVarietyContext(),
      ...(askWantsAllNewPicks(opts.askText) ? { hardAvoidRecentLegs: true } : {}),
    },
    onPartial: (partial) => {
      latest = partial;
      const propLike = countPropLike(partial.picks ?? []);
      if (partial.awaitingPropSlots && propLike === 0) {
        // Reserved game-line preview (often exactly 2 on a 5/6-leg) must not paint
        // as the ticket before props/alts have had a chance to score.
        // When propsOnly, skip this game-line preview path entirely.
        if (propsOnly) return;
        opts.onStatus?.(
          propPoolSize > 0
            ? `Scoring game lines… props/alts next (${propPoolSize} posted)`
            : `Scoring game lines… ${partial.picks?.length ?? 0} so far`,
        );
        // Still buffer reserved game lines for the absolute-budget hang guard —
        // UI publish policy keeps cards hidden until terminal, but an empty
        // buffer was latching "delivery budget… composer unlocked" with 0 cards.
        if (partial.picks?.length) {
          opts.onPartialPicks?.(partial.picks);
        }
        return;
      }
      if (partial.picks?.length) {
        opts.onStatus?.(
          propLike > 0
            ? `Scoring ticket… ${partial.picks.length} legs (${propLike} props/alts)`
            : `Scoring game lines… ${partial.picks.length} so far — props next`,
        );
        opts.onPartialPicks?.(
          propsOnly
            ? filterPicksByAskMarketConstraint(partial.picks, marketConstraint)
            : partial.picks,
        );
      }
    },
    requestId: `greenfield-${Date.now()}`,
  });

  const timed = await Promise.race([
    scanPromise.then((scan) => ({ scan, timedOut: false as const })),
    new Promise<{ scan: null; timedOut: true }>((resolve) => {
      const t = setTimeout(() => resolve({ scan: null, timedOut: true }), budgetMs);
      opts.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve({ scan: null, timedOut: true });
        },
        { once: true },
      );
    }),
  ]);

  let scan = timed.scan ?? latest ?? null;
  const propsStillPending = (s: FullBoardScanResult | null | undefined) =>
    !!s &&
    countPropLike(s.picks ?? []) === 0 &&
    (!!s.awaitingPropSlots || !!s.propPhaseIncomplete);

  // Budget hit while props were still pending — grace window when the pool was
  // already loaded (5-leg→2 totals / 7-leg→3 F5 lines failure modes).
  // Football mix gets a longer grace so skill props can finish before we refuse.
  if (
    timed.timedOut &&
    !opts.signal.aborted &&
    propPoolSize > 0 &&
    propsStillPending(scan)
  ) {
    opts.onStatus?.(`Finishing prop/alt scoring (${propPoolSize} posted)…`);
    const graceMs = requirePropMix
      ? Math.min(35_000, Math.max(15_000, Math.round(budgetMs * 0.35)))
      : Math.min(20_000, Math.max(8_000, Math.round(budgetMs * 0.25)));
    const grace = await Promise.race([
      scanPromise.then((s) => ({ scan: s })),
      new Promise<{ scan: null }>((resolve) => {
        const t = setTimeout(() => resolve({ scan: null }), graceMs);
        opts.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve({ scan: null });
          },
          { once: true },
        );
      }),
    ]);
    if (grace.scan) scan = grace.scan;
    else scan = latest ?? scan;
  } else if (!scan) {
    // Never await a hung scan forever after the delivery budget — that left
    // Coach on "Scoring ticket… 1 legs" with no terminal latch.
    scan = await Promise.race([
      scanPromise.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500)),
    ]);
    if (!scan) scan = latest;
  }

  const rawPicks = scan?.picks?.length ? [...scan.picks].slice(0, target) : [];
  const teamScope = inputs.teamScope;
  let picks = filterPicksForAskTeam(
    filterPicksByAskMarketConstraint(
      selectFinalCoachParlayPicks(rawPicks),
      marketConstraint,
    ),
    teamScope,
  );
  // Lock ML / puck-line / spread sides to real mlLean when present — opponent
  // comparison like NFL, not freeform chat inventing home-ice one-liners.
  let mlLeanNote = "";
  if (!propsOnly && matchupHistory && picks.some((p) => !p.isProp)) {
    const enforced = enforceMlLeanOnPicks(picks, {
      matchupHistory,
      realOdds: scanRealOdds,
      gameMeta: [],
    });
    picks = filterPicksByAskMarketConstraint(enforced.picks, marketConstraint);
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
  // Same-ticket ladder ban — never ship Colts +4.5 and +3.5 together.
  picks = dedupePicksByMarketLadder(picks);
  // Final belt — staging/top-up must not reintroduce another local day.
  picks = filterPicksForSlateDay(picks, inputs.slateDay);
  if (picks.length) rememberParlayBuild(picks);
  const teamMiss = coachAskTeamMissNote(teamScope, inputs.oddsGames.length);
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
  const shortfall = resolveCoachParlayShortfallLead({
    askText: opts.askText,
    requestedLegs: target,
    qualified: picks.length,
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
    shortfallLead: teamMiss || shortfall,
    timedOut: timed.timedOut,
    budgetMs,
    scanMissing: !scan,
    scanNote: scan?.note,
    failureReason: scan?.failureReason,
    failureDiagnostics: scan?.failureDiagnostics,
    propsOnly,
    requirePropMix,
  });
  // Mismatch lead first — phone shows it above pick cards when game lines leak.
  const note = sanitizeCoachUserNote(
    [mismatchLead, mlLeanNote, body].filter((s) => s.trim()).join("\n\n"),
  );

  return { picks, note, scan, timedOut: timed.timedOut, propPoolSize };
}
