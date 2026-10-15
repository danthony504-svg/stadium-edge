/**
 * Freeze completed NFL regular-season scoreboards from the same ESPN host
 * the API already calls. Scores only — completed payloads have no closing odds.
 *
 *   node --import ./test/register-hooks.mjs ./scripts/fetchNflHistoricalGames.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "../test/fixtures/nfl-historical-games.json");
const seasons = [2022, 2023, 2024];
const weeks = Array.from({ length: 18 }, (_, i) => i + 1);

type Game = {
  eventId: string;
  season: number;
  week: number;
  kickoffIso: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  homeFg: number;
  awayFg: number;
  source: "espn_scoreboard";
};

async function fetchWeek(season: number, week: number): Promise<Game[]> {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?seasontype=2&week=${week}&dates=${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = (await res.json()) as {
    events?: Array<{
      id?: string;
      date?: string;
      competitions?: Array<{
        status?: { type?: { completed?: boolean; name?: string } };
        competitors?: Array<{
          homeAway?: string;
          score?: string;
          team?: { id?: string; displayName?: string };
        }>;
      }>;
    }>;
  };
  const games: Game[] = [];
  for (const event of body.events ?? []) {
    const comp = event.competitions?.[0];
    const status = comp?.status?.type;
    if (!status?.completed && status?.name !== "STATUS_FINAL") continue;
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    const homeFg = Number(home?.score);
    const awayFg = Number(away?.score);
    if (!event.id || !home?.team?.id || !away?.team?.id) continue;
    if (!Number.isFinite(homeFg) || !Number.isFinite(awayFg)) continue;
    games.push({
      eventId: String(event.id),
      season,
      week,
      kickoffIso: String(event.date ?? ""),
      homeTeamId: String(home.team.id),
      awayTeamId: String(away.team.id),
      homeName: String(home.team.displayName ?? ""),
      awayName: String(away.team.displayName ?? ""),
      homeFg,
      awayFg,
      source: "espn_scoreboard",
    });
  }
  return games;
}

async function main(): Promise<void> {
  const byId = new Map<string, Game>();
  for (const season of seasons) {
    for (const week of weeks) {
      const games = await fetchWeek(season, week);
      for (const g of games) byId.set(g.eventId, g);
      console.log(`${season} week ${week}: ${games.length}`);
    }
  }
  const games = [...byId.values()].sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    if (a.week !== b.week) return a.week - b.week;
    return a.kickoffIso.localeCompare(b.kickoffIso);
  });
  const payload = {
    source: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    seasontype: 2,
    seasons,
    generatedAt: new Date().toISOString(),
    note: "Completed regular-season finals. ESPN scoreboard and summary odds/pickcenter were empty, so this file has no closing lines.",
    games,
  };
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${games.length} games to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
