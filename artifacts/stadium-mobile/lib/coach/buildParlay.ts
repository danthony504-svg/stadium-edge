/**
 * Greenfield parlay build — board scan only, hard wall-clock, no delivery limbo.
 *
 * Must load the full posted prop board (mains + alts) BEFORE scoring. An empty
 * propPool was the "2 game totals for a 5-leg" bug: game lines finished first,
 * absolute budget latched, props never scored.
 */

import type { ParsedPick } from "@/components/PickCard";
import {
  fetchFullBoardPropPool,
  getGames,
  getLiveOdds,
  getOdds,
  type EspnGame,
  type OddsGame,
  type PropPoolEntry,
  type RealOddsEntry,
} from "@/lib/api";
import {
  tryReachFullBoardScan,
  type FullBoardScanResult,
} from "@/lib/boardMarketScanner";
import {
  buildFinalCoachParlayNote,
  selectFinalCoachParlayPicks,
  askRequiresFootballPropMix,
  finalizeFootballPropMixPicks,
} from "@/lib/boardScanPropDelivery";
import { shouldBuildFootballPropsOnlyTicket } from "@/lib/coachFootballPropsOnly";
import { buildFootballPropsOnlyTicket } from "@/lib/coachFootballPropsOnlyTicket";
import { buildGameTeamIdMap } from "@/lib/coachGameMonteCarlo";
import { buildFixedLegCountShortfallLead } from "@/lib/coachScanPolicy";
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
import { filterBettableOddsGames } from "@/lib/slate";
import {
  filterPicksByAskMarketConstraint,
  filterPropPoolByAskMarkets,
  parseCoachAskMarketConstraint,
} from "@/lib/coachAskMarketFilter";
import { coachPropsAskGameLineMismatchNote } from "@/lib/coach/parseAsk";
import { legsPerGameCapForAsk } from "@/lib/parlayCorrelationScore";
import { filterHrScorerPoolEntries, isBatterHomeRunMarket } from "@/lib/coachHrRank";
import { loadMlbScanContext } from "@/lib/mlbScanContext";
import {
  attachMatchupInjuries,
  loadBoardInjuries,
  prefetchPropPlayerHistory,
} from "@/lib/coachBoardContext";


export type CoachParlayBuildResult = {
  picks: ParsedPick[];
  note: string;
  scan: FullBoardScanResult | null;
  timedOut: boolean;
  propPoolSize: number;
};

export { shouldSkipScannerPropExpand } from "./propPoolPolicy";

function realOddsFromOddsGames(oddsGames: OddsGame[]): RealOddsEntry[] {
  const out: RealOddsEntry[] = [];
  for (const g of oddsGames) {
    const game = `${g.awayTeam} @ ${g.homeTeam}`;
    for (const m of g.markets ?? []) {
      for (const o of m.outcomes ?? []) {
        if (typeof o.price !== "number" || !o.name) continue;
        out.push({
          sport: g.sport,
          game,
          market: m.key || "market",
          pick: o.name,
          odds: o.price,
          startsAt: g.commenceTime,
        });
      }
    }
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
): Promise<{
  espnGames: EspnGame[];
  oddsGames: OddsGame[];
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  liveOdds: RealOddsEntry[];
  sports: string[];
  prioritySports: readonly string[];
  teamScope: ReturnType<typeof coachAskTeamScope>;
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
  const oddsGames = filterOddsGamesForAskTeam(oddsRaw, teamScope);
  const espnGames = filterOddsGamesForAskTeam(espnGamesRaw, teamScope);
  onStatus?.("Loading player props and alt lines across the board…");
  const propPool = await fetchFullBoardPropPool(oddsGames, espnGames, [], signal).catch(
    () => [] as PropPoolEntry[],
  );

  return {
    espnGames,
    oddsGames,
    propPool,
    realOdds: realOddsFromOddsGames(oddsGames),
    liveOdds: liveFeed.odds ?? [],
    sports,
    prioritySports,
    teamScope,
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
  // "10 leg nfl" — not props-only, but props must be scored first and seats reserved.
  const requirePropMix =
    !propsOnly &&
    !gameLinesOnly &&
    askRequiresFootballPropMix(opts.askText);
  const legsPerGameCap = legsPerGameCapForAsk(target, {
    gameLinesOnly,
    maxGames: marketConstraint.maxGames,
  });
  // Game-lines-only asks skip the prop board entirely.
  const constrainedPropPool = gameLinesOnly ? [] : scanPropPool;
  const hrBoardAsk =
    propsOnly &&
    (marketConstraint.allowedMarketKeys ?? []).some((k) => isBatterHomeRunMarket(k));
  let mlbPlatoon: Record<string, unknown> | undefined;
  let mlbGameEnv: Record<string, unknown> | undefined;
  // Home-run asks want scorers — drop Under/No so MC budget hits Over 0.5.
  const activePropPool = hrBoardAsk
    ? filterHrScorerPoolEntries(constrainedPropPool)
    : constrainedPropPool;
  const propPoolSize = activePropPool.length;

  // Injuries for every board sport + (HR) MLB platoon/park + early Form history.
  // All in parallel so we don't add sequential wall time before scoring.
  opts.onStatus?.(
    hrBoardAsk && activePropPool.length > 0
      ? "Loading matchup, injuries, and recent form…"
      : "Loading injury context…",
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
  const contextPromise = Promise.all([
    loadBoardInjuries(boardSports, opts.signal).catch(() => ({
      injuriesBySport: {} as Record<string, import("@/lib/api").InjuryTeam[]>,
      matchupInjuries: {} as Record<string, import("@/lib/injuries").GameInjuryReport>,
      injuryTeams: [] as import("@/lib/api").InjuryTeam[],
    })),
    hrBoardAsk && activePropPool.length > 0
      ? loadMlbScanContext({
          propPool: activePropPool,
          espnGames: inputs.espnGames,
          hrOnly: true,
          signal: opts.signal,
        }).catch(() => ({ mlbPlatoon: {}, mlbGameEnv: {} }))
      : Promise.resolve({ mlbPlatoon: {}, mlbGameEnv: {} }),
    hrBoardAsk && activePropPool.length > 0
      ? prefetchPropPlayerHistory(activePropPool, {
          signal: opts.signal,
          maxPlayers: 24,
          concurrency: 6,
        }).catch(() => ({}))
      : Promise.resolve({} as Record<string, import("@/lib/pickScoreContext").PlayerHistorySlice>),
  ]);

  const [injuryPack, mlb, earlyHistory] = await contextPromise;
  const matchupInjuries = attachMatchupInjuries(
    inputs.espnGames,
    injuryPack.injuriesBySport,
  );
  const injuryTeams = injuryPack.injuryTeams;
  mlbPlatoon = Object.keys(mlb.mlbPlatoon).length ? mlb.mlbPlatoon : undefined;
  mlbGameEnv = Object.keys(mlb.mlbGameEnv).length ? mlb.mlbGameEnv : undefined;
  const playerHistory = Object.keys(earlyHistory).length ? earlyHistory : undefined;

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
    const built = await buildFootballPropsOnlyTicket({
      target,
      pool: activePropPool,
      realOdds: inputs.realOdds,
      teamIdMap,
      signal: opts.signal,
      onStatus: opts.onStatus,
      playerHistory,
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
    const teamMiss = coachAskTeamMissNote(inputs.teamScope, inputs.oddsGames.length);
    const shortfall = buildFixedLegCountShortfallLead(target, picks.length);
    const mismatchLead = coachPropsAskGameLineMismatchNote({
      askText: opts.askText,
      propsOnly: true,
      picks,
    });
    const body =
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
    const note = [mismatchLead, body].filter((s) => s.trim()).join("\n\n");
    // If post-filters wiped a non-empty ticket, append why so the phone shows it.
    if (built.picks.length > 0 && picks.length === 0) {
      return {
        picks,
        note: `${note} [POST_FILTER_EMPTY: built=${built.picks.length} afterTeamOrMarketFilter=0]`,
        scan: null,
        timedOut: false,
        propPoolSize,
      };
    } else if (teamMiss && picks.length === 0 && !note.includes("[")) {
      return {
        picks,
        note: `${note} [${teamMiss}]`,
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
  const skipPropExpand =
    propsOnly ||
    marketConstraint.allowedMarketKeys != null ||
    shouldSkipScannerPropExpand(propPoolSize);

  let latest: FullBoardScanResult | null = null;
  const scanPromise = tryReachFullBoardScan({
    target,
    oddsGames: inputs.oddsGames,
    propPool: activePropPool,
    realOdds: inputs.realOdds,
    liveOdds: inputs.liveOdds,
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
    requirePropMix,
    mlbPlatoon,
    mlbGameEnv,
    matchupInjuries: Object.keys(matchupInjuries).length ? matchupInjuries : undefined,
    injuryTeams: injuryTeams.length ? injuryTeams : undefined,
    playerHistory,
    varietySeed: `greenfield-${target}-${Date.now()}`,
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
  const propsPending =
    propsStillPending(scan) ||
    propsStillPending(latest) ||
    !!scan?.propPhaseIncomplete;
  // Football mix: hold prop seats while props incomplete; after props finish
  // with 0 clears, deliver scored game lines (never wipe to empty).
  if (requirePropMix) {
    picks = finalizeFootballPropMixPicks(picks, target, {
      propPhaseIncomplete: propsPending,
    });
  }
  const teamMiss = coachAskTeamMissNote(teamScope, inputs.oddsGames.length);
  const shortfall = buildFixedLegCountShortfallLead(target, picks.length);
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
  const note = [mismatchLead, body].filter((s) => s.trim()).join("\n\n");

  return { picks, note, scan, timedOut: timed.timedOut, propPoolSize };
}
