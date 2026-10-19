import type { PreparedGameContext } from "./preparedGameContext.js";
import type { SimPropRequest } from "./monteCarloBuild.js";
import type { OpportunityShiftBuildInputs } from "./propSimRunner.js";
import { classifyVacancyConfirmation, normName, teamMatch } from "./opportunityShift/index.js";

/** Uses the injury report already loaded for this game; never does I/O.
 * A roster entry or a historical start does not establish today's availability.
 * Doubtful / questionable stay uncertain, not confirmed out.
 */
export function propHasConfirmedAbsence(
  prop: SimPropRequest,
  sport: string,
  inputs: OpportunityShiftBuildInputs | null | undefined,
): boolean {
  if (!inputs || prop.sport !== sport || prop.isHome == null) return false;
  const team = prop.isHome ? inputs.homeTeam : inputs.awayTeam;
  if (!team) return false;
  return inputs.injuries.some(group => teamMatch(group.team ?? "", team) &&
    (group.entries ?? []).some(entry => {
      const samePlayer = prop.athleteId && entry.athleteId
        ? prop.athleteId === entry.athleteId
        : !!prop.player && normName(entry.player ?? "") === normName(prop.player);
      return samePlayer && classifyVacancyConfirmation(entry.status ?? "") === "out";
    }));
}

/** Bench players may still participate. Apply only to starter-dependent markets. */
export function propHasConfirmedNonstarter(prop: SimPropRequest, sport: string, context: PreparedGameContext | null | undefined): boolean {
  if (!context || prop.sport !== sport || context.sport !== sport || (prop.homeTeamId && prop.homeTeamId !== context.homeTeamId) || (prop.awayTeamId && prop.awayTeamId !== context.awayTeamId) || context.expiresAtMs <= Date.now() || context.observedAtMs > Date.now() || Date.parse(context.startsAt) <= Date.now() || !prop.athleteId || prop.isHome == null) return false;
  const market = prop.market.toLowerCase();
  const starterDependent = sport === "mlb" ? /batter|total_bases|^hits$|^home_runs$/.test(market) : sport === "soccer";
  if (!starterDependent) return false;
  const teamId = prop.isHome ? context.homeTeamId : context.awayTeamId;
  const lineup = context.lineups.find(l => l.teamId === teamId);
  return !!lineup?.complete && lineup.players.some(p => p.athleteId === prop.athleteId && p.starter === false);
}
