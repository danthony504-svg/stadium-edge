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
 * Match pool teamAbbr to a full team name when ESPN abbrs are missing.
 * Covers city prefix (BUF→Buffalo) and initials (CBJ→Columbus Blue Jackets).
 */
function teamNameMatchesAbbr(name: string, abbr: string): boolean {
  const n = String(name ?? "")
    .trim()
    .toUpperCase();
  const a = String(abbr ?? "")
    .trim()
    .toUpperCase();
  if (!n || !a) return false;
  if (n === a) return true;
  const tokens = n.split(/[\s.@/\-]+/).filter(Boolean);
  if (tokens.some((t) => t === a)) return true;
  if (a.length >= 2 && n.startsWith(a)) return true;
  // CBJ ← Columbus Blue Jackets, TBL ← Tampa Bay Lightning, etc.
  if (tokens.map((t) => t[0]!).join("") === a) return true;
  return false;
}

/**
 * True when the player's teamAbbr is one of the two sides on the labeled game.
 * Drops cross-event orphans that somehow inherit "Away @ Home" (Garland on
 * BUF@CBJ while actually VAN).
 *
 * Fail closed only when both side abbrs (or resolvable names) are known and
 * neither matches — missing ESPN abbrs must not wipe a whole NHL ticket
 * (phone: bestEv=5 oddsOk=0 after CBJ-style abbrs failed startsWith).
 */
export function propTeamAbbrBelongsToGame(opts: {
  sport?: string | null;
  game: string;
  teamAbbr?: string | null;
  espnGames?: OppTeamIdEspnGame[] | null;
  teamIdMap?: Map<string, OppTeamIdMapEntry> | null;
}): boolean {
  const ab = String(opts.teamAbbr ?? "")
    .trim()
    .toUpperCase();
  if (!ab) return false;
  const sport = String(opts.sport ?? "").toLowerCase();
  const games = opts.espnGames ?? [];

  if (opts.teamIdMap && sport) {
    const ids = resolveCoachGameTeamIds(opts.game, sport, opts.teamIdMap);
    if (ids) {
      const hit = games.find(
        (g) =>
          String(g.sport ?? "").toLowerCase() === sport &&
          String(g.homeTeamId ?? "") === ids.homeTeamId &&
          String(g.awayTeamId ?? "") === ids.awayTeamId,
      );
      if (hit) {
        const homeAb = String(hit.homeAbbr ?? "").toUpperCase();
        const awayAb = String(hit.awayAbbr ?? "").toUpperCase();
        if (homeAb === ab || awayAb === ab) return true;
        if (homeAb && awayAb && homeAb !== ab && awayAb !== ab) {
          // Both abbrs known and neither matches — orphan.
          return false;
        }
      }
      const home = String(ids.homeTeam ?? "");
      const away = String(ids.awayTeam ?? "");
      if (teamNameMatchesAbbr(home, ab) || teamNameMatchesAbbr(away, ab)) return true;
      // Game resolved but abbr/name inconclusive — don't wipe the ticket.
      return !(hit && String(hit.homeAbbr ?? "") && String(hit.awayAbbr ?? ""));
    }
  }

  for (const g of games) {
    if (sport && String(g.sport ?? "").toLowerCase() !== sport) continue;
    const homeAb = String(g.homeAbbr ?? "").toUpperCase();
    const awayAb = String(g.awayAbbr ?? "").toUpperCase();
    const label = `${g.awayTeam ?? g.awayAbbr ?? ""} @ ${g.homeTeam ?? g.homeAbbr ?? ""}`;
    if (!gameLabelsMatch(opts.game, label) && homeAb !== ab && awayAb !== ab) {
      if (
        !teamNameMatchesAbbr(String(g.homeTeam ?? ""), ab) &&
        !teamNameMatchesAbbr(String(g.awayTeam ?? ""), ab)
      ) {
        continue;
      }
    }
    if (homeAb === ab || awayAb === ab) return true;
    if (
      teamNameMatchesAbbr(String(g.homeTeam ?? ""), ab) ||
      teamNameMatchesAbbr(String(g.awayTeam ?? ""), ab)
    ) {
      return true;
    }
    // Known abbrs on this game and neither matches → orphan for this row.
    if (homeAb && awayAb) return false;
  }
  return false;
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
  if (!sport) return null;
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
    // Abbrs missing — match full names (CBJ ↔ Columbus Blue Jackets).
    if (
      teamNameMatchesAbbr(String(hit.homeTeam ?? ""), ab) &&
      hit.awayTeamId
    ) {
      return String(hit.awayTeamId);
    }
    if (
      teamNameMatchesAbbr(String(hit.awayTeam ?? ""), ab) &&
      hit.homeTeamId
    ) {
      return String(hit.homeTeamId);
    }
  }

  // Fallback: team names on the id map contain the player's abbr token.
  if (opts.teamIdMap) {
    const ids = resolveCoachGameTeamIds(opts.game, sport, opts.teamIdMap);
    if (!ids) return null;
    if (teamNameMatchesAbbr(String(ids.homeTeam ?? ""), ab)) return ids.awayTeamId;
    if (teamNameMatchesAbbr(String(ids.awayTeam ?? ""), ab)) return ids.homeTeamId;
  }
  return null;
}

/**
 * Resolve the player's own ESPN team id (inverse of opponentTeamIdForProp).
 * Used for O-line / QB tendency packs already loaded in the defense map.
 */
export function ownTeamIdForProp(opts: {
  sport?: string | null;
  game: string;
  teamAbbr?: string | null;
  espnGames?: OppTeamIdEspnGame[] | null;
  teamIdMap?: Map<string, OppTeamIdMapEntry> | null;
}): string | null {
  const sport = String(opts.sport ?? "").toLowerCase();
  if (!sport) return null;
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
    if (homeAb === ab && hit.homeTeamId) return String(hit.homeTeamId);
    if (awayAb === ab && hit.awayTeamId) return String(hit.awayTeamId);
    if (
      teamNameMatchesAbbr(String(hit.homeTeam ?? ""), ab) &&
      hit.homeTeamId
    ) {
      return String(hit.homeTeamId);
    }
    if (
      teamNameMatchesAbbr(String(hit.awayTeam ?? ""), ab) &&
      hit.awayTeamId
    ) {
      return String(hit.awayTeamId);
    }
  }

  if (opts.teamIdMap) {
    const ids = resolveCoachGameTeamIds(opts.game, sport, opts.teamIdMap);
    if (!ids) return null;
    if (teamNameMatchesAbbr(String(ids.homeTeam ?? ""), ab)) return ids.homeTeamId;
    if (teamNameMatchesAbbr(String(ids.awayTeam ?? ""), ab)) return ids.awayTeamId;
  }
  return null;
}
