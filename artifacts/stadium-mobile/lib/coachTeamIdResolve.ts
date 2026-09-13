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

/** Fold accents + punctuation so "Atlético" ↔ "Atletico", "Saint-Germain" ↔ "Saint Germain". */
function norm(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop club suffixes that Odds/ESPN disagree on (CF, FC, AFC, …). */
function stripClubNoise(s: string): string {
  return norm(s)
    .replace(/\b(fc|cf|afc|sc|fk|ac|as|rcd|ud|cd|ssc|ogc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const x = stripClubNoise(a);
  const y = stripClubNoise(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = stripClubNoise(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  const tb = y.split(" ").filter((w) => w.length > 2);
  if (tb.some((w) => ta.has(w))) return true;
  // National-team aliases Odds ↔ ESPN (USA/United States, Korea/South Korea).
  const alias = (s: string) => {
    const n = stripClubNoise(s);
    if (n === "usa" || n === "us" || n === "united states of america") return "united states";
    if (n === "korea republic" || n === "south korea" || n === "korea") return "korea";
    if (n === "ivory coast" || n === "cote d ivoire" || n === "cote divoire") return "cote divoire";
    return n;
  };
  return alias(a) === alias(b) && alias(a).length > 2;
}

/** Local copy of gameLabelsMatch — avoids pulling PickCard via gameLineOptimizer. */
function gameLabelsMatch(a: string, b: string): boolean {
  const pa = String(a ?? "").split(" @ ");
  const pb = String(b ?? "").split(" @ ");
  if (pa.length !== 2 || pb.length !== 2) return norm(a) === norm(b);
  return teamsMatch(pa[0]!, pb[0]!) && teamsMatch(pa[1]!, pb[1]!);
}

export function coachTeamNickname(team: string): string {
  const parts = stripClubNoise(team).split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? team).toLowerCase();
}

function sameSportFamily(ask: string | undefined, mapped: string): boolean {
  if (!ask || !mapped) return true;
  if (ask === mapped) return true;
  // Odds/ESPN both tag merged soccer leagues as "soccer".
  if (ask.startsWith("soccer") && mapped.startsWith("soccer")) return true;
  return false;
}

function flipSides(ids: CoachGameTeamIds): CoachGameTeamIds {
  return {
    sport: ids.sport,
    homeTeamId: ids.awayTeamId,
    awayTeamId: ids.homeTeamId,
    homeTeam: ids.awayTeam,
    awayTeam: ids.homeTeam,
  };
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
 * "Ohio State Buckeyes"). Soccer also tries a home/away flip — Odds and ESPN
 * sometimes disagree on venue side, which previously left TEAM_IDS_UNRESOLVED.
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
    // Odds/ESPN venue flip: try Home @ Away nickname key, then flip ids back.
    const flippedNick = `${coachTeamNickname(parts[1]!)}|${coachTeamNickname(parts[0]!)}`;
    const flippedHit = map.get(flippedNick);
    if (flippedHit) return flipSides(flippedHit);
  }
  const seen = new Set<string>();
  for (const ids of map.values()) {
    const key = `${ids.awayTeamId}|${ids.homeTeamId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sameSportFamily(sport, ids.sport)) continue;
    const espnLabel = `${ids.awayTeam} @ ${ids.homeTeam}`;
    if (gameLabelsMatch(gameLabel, espnLabel)) return ids;
    const espnFlipped = `${ids.homeTeam} @ ${ids.awayTeam}`;
    if (gameLabelsMatch(gameLabel, espnFlipped)) return flipSides(ids);
  }
  return null;
}
