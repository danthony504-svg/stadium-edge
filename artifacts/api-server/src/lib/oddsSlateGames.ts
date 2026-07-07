/** Sports with no ESPN scoreboard — build game rows from the live odds feed. */
export const ODDS_SLATE_SPORT_IDS = new Set(["tabletennis", "cricket"]);

type OddsSlateRow = {
  id: string;
  sport?: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

export type SlateGameRow = {
  id: string;
  sport: string;
  name: string;
  shortName: string;
  status: string;
  startsAt: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: null;
  awayScore: null;
  homeTeamId: null;
  awayTeamId: null;
  homeLogo: null;
  awayLogo: null;
  homeAbbr: null;
  awayAbbr: null;
  venue: null;
  clock: null;
  period: null;
  periodLabel: null;
  state: "pre" | "in" | "post" | null;
};

function toSlateRow(sportId: string, o: OddsSlateRow): SlateGameRow {
  return {
    id: o.id,
    sport: sportId,
    name: `${o.awayTeam} vs ${o.homeTeam}`,
    shortName: `${o.awayTeam} vs ${o.homeTeam}`,
    status: "Scheduled",
    startsAt: o.commenceTime,
    homeTeam: o.homeTeam,
    awayTeam: o.awayTeam,
    homeScore: null,
    awayScore: null,
    homeTeamId: null,
    awayTeamId: null,
    homeLogo: null,
    awayLogo: null,
    homeAbbr: null,
    awayAbbr: null,
    venue: null,
    clock: null,
    period: null,
    periodLabel: null,
    state: "pre",
  };
}

/** Load pregame slate rows from /api/sports/odds (includes Bovada fallback for table tennis). */
export async function loadOddsSlateGames(sportId: string): Promise<SlateGameRow[]> {
  const selfPort = process.env["PORT"] || "8080";
  const r = await fetch(
    `http://127.0.0.1:${selfPort}/api/sports/odds?sport=${encodeURIComponent(sportId)}`,
    { headers: { "x-internal-call": "1" } },
  );
  if (!r.ok) return [];
  const raw = (await r.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: SlateGameRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id || "");
    const homeTeam = String(o.homeTeam || "");
    const awayTeam = String(o.awayTeam || "");
    const commenceTime = String(o.commenceTime || "");
    if (!id || !homeTeam || !awayTeam || !commenceTime) continue;
    out.push(
      toSlateRow(sportId, { id, homeTeam, awayTeam, commenceTime, sport: sportId }),
    );
  }
  return out;
}
