/**
 * Resolve opponent ESPN team id for a football prop player (via teamAbbr).
 * Kept free of api.ts / PickCard so unit tests stay light.
 */

import {
  resolveCoachGameTeamIds,
  type CoachGameTeamIds,
} from "./coachTeamIdResolve.ts";

export type OppTeamIdEspnGame = {
  sport?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
};

export type OppTeamIdMapEntry = CoachGameTeamIds;

/** Local copy — avoids pulling PickCard via gameLineOptimizer. */
function gameLabelsMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9@]+/g, " ")
      .trim();
  return norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

/**
 * Resolve the opponent ESPN team id for a prop player (via pool teamAbbr).
 * Prefer espnGames abbrs; fall back to teamIdMap name tokens.
 */
export function opponentTeamIdForProp(opts: {
  sport?: string | null;
  game: string;
  teamAbbr?: string | null;
  espnGames?: OppTeamIdEspnGame[] | null;
  teamIdMap?: Map<string, OppTeamIdMapEntry> | null;
}): string | null {
  const sport = String(opts.sport ?? "").toLowerCase();
  if (sport !== "nfl" && sport !== "ncaaf") return null;
  const ab = String(opts.teamAbbr ?? "")
    .trim()
    .toUpperCase();
  if (!ab) return null;

  const games = opts.espnGames ?? [];
  let hit: OppTeamIdEspnGame | undefined;

  if (opts.teamIdMap) {
    const ids = resolveCoachGameTeamIds(opts.game, sport, opts.teamIdMap);
    if (ids) {
      hit = games.find(
        (g) =>
          String(g.sport ?? "").toLowerCase() === sport &&
          String(g.homeTeamId ?? "") === ids.homeTeamId &&
          String(g.awayTeamId ?? "") === ids.awayTeamId,
      );
    }
  }

  if (!hit) {
    hit = games.find((g) => {
      if (String(g.sport ?? "").toLowerCase() !== sport) return false;
      const homeAb = String(g.homeAbbr ?? "").toUpperCase();
      const awayAb = String(g.awayAbbr ?? "").toUpperCase();
      if (homeAb === ab || awayAb === ab) {
        const label = `${g.awayTeam ?? g.awayAbbr ?? ""} @ ${g.homeTeam ?? g.homeAbbr ?? ""}`;
        return gameLabelsMatch(opts.game, label) || homeAb === ab || awayAb === ab;
      }
      const label = `${g.awayTeam ?? g.awayAbbr ?? ""} @ ${g.homeTeam ?? g.homeAbbr ?? ""}`;
      return gameLabelsMatch(opts.game, label);
    });
  }

  if (hit) {
    const homeAb = String(hit.homeAbbr ?? "").toUpperCase();
    const awayAb = String(hit.awayAbbr ?? "").toUpperCase();
    if (homeAb === ab && hit.awayTeamId) return String(hit.awayTeamId);
    if (awayAb === ab && hit.homeTeamId) return String(hit.homeTeamId);
  }

  // Fallback: team names on the id map contain the player's abbr token.
  if (opts.teamIdMap) {
    const ids = resolveCoachGameTeamIds(opts.game, sport, opts.teamIdMap);
    if (!ids) return null;
    const home = String(ids.homeTeam ?? "").toUpperCase();
    const away = String(ids.awayTeam ?? "").toUpperCase();
    const tokenHit = (name: string) =>
      name === ab ||
      name.split(/[\s.@/\-]+/).some((t) => t === ab) ||
      (ab.length >= 2 && name.startsWith(ab));
    if (tokenHit(home)) return ids.awayTeamId;
    if (tokenHit(away)) return ids.homeTeamId;
  }
  return null;
}
