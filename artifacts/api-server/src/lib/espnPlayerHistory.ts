import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";
import type { PlayerHistoryShape } from "./monteCarloBuild.js";

type GameLog = {
  events?: Record<
    string,
    { opponent?: { id?: string; displayName?: string }; gameDate?: string; atVs?: string }
  >;
  seasonTypes?: Array<{
    categories?: Array<{
      events?: Array<{ eventId?: string; stats?: string[] }>;
    }>;
  }>;
  names?: string[];
  labels?: string[];
};

type FlatGame = {
  eventId: string;
  date: string | null;
  opponentId: string | null;
  opponentName: string | null;
  isHome: boolean | null;
  stats: Record<string, string>;
};

function flattenGameLog(log: GameLog): FlatGame[] {
  const labels = (log.labels ?? log.names ?? []) as string[];
  const eventMeta = log.events ?? {};
  const flat: FlatGame[] = [];
  for (const st of log.seasonTypes ?? []) {
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (!ev.eventId) continue;
        const meta = eventMeta[ev.eventId];
        const stats: Record<string, string> = {};
        (ev.stats ?? []).forEach((v, i) => {
          if (labels[i]) stats[labels[i]] = v;
        });
        const atVs = meta?.atVs;
        const isHome = atVs === "vs" ? true : atVs === "@" ? false : null;
        flat.push({
          eventId: ev.eventId,
          date: meta?.gameDate ?? null,
          opponentId: meta?.opponent?.id ?? null,
          opponentName: meta?.opponent?.displayName ?? null,
          isHome,
          stats,
        });
      }
    }
  }
  flat.sort((a, b) => {
    const ad = a.date ? new Date(a.date).getTime() : 0;
    const bd = b.date ? new Date(b.date).getTime() : 0;
    return bd - ad;
  });
  return flat;
}

/** Fetch ESPN game log directly — avoids brittle self-HTTP to /api/player-history. */
export async function fetchEspnPlayerHistory(
  sport: string,
  athleteId: string,
  opponentTeamId?: string,
): Promise<PlayerHistoryShape | null> {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path || !athleteId) return null;
  try {
    const key = `player-history:${path}:${athleteId}:current`;
    const log = await cachedJson<GameLog>(key, 30 * 60 * 1000, async () => {
      const url = `https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${athleteId}/gamelog`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN gamelog ${r.status}`);
      return (await r.json()) as GameLog;
    });
    const flat = flattenGameLog(log);
    if (!flat.length) return null;
    const labels = (log.labels ?? log.names ?? []) as string[];
    const recent = flat.slice(0, 10);
    const vsOpponent = opponentTeamId
      ? flat.filter((g) => g.opponentId === opponentTeamId).slice(0, 10)
      : [];
    const homeGames = recent.filter((g) => g.isHome === true);
    const awayGames = recent.filter((g) => g.isHome === false);
    const sumStats = (games: FlatGame[]) => {
      const sums: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const g of games) {
        for (const [lab, raw] of Object.entries(g.stats)) {
          const n = Number(raw);
          if (!Number.isFinite(n)) continue;
          sums[lab] = (sums[lab] ?? 0) + n;
          counts[lab] = (counts[lab] ?? 0) + 1;
        }
      }
      const averages: Record<string, number> = {};
      for (const lab of Object.keys(sums)) {
        averages[lab] = Math.round((sums[lab]! / counts[lab]!) * 100) / 100;
      }
      return { games: games.length, averages };
    };
    return {
      labels,
      recent: recent.map((g) => ({
        stats: g.stats,
        isHome: g.isHome,
        opponentId: g.opponentId,
      })),
      vsOpponent: vsOpponent.map((g) => ({ stats: g.stats })),
      homeSplit: sumStats(homeGames),
      awaySplit: sumStats(awayGames),
    };
  } catch {
    return null;
  }
}
