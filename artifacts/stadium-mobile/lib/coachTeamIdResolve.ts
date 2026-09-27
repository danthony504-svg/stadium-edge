/**
 * Pure ESPN team-id resolution for Coach game sims + prop sims.
 * Kept free of api.ts / PickCard so node:test can cover Odds↔ESPN label
 * mismatches (the silent empty-ticket failure after #470/#471).
 *
 * Rebuild notes:
 * - Index full names, nicknames, abbreviations, and venue flips up front.
 * - Pre-bind odds-board labels into the map so slate sims hit direct keys.
 * - NFL city/mascot aliases cover Odds↔ESPN naming drift.
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

/** NFL / common Odds↔ESPN city and mascot aliases. */
function teamAlias(s: string): string {
  const n = stripClubNoise(s);
  if (!n) return n;
  // National teams
  if (n === "usa" || n === "us" || n === "united states of america") return "united states";
  if (n === "korea republic" || n === "south korea" || n === "korea") return "korea";
  if (n === "ivory coast" || n === "cote d ivoire" || n === "cote divoire") return "cote divoire";
  // NFL city / brand drift
  if (n === "la" || n === "los angeles") return "los angeles";
  if (n === "ny" || n === "new york") return "new york";
  if (n === "tb" || n === "tampa" || n === "tampa bay") return "tampa bay";
  if (n === "ne" || n === "new england") return "new england";
  if (n === "gb" || n === "green bay") return "green bay";
  if (n === "kc" || n === "kansas city") return "kansas city";
  if (n === "sf" || n === "san francisco") return "san francisco";
  if (n === "lv" || n === "las vegas") return "las vegas";
  if (n === "jax" || n === "jacksonville") return "jacksonville";
  if (n === "wsh" || n === "was" || n === "washington") return "washington";
  return n;
}

function teamsMatch(a: string, b: string): boolean {
  const x = teamAlias(a);
  const y = teamAlias(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = teamAlias(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  const tb = y.split(" ").filter((w) => w.length > 2);
  if (tb.some((w) => ta.has(w))) return true;
  return false;
}

/** Local copy of gameLabelsMatch — avoids pulling PickCard via gameLineOptimizer. */
function gameLabelsMatch(a: string, b: string): boolean {
  const pa = String(a ?? "").split(" @ ");
  const pb = String(b ?? "").split(" @ ");
  if (pa.length !== 2 || pb.length !== 2) return norm(a) === norm(b);
  return teamsMatch(pa[0]!, pb[0]!) && teamsMatch(pa[1]!, pb[1]!);
}

export function coachTeamNickname(team: string): string {
  const parts = teamAlias(team).split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? team).toLowerCase();
}

function sameSportFamily(ask: string | undefined, mapped: string): boolean {
  if (!ask || !mapped) return true;
  if (ask === mapped) return true;
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

function indexTeamIds(
  map: Map<string, CoachGameTeamIds>,
  ids: CoachGameTeamIds,
  away: string,
  home: string,
): void {
  const label = `${away} @ ${home}`.toLowerCase();
  map.set(label, ids);
  map.set(`${coachTeamNickname(away)}|${coachTeamNickname(home)}`, ids);
  // Abbr-only / short keys when provided as the display name itself.
  const awayN = teamAlias(away);
  const homeN = teamAlias(home);
  if (awayN && homeN) {
    map.set(`${awayN} @ ${homeN}`, ids);
  }
}

/**
 * Map ESPN games to lookup keys:
 * lowercase Away @ Home, nickname|nickname, abbr pairs, and flipped venue keys.
 */
export function buildCoachGameTeamIdMap(
  games: Array<{
    sport?: string;
    homeTeam?: string;
    awayTeam?: string;
    homeAbbr?: string | null;
    awayAbbr?: string | null;
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
    indexTeamIds(map, ids, away, home);
    // Abbr cross-keys (ARI @ SF) even when full names are the primary label.
    if (g.awayAbbr && g.homeAbbr) {
      indexTeamIds(map, ids, g.awayAbbr, g.homeAbbr);
      // Mixed: full away @ abbr home, etc.
      indexTeamIds(map, ids, away, g.homeAbbr);
      indexTeamIds(map, ids, g.awayAbbr, home);
    }
    // Venue-flipped keys so Odds Home @ Away still direct-hits.
    const flipped = flipSides(ids);
    indexTeamIds(map, flipped, home, away);
    if (g.awayAbbr && g.homeAbbr) {
      indexTeamIds(map, flipped, g.homeAbbr, g.awayAbbr);
    }
  }
  return map;
}

/**
 * Resolve ESPN team ids for an odds-board game label.
 * Exact + nickname first, then fuzzy gameLabelsMatch (NCAAF "Ohio State" ↔
 * "Ohio State Buckeyes"). Also tries home/away flip.
 */
export function resolveCoachGameTeamIds(
  gameLabel: string,
  sport: string | undefined,
  map: Map<string, CoachGameTeamIds>,
): CoachGameTeamIds | null {
  if (!map.size) return null;
  const direct = map.get(gameLabel.toLowerCase());
  if (direct) {
    if (!sport || sameSportFamily(sport, direct.sport)) return direct;
  }
  const parts = gameLabel.split(" @ ");
  if (parts.length === 2) {
    const nick = `${coachTeamNickname(parts[0]!)}|${coachTeamNickname(parts[1]!)}`;
    const hit = map.get(nick);
    if (hit && (!sport || sameSportFamily(sport, hit.sport))) return hit;
    // Odds/ESPN venue flip: try Home @ Away nickname key, then flip ids back.
    const flippedNick = `${coachTeamNickname(parts[1]!)}|${coachTeamNickname(parts[0]!)}`;
    const flippedHit = map.get(flippedNick);
    if (flippedHit && (!sport || sameSportFamily(sport, flippedHit.sport))) {
      return flipSides(flippedHit);
    }
    // Alias-normalized full label.
    const aliasLabel = `${teamAlias(parts[0]!)} @ ${teamAlias(parts[1]!)}`;
    const aliasHit = map.get(aliasLabel);
    if (aliasHit && (!sport || sameSportFamily(sport, aliasHit.sport))) return aliasHit;
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

/**
 * Pre-bind every odds-board label into the team-id map so slate sims do not
 * depend on fuzzy resolve under time pressure. Returns how many labels bound.
 */
export function bindOddsLabelsToTeamIdMap(
  map: Map<string, CoachGameTeamIds>,
  oddsGames: Array<{
    awayTeam?: string | null;
    homeTeam?: string | null;
    sport?: string | null;
  }>,
): { bound: number; unresolved: string[] } {
  let bound = 0;
  const unresolved: string[] = [];
  for (const g of oddsGames) {
    const away = String(g.awayTeam ?? "").trim();
    const home = String(g.homeTeam ?? "").trim();
    if (!away || !home) continue;
    const label = `${away} @ ${home}`;
    const key = label.toLowerCase();
    if (map.has(key)) {
      bound += 1;
      continue;
    }
    const ids = resolveCoachGameTeamIds(label, g.sport ?? undefined, map);
    if (!ids) {
      unresolved.push(label);
      continue;
    }
    indexTeamIds(map, ids, away, home);
    bound += 1;
  }
  return { bound, unresolved };
}
