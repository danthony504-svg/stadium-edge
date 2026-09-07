import type { ParsedPick } from "@/components/PickCard";
import {
  capturePerformanceRecommendations,
  getGames,
  type EspnGame,
  type PerformanceRecommendation,
  type PerformanceSource,
} from "@/lib/api";

const teamNick = (value: string) => value.trim().split(/\s+/).pop()?.toLowerCase() ?? "";

function matchEvent(pick: ParsedPick, games: EspnGame[]): EspnGame | null {
  const teams = pick.game.split(/\s+@\s+/);
  if (teams.length !== 2) return null;
  const [away, home] = teams.map(teamNick);
  const matches = games.filter((game) =>
    teamNick(game.awayTeam ?? "") === away && teamNick(game.homeTeam ?? "") === home,
  );
  if (matches.length !== 1) return null;
  return matches[0]!;
}

function lineFromPick(pick: ParsedPick): string | null {
  if (pick.propLine != null) return String(pick.propLine);
  return pick.pick.match(/[+-]?\d+(?:\.\d+)?/)?.[0] ?? null;
}

/**
 * Capture only recommendations actually delivered in a Coach response. We resolve
 * the canonical provider event ID first; an ambiguous fixture is skipped rather
 * than stored under a guessed identity.
 */
export async function captureDeliveredCoachRecommendations(
  picks: ParsedPick[],
  source: PerformanceSource,
): Promise<void> {
  const sports = [...new Set(picks.map((pick) => pick.sport).filter((sport): sport is string => !!sport))];
  const feeds = await Promise.all(sports.map(async (sport) => [sport, await getGames(sport)] as const));
  const gamesBySport = new Map(feeds);
  const recommendations: PerformanceRecommendation[] = [];
  for (const pick of picks) {
    if (!pick.sport || !Number.isFinite(pick.odds)) continue;
    const event = matchEvent(pick, gamesBySport.get(pick.sport) ?? []);
    if (!event) continue;
    recommendations.push({
      source,
      sport: pick.sport,
      providerEventId: event.id,
      game: pick.game,
      market: pick.market,
      selection: pick.pick,
      line: lineFromPick(pick),
      odds: pick.odds,
      startsAt: pick.startsAt ?? event.startsAt ?? null,
    });
  }
  await capturePerformanceRecommendations(recommendations);
}
