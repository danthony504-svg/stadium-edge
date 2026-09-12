/**
 * Pure ESPN team-id resolution for Coach game sims.
 * Kept free of api.ts / PickCard so node:test can cover Odds↔ESPN label
 * mismatches (the silent empty-ticket failure after #470/#471).
 */

export type CoachGameTeamIds = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
};

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

/** Local copy of gameLabelsMatch — avoids pulling PickCard via gameLineOptimizer. */
function gameLabelsMatch(a: string, b: string): boolean {
  const pa = String(a ?? "").split(" @ ");
  const pb = String(b ?? "").split(" @ ");
  if (pa.length !== 2 || pb.length !== 2) return norm(a) === norm(b);
  return teamsMatch(pa[0]!, pb[0]!) && teamsMatch(pa[1]!, pb[1]!);
}

export function coachTeamNickname(team: string): string {
  const parts = String(team ?? "").trim().split(/\s+/);
  return (parts[parts.length - 1] ?? team).toLowerCase();
}

/** Map ESPN games to lookup keys (lowercase Away @ Home + nickname|nickname). */
export function buildCoachGameTeamIdMap(
  games: Array<{
    sport?: string;
    homeTeam?: string;
    awayTeam?: string;
    homeAbbr?: string;
    awayAbbr?: string;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  }>,
): Map<string, CoachGameTeamIds> {
  const map = new Map<string, CoachGameTeamIds>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away || !g.homeTeamId || !g.awayTeamId) continue;
    const ids: CoachGameTeamIds = {
      sport: g.sport || "",
      homeTeamId: String(g.homeTeamId),
      awayTeamId: String(g.awayTeamId),
      homeTeam: home,
      awayTeam: away,
    };
    map.set(`${away} @ ${home}`.toLowerCase(), ids);
    map.set(`${coachTeamNickname(away)}|${coachTeamNickname(home)}`, ids);
  }
  return map;
}

/**
 * Resolve ESPN team ids for an odds-board game label.
 * Exact + nickname first, then fuzzy gameLabelsMatch (NCAAF "Ohio State" ↔
 * "Ohio State Buckeyes"). Without fuzzy match, every game sim was skipped and
 * Coach painted a fake quality-bar empty.
 */
export function resolveCoachGameTeamIds(
  gameLabel: string,
  sport: string | undefined,
  map: Map<string, CoachGameTeamIds>,
): CoachGameTeamIds | null {
  if (!map.size) return null;
  const direct = map.get(gameLabel.toLowerCase());
  if (direct) return direct;
  const parts = gameLabel.split(" @ ");
  if (parts.length === 2) {
    const nick = `${coachTeamNickname(parts[0]!)}|${coachTeamNickname(parts[1]!)}`;
    const hit = map.get(nick);
    if (hit) return hit;
  }
  const seen = new Set<string>();
  for (const ids of map.values()) {
    const key = `${ids.awayTeamId}|${ids.homeTeamId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (sport && ids.sport && sport !== ids.sport) continue;
    const espnLabel = `${ids.awayTeam} @ ${ids.homeTeam}`;
    if (gameLabelsMatch(gameLabel, espnLabel)) return ids;
  }
  return null;
}
