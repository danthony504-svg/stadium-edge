import type { TeamSearchResult } from "./api.ts";
import { fullTeamIdentityMatch } from "./teamPostedProps.ts";
/** Require both full event names and an explicit player team id; never infer from opponent history. */
export function resolveEvidenceSides(sport: string, playerTeamId: string | null | undefined, away: string, home: string, results: TeamSearchResult[]) {
  const find = (name: string) => {
    const hits = results.filter(t => t.sport === sport && fullTeamIdentityMatch(t.name, name));
    const ids = [...new Set(hits.map(t => t.teamId))];
    return ids.length === 1 ? hits.find(t => t.teamId === ids[0])! : null;
  };
  const a = find(away), h = find(home);
  if (!a || !h || a.teamId === h.teamId || !playerTeamId) return null;
  if (playerTeamId === a.teamId) return { opponent: h, isHome: false };
  if (playerTeamId === h.teamId) return { opponent: a, isHome: true };
  return null;
}
