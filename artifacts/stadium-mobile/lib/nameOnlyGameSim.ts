/**
 * UFC/MMA/tennis game-outcome sims are name-keyed on the server (fighter /
 * player names), not ESPN team ids. Odds-board fights often lack athlete ids
 * in the games map — without a name-only path Coach drops them as
 * "unresolved" and reports a fake quality-bar shortfall (phone: 4 leg UFC → 2).
 */

export type NameOnlyGameIds = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
};

export function isNameOnlyGameSimSport(sport?: string | null): boolean {
  const s = String(sport ?? "").toLowerCase();
  return s === "ufc" || s === "mma" || s === "tennis" || s === "tabletennis";
}

/** Build placeholder ids from an "Away @ Home" odds label for name-only sports. */
export function nameOnlyIdsFromGameLabel(
  gameLabel: string,
  sport?: string | null,
): NameOnlyGameIds | null {
  if (!isNameOnlyGameSimSport(sport)) return null;
  const parts = String(gameLabel ?? "").split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (!away || !home) return null;
  return {
    sport: String(sport ?? "").toLowerCase(),
    homeTeamId: "",
    awayTeamId: "",
    homeTeam: home,
    awayTeam: away,
  };
}
