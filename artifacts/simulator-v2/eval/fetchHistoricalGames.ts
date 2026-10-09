/**
 * Fetch completed NFL/NCAAF games with verified quarter linescores from ESPN.
 * Disk-cached under eval/cache/ for reproducibility.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FootballSport, HistoricalGame, QuarterTuple } from "./types.js";

const ESPN_PATH: Record<FootballSport, string> = {
  nfl: "football/nfl",
  ncaaf: "football/college-football",
};

const CACHE_DIR = join(import.meta.dirname, "cache");

type EspnLinescore = { value?: number };
type EspnCompetitor = {
  homeAway?: string;
  score?: string | number;
  team?: { id?: string; displayName?: string; abbreviation?: string };
  linescores?: EspnLinescore[];
};
type EspnEvent = {
  id?: string;
  date?: string;
  name?: string;
  competitions?: Array<{
    competitors?: EspnCompetitor[];
    status?: { type?: { completed?: boolean; state?: string; name?: string } };
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asQuarterTuple(vals: number[]): QuarterTuple | null {
  if (vals.length < 4) return null;
  const q = vals.slice(0, 4);
  if (q.some((v) => !Number.isFinite(v) || v < 0)) return null;
  return [q[0]!, q[1]!, q[2]!, q[3]!];
}

function parseEvent(
  sport: FootballSport,
  season: number,
  week: number,
  seasonType: number,
  ev: EspnEvent,
): HistoricalGame | null {
  const comp = ev.competitions?.[0];
  if (!comp || !ev.id || !ev.date) return null;
  const st = comp.status?.type;
  if (!(st?.completed || st?.state === "post" || st?.name === "STATUS_FINAL")) return null;

  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return null;

  const homeFg = Number(home.score);
  const awayFg = Number(away.score);
  if (!Number.isFinite(homeFg) || !Number.isFinite(awayFg)) return null;

  const homeLs = (home.linescores ?? [])
    .map((x) => x.value)
    .filter((v): v is number => typeof v === "number");
  const awayLs = (away.linescores ?? [])
    .map((x) => x.value)
    .filter((v): v is number => typeof v === "number");
  const homeQuarters = asQuarterTuple(homeLs);
  const awayQuarters = asQuarterTuple(awayLs);
  if (!homeQuarters || !awayQuarters) return null;

  const hadOt = homeLs.length > 4 || awayLs.length > 4;
  // Verify regulation quarters sum matches final when no OT.
  if (!hadOt) {
    const hSum = homeQuarters.reduce((a, b) => a + b, 0);
    const aSum = awayQuarters.reduce((a, b) => a + b, 0);
    if (hSum !== homeFg || aSum !== awayFg) return null;
  }

  return {
    eventId: String(ev.id),
    sport,
    season,
    week,
    seasonType,
    kickoffIso: ev.date,
    homeTeamId: String(home.team.id),
    awayTeamId: String(away.team.id),
    homeName: home.team.displayName ?? home.team.abbreviation ?? home.team.id,
    awayName: away.team.displayName ?? away.team.abbreviation ?? away.team.id,
    homeFg,
    awayFg,
    homeQuarters,
    awayQuarters,
    hadOt,
    source: "espn_scoreboard",
  };
}

async function fetchWeek(
  sport: FootballSport,
  season: number,
  week: number,
  seasonType: number,
): Promise<EspnEvent[]> {
  const path = ESPN_PATH[sport];
  const params = new URLSearchParams({
    dates: String(season),
    seasontype: String(seasonType),
    week: String(week),
    limit: "300",
  });
  if (sport === "ncaaf") params.set("groups", "80"); // FBS
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?${params}`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`espn_scoreboard_${r.status}:${sport}:${season}:w${week}:st${seasonType}`);
  }
  const j = (await r.json()) as { events?: EspnEvent[] };
  return j.events ?? [];
}

export type FetchPlan = {
  sport: FootballSport;
  seasons: Array<{ season: number; seasonType: number; weeks: number[] }>;
};

export const DEFAULT_FETCH_PLANS: FetchPlan[] = [
  {
    sport: "nfl",
    seasons: [
      { season: 2022, seasonType: 2, weeks: Array.from({ length: 18 }, (_, i) => i + 1) },
      { season: 2023, seasonType: 2, weeks: Array.from({ length: 18 }, (_, i) => i + 1) },
      { season: 2024, seasonType: 2, weeks: Array.from({ length: 18 }, (_, i) => i + 1) },
      { season: 2022, seasonType: 3, weeks: [1, 2, 3, 4, 5] },
      { season: 2023, seasonType: 3, weeks: [1, 2, 3, 4, 5] },
      { season: 2024, seasonType: 3, weeks: [1, 2, 3, 4, 5] },
    ],
  },
  {
    sport: "ncaaf",
    seasons: [
      { season: 2023, seasonType: 2, weeks: Array.from({ length: 15 }, (_, i) => i + 1) },
      { season: 2024, seasonType: 2, weeks: Array.from({ length: 15 }, (_, i) => i + 1) },
    ],
  },
];

function cacheKey(plan: FetchPlan): string {
  const h = createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 12);
  return `${plan.sport}_${h}.json`;
}

export async function loadOrFetchGames(
  plan: FetchPlan,
  opts?: { forceRefresh?: boolean; delayMs?: number },
): Promise<{
  games: HistoricalGame[];
  cachePath: string;
  fromCache: boolean;
  fetchErrors: string[];
}> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, cacheKey(plan));
  if (!opts?.forceRefresh) {
    try {
      const raw = await readFile(cachePath, "utf8");
      const parsed = JSON.parse(raw) as { games: HistoricalGame[] };
      if (Array.isArray(parsed.games) && parsed.games.length > 0) {
        return { games: parsed.games, cachePath, fromCache: true, fetchErrors: [] };
      }
    } catch {
      /* miss */
    }
  }

  const byId = new Map<string, HistoricalGame>();
  const fetchErrors: string[] = [];
  const delayMs = opts?.delayMs ?? 80;

  for (const block of plan.seasons) {
    for (const week of block.weeks) {
      try {
        const events = await fetchWeek(plan.sport, block.season, week, block.seasonType);
        for (const ev of events) {
          const g = parseEvent(plan.sport, block.season, week, block.seasonType, ev);
          if (g) byId.set(g.eventId, g);
        }
      } catch (err) {
        fetchErrors.push(
          `${plan.sport}:${block.season}:st${block.seasonType}:w${week}:${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sleep(delayMs);
    }
  }

  const games = Array.from(byId.values()).sort(
    (a, b) => new Date(a.kickoffIso).getTime() - new Date(b.kickoffIso).getTime(),
  );

  await writeFile(
    cachePath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        sport: plan.sport,
        plan,
        nGames: games.length,
        games,
      },
      null,
      2,
    ),
    "utf8",
  );

  return { games, cachePath, fromCache: false, fetchErrors };
}

export function datasetFingerprint(games: HistoricalGame[]): string {
  return createHash("sha256")
    .update(games.map((g) => g.eventId).join(","))
    .digest("hex")
    .slice(0, 16);
}
