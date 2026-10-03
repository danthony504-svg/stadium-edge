/**
 * UFC/MMA moneylines open the team-pick sheet (non-prop game sides), but
 * fighters are not ESPN teams — team-search/history always empty. Helpers for
 * routing to fight-analysis instead of team stats.
 */

export function isCombatFightSport(sport?: string | null): boolean {
  const s = String(sport ?? "").toLowerCase();
  return s === "ufc" || s === "mma";
}

/** Parse "Away @ Home" odds label into fighter names. */
export function parseFightGameSides(game?: string | null): {
  away: string;
  home: string;
} | null {
  const parts = String(game ?? "").split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (!away || !home) return null;
  return { away, home };
}

/**
 * Which side of the fight the pick names (away/home), using the team/opp
 * params Coach/slip already pass into team-pick.
 */
export function fightPickSide(opts: {
  team?: string | null;
  away?: string | null;
  home?: string | null;
}): "away" | "home" | null {
  const team = norm(opts.team);
  if (!team) return null;
  if (team === norm(opts.away)) return "away";
  if (team === norm(opts.home)) return "home";
  // Surname / partial match (Romero vs Anthony Romero).
  const away = norm(opts.away);
  const home = norm(opts.home);
  if (away && (away.includes(team) || team.includes(away))) return "away";
  if (home && (home.includes(team) || team.includes(home))) return "home";
  return null;
}

function norm(s?: string | null): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when fight analysis has enough real data to show stats (not empty). */
export function fightAnalysisHasStats(analysis: {
  away?: { record?: unknown; recentForm?: unknown[] | null; athleteId?: string | null } | null;
  home?: { record?: unknown; recentForm?: unknown[] | null; athleteId?: string | null } | null;
} | null | undefined): boolean {
  if (!analysis) return false;
  const sideHas = (f: typeof analysis.away) =>
    !!(f?.record || (f?.recentForm && f.recentForm.length > 0) || f?.athleteId);
  return sideHas(analysis.away) || sideHas(analysis.home);
}
