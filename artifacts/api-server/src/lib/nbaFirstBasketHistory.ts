import { resolveNbaOpeningScore, type NbaOpeningSummary } from "./nbaOpeningScore";

type Athlete = { id?: string; displayName?: string };
export type FirstBasketSummary = NbaOpeningSummary & {
  boxscore?: {
    players?: Array<{
      team?: { id?: string };
      statistics?: Array<{ athletes?: Array<{ starter?: boolean; athlete?: Athlete }> }>;
    }>;
  };
};

export function nbaFirstBasketRecentStarter(
  teams: Array<{ teamId: string; games: Array<{ eventId: string; summary: FirstBasketSummary }> }>,
) {
  const candidates = [];
  for (const { teamId, games } of teams) {
    const starts = new Map<string, { player: string; hits: number; starts: number }>();
    let latestStarters: Set<string> | undefined;
    for (const { eventId, summary } of games) {
      const opening = resolveNbaOpeningScore(summary, eventId);
      if (!opening) continue;
      const starters = new Map<string, string>();
      const box = summary.boxscore?.players?.find((item) => item.team?.id === teamId);
      for (const group of box?.statistics ?? []) {
        for (const row of group.athletes ?? []) {
          if (row.starter === true && row.athlete?.id && row.athlete.displayName) {
            starters.set(row.athlete.id, row.athlete.displayName);
          }
        }
      }
      if (starters.size !== 5) continue;
      latestStarters ??= new Set(starters.keys());
      for (const [id, player] of starters) {
        const entry = starts.get(id) ?? { player, hits: 0, starts: 0 };
        entry.starts++;
        if (opening.firstMadeFieldGoal.teamId === teamId && opening.firstMadeFieldGoal.playerId === id) entry.hits++;
        starts.set(id, entry);
      }
    }
    if (!latestStarters || ![...starts.values()].some((entry) => entry.starts >= 4)) return null;
    for (const id of latestStarters) {
      const entry = starts.get(id)!;
      if (entry.starts >= 4 && entry.hits > 0) candidates.push(entry);
    }
  }
  candidates.sort((a, b) => b.hits * a.starts - a.hits * b.starts);
  const [first, second] = candidates;
  if (!first || (second && first.hits * second.starts === second.hits * first.starts)) return null;
  return first;
}
