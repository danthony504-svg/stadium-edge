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

/** UFC/MMA total detail badge — not "GAME TOTAL" (team sports). */
export function fightTotalBadgeLabel(market?: string | null): string {
  const m = String(market ?? "");
  if (/total rounds/i.test(m)) return "TOTAL ROUNDS";
  return "FIGHT TOTAL";
}

/** Subtitle under the pick on UFC total sheets. */
export function fightTotalMarketSubtitle(market?: string | null): string {
  const m = String(market ?? "").trim() || "Total Rounds";
  return `${m} · rounds O/U`;
}

/**
 * Honest copy for UFC total-rounds detail — never claim team combined scores.
 * Method-of-victory remains unsupported by The Odds API.
 */
export function fightTotalRoundsExplain(
  line: number | null | undefined,
  pick?: string | null,
): string {
  const side = /\bunder\b/i.test(String(pick ?? ""))
    ? "Under"
    : /\bover\b/i.test(String(pick ?? ""))
      ? "Over"
      : null;
  const lineBit = line != null && Number.isFinite(line) ? `${line}` : "the line";
  const sideBit = side ? `${side} ${lineBit}` : `the ${lineBit} line`;
  return [
    `${sideBit} is a posted total-rounds market from The Odds API.`,
    "Stats below are each fighter's real record, finish rates, and recent results — not team scoring.",
    "The 10k fight sim estimates how often the bout lands Over/Under from those career signals.",
    "Method of victory, go-the-distance, and round-winner markets are not in the feed, so we don't invent them.",
  ].join(" ");
}
