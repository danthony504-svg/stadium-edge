/**
 * Greenfield parlay build — board scan only, hard wall-clock, no delivery limbo.
 */

import type { ParsedPick } from "@/components/PickCard";
import {
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
import { buildGameTeamIdMap } from "@/lib/coachGameMonteCarlo";
import { buildFixedLegCountShortfallLead } from "@/lib/coachScanPolicy";
import { coachAbsoluteBudgetMs } from "@/lib/coach/session";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { filterBettableOddsGames } from "@/lib/slate";

export type CoachParlayBuildResult = {
  picks: ParsedPick[];
  note: string;
  scan: FullBoardScanResult | null;
  timedOut: boolean;
};

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

async function loadScanInputs(signal: AbortSignal): Promise<{
  espnGames: EspnGame[];
  oddsGames: OddsGame[];
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  liveOdds: RealOddsEntry[];
}> {
  const sports = DEFAULT_SPORTS.slice(0, 8);
  const [espnGames, oddsRaw, liveFeed] = await Promise.all([
    Promise.all(sports.map((s) => getGames(s, signal).catch(() => [] as EspnGame[]))).then((rows) =>
      rows.flat(),
    ),
    Promise.all(sports.map((s) => getOdds(s, signal).catch(() => [] as OddsGame[]))).then((rows) =>
      filterBettableOddsGames(rows.flat()),
    ),
    getLiveOdds(sports, signal).catch(() => ({ games: [], odds: [] as RealOddsEntry[] })),
  ]);

  return {
    espnGames,
    oddsGames: oddsRaw,
    propPool: [] as PropPoolEntry[],
    realOdds: realOddsFromOddsGames(oddsRaw),
    liveOdds: liveFeed.odds ?? [],
  };
}

export async function buildCoachParlay(opts: {
  requestedLegs: number;
  signal: AbortSignal;
  onStatus?: (status: string) => void;
  onPartialPicks?: (picks: ParsedPick[]) => void;
}): Promise<CoachParlayBuildResult> {
  const target = Math.max(3, Math.min(opts.requestedLegs || 6, 25));
  const budgetMs = coachAbsoluteBudgetMs(target);
  opts.onStatus?.("Loading tonight's board…");

  const inputs = await loadScanInputs(opts.signal);
  if (opts.signal.aborted) {
    return { picks: [], note: "", scan: null, timedOut: false };
  }

  opts.onStatus?.(`Scanning posted markets for a ${target}-leg ticket…`);
  const teamIdMap = buildGameTeamIdMap(inputs.espnGames);

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
    onPartial: (partial) => {
      latest = partial;
      if (partial.picks?.length) opts.onPartialPicks?.(partial.picks);
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

  const scan = timed.scan ?? latest ?? (await scanPromise.catch(() => null));
  const picks = scan?.picks?.length ? [...scan.picks].slice(0, target) : [];
  const shortfall = buildFixedLegCountShortfallLead(target, picks.length);
  const note =
    (scan?.note && scan.note.trim()) ||
    shortfall ||
    (timed.timedOut
      ? `Stopped at the ${Math.round(budgetMs / 1000)}s delivery budget — showing every AI-backed pick that cleared so far.`
      : picks.length
        ? ""
        : `No AI-backed picks cleared the quality bar for a ${target}-leg ticket.`);

  return { picks, note, scan, timedOut: timed.timedOut };
}
