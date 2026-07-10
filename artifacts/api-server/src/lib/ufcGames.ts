import { cachedJson, ESPN_SPORT_PATHS } from "./sports.js";
import { loadOddsSlateGames, type SlateGameRow } from "./oddsSlateGames.js";
import {
  espnCompetitorAbbr,
  espnCompetitorId,
  espnCompetitorLogo,
  espnCompetitorName,
  resolveEspnCompetitorSides,
  type EspnTeamCompetitor,
} from "./espnCompetitors.js";

type EspnEvent = {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status?: {
    displayClock?: string;
    period?: number;
    type?: { description?: string; state?: string; shortDetail?: string };
  };
  competitions?: Array<{
    id?: string;
    date?: string;
    venue?: { fullName?: string };
    status?: {
      displayClock?: string;
      period?: number;
      type?: { description?: string; state?: string; shortDetail?: string };
    };
    competitors?: EspnTeamCompetitor[];
  }>;
};

function normFightKey(away: string, home: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(away)}|${norm(home)}`;
}

function mapEspnEventToUfcFights(e: EspnEvent): SlateGameRow[] {
  const out: SlateGameRow[] = [];
  for (const comp of e.competitions ?? []) {
    const { home, away } = resolveEspnCompetitorSides(comp?.competitors, true);
    const awayName = espnCompetitorName(away);
    const homeName = espnCompetitorName(home);
    if (!awayName || !homeName) continue;
    const statusObj = comp?.status ?? e.status;
    const fightLabel = `${awayName} vs. ${homeName}`;
    out.push({
      id: String(comp?.id ?? e.id),
      sport: "ufc",
      name: fightLabel,
      shortName: fightLabel,
      status:
        e.status?.type?.description ??
        (statusObj?.type?.state === "in"
          ? "In Progress"
          : statusObj?.type?.state === "post"
            ? "Final"
            : statusObj?.type?.state === "pre"
              ? "Scheduled"
              : "Unknown"),
      startsAt: comp?.date ?? e.date,
      homeTeam: homeName,
      awayTeam: awayName,
      homeScore: null,
      awayScore: null,
      homeTeamId: espnCompetitorId(home),
      awayTeamId: espnCompetitorId(away),
      homeLogo: espnCompetitorLogo(home),
      awayLogo: espnCompetitorLogo(away),
      homeAbbr: espnCompetitorAbbr(home),
      awayAbbr: espnCompetitorAbbr(away),
      venue: comp?.venue?.fullName ?? null,
      clock: statusObj?.displayClock ?? null,
      period: statusObj?.period ?? null,
      periodLabel: statusObj?.type?.shortDetail ?? statusObj?.type?.description ?? null,
      state: statusObj?.type?.state ?? e.status?.type?.state ?? null,
    });
  }
  return out;
}

async function fetchEspnUfcFights(): Promise<SlateGameRow[]> {
  const path = ESPN_SPORT_PATHS.ufc;
  if (!path) return [];
  const data = await cachedJson(
    "games:ufc:scoreboard",
    60 * 1000,
    async () => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN ${r.status}`);
      return (await r.json()) as { events?: EspnEvent[] };
    },
  );
  return (data.events ?? []).flatMap(mapEspnEventToUfcFights);
}

/** Merge venue/IDs from ESPN when odds matched the same bout. */
export function mergeEspnIntoUfcOddsRows(
  oddsGames: SlateGameRow[],
  espnGames: SlateGameRow[],
): SlateGameRow[] {
  const byKey = new Map<string, SlateGameRow>();
  for (const g of espnGames) {
    if (!g.awayTeam || !g.homeTeam) continue;
    byKey.set(normFightKey(g.awayTeam, g.homeTeam), g);
  }
  return oddsGames.map((o) => {
    if (!o.awayTeam || !o.homeTeam) return o;
    const espn = byKey.get(normFightKey(o.awayTeam, o.homeTeam));
    if (!espn) return o;
    return {
      ...o,
      venue: o.venue ?? espn.venue,
      homeTeamId: o.homeTeamId ?? espn.homeTeamId,
      awayTeamId: o.awayTeamId ?? espn.awayTeamId,
      homeAbbr: o.homeAbbr ?? espn.homeAbbr,
      awayAbbr: o.awayAbbr ?? espn.awayAbbr,
      homeLogo: o.homeLogo ?? espn.homeLogo,
      awayLogo: o.awayLogo ?? espn.awayLogo,
    };
  });
}

/** Named UFC fights — odds feed primary, ESPN enriches venue/IDs. */
export async function loadUfcSlateGames(): Promise<SlateGameRow[]> {
  const [odds, espn] = await Promise.all([
    loadOddsSlateGames("ufc").catch(() => [] as SlateGameRow[]),
    fetchEspnUfcFights().catch(() => [] as SlateGameRow[]),
  ]);

  const fromOdds = odds.filter((g) => g.homeTeam?.trim() && g.awayTeam?.trim());
  if (fromOdds.length) return mergeEspnIntoUfcOddsRows(fromOdds, espn);

  return espn.filter((g) => g.homeTeam?.trim() && g.awayTeam?.trim());
}
