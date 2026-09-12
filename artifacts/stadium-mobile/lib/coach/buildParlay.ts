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
} from "@/lib/boardScanPropDelivery";
import { buildGameTeamIdMap } from "@/lib/coachGameMonteCarlo";
import { buildFixedLegCountShortfallLead } from "@/lib/coachScanPolicy";
import { coachAbsoluteBudgetMs } from "@/lib/coach/session";
import { shouldSkipScannerPropExpand } from "@/lib/coach/propPoolPolicy";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { filterBettableOddsGames } from "@/lib/slate";

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
  return picks.filter((p) => p.isProp || /alt/i.test(p.market || "")).length;
}

async function loadScanInputs(
  signal: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<{
  espnGames: EspnGame[];
  oddsGames: OddsGame[];
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  liveOdds: RealOddsEntry[];
}> {
  const sports = DEFAULT_SPORTS;
  onStatus?.("Loading tonight's board…");
  const [espnGames, oddsRaw, liveFeed] = await Promise.all([
    Promise.all(sports.map((s) => getGames(s, signal).catch(() => [] as EspnGame[]))).then((rows) =>
      rows.flat(),
    ),
    Promise.all(sports.map((s) => getOdds(s, signal).catch(() => [] as OddsGame[]))).then((rows) =>
      filterBettableOddsGames(rows.flat()),
    ),
    getLiveOdds(sports, signal).catch(() => ({ games: [], odds: [] as RealOddsEntry[] })),
  ]);

  const oddsGames = oddsRaw;
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
  };
}

export async function buildCoachParlay(opts: {
  requestedLegs: number;
  signal: AbortSignal;
  onStatus?: (status: string) => void;
  onPartialPicks?: (picks: ParsedPick[]) => void;
  /** Fires after prop/alt board load — UI should start the scoring absolute clock here. */
  onReadyToScan?: (info: { propPoolSize: number }) => void;
}): Promise<CoachParlayBuildResult> {
  const target = Math.max(3, Math.min(opts.requestedLegs || 6, 25));
  const budgetMs = coachAbsoluteBudgetMs(target);

  const inputs = await loadScanInputs(opts.signal, opts.onStatus);
  if (opts.signal.aborted) {
    return { picks: [], note: "", scan: null, timedOut: false, propPoolSize: 0 };
  }

  const propPoolSize = inputs.propPool.length;
  opts.onReadyToScan?.({ propPoolSize });
  opts.onStatus?.(
    propPoolSize > 0
      ? `Scanning ${propPoolSize} posted props/alts plus game lines for a ${target}-leg ticket…`
      : `Scanning posted game lines for a ${target}-leg ticket…`,
  );

  const teamIdMap = buildGameTeamIdMap(inputs.espnGames);
  const skipPropExpand = shouldSkipScannerPropExpand(propPoolSize);

  let latest: FullBoardScanResult | null = null;
  const scanPromise = tryReachFullBoardScan({
    target,
    oddsGames: inputs.oddsGames,
    propPool: inputs.propPool,
    realOdds: inputs.realOdds,
    liveOdds: inputs.liveOdds,
    espnGames: inputs.espnGames,
    gameMeta: [],
    teamIdMap,
    signal: opts.signal,
    skipPropPoolExpand: skipPropExpand,
    varietySeed: `greenfield-${target}-${Date.now()}`,
    onPartial: (partial) => {
      latest = partial;
      const propLike = countPropLike(partial.picks ?? []);
      if (partial.awaitingPropSlots && propLike === 0) {
        // Reserved game-line preview (often exactly 2 on a 5/6-leg) must not paint
        // as the ticket before props/alts have had a chance to score.
        opts.onStatus?.(
          propPoolSize > 0
            ? `Scoring game lines… props/alts next (${propPoolSize} posted)`
            : `Scoring game lines… ${partial.picks?.length ?? 0} so far`,
        );
        return;
      }
      if (partial.picks?.length) {
        opts.onStatus?.(
          propLike > 0
            ? `Scoring ticket… ${partial.picks.length} legs (${propLike} props/alts)`
            : `Scoring game lines… ${partial.picks.length} so far — props next`,
        );
        opts.onPartialPicks?.(partial.picks);
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
  if (
    timed.timedOut &&
    !opts.signal.aborted &&
    propPoolSize > 0 &&
    propsStillPending(scan)
  ) {
    opts.onStatus?.(`Finishing prop/alt scoring (${propPoolSize} posted)…`);
    const graceMs = Math.min(20_000, Math.max(8_000, Math.round(budgetMs * 0.25)));
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
    scan = await scanPromise.catch(() => null);
  }

  const rawPicks = scan?.picks?.length ? [...scan.picks].slice(0, target) : [];
  const picks = selectFinalCoachParlayPicks(rawPicks);
  const shortfall = buildFixedLegCountShortfallLead(target, picks.length);
  const propsPending =
    propsStillPending(scan) ||
    propsStillPending(latest) ||
    !!scan?.propPhaseIncomplete;
  const note = buildFinalCoachParlayNote({
    target,
    picks,
    propPoolSize,
    propsPending,
    shortfallLead: shortfall,
    timedOut: timed.timedOut,
    budgetMs,
    scanMissing: !scan,
    scanNote: scan?.note,
    failureReason: scan?.failureReason,
    failureDiagnostics: scan?.failureDiagnostics,
  });

  return { picks, note, scan, timedOut: timed.timedOut, propPoolSize };
}
