/**
 * Build Opportunity Shift tables from already-loaded ESPN injury + prop player lists.
 * Sync only — never fetches.
 */

import {
  buildOpportunityShiftTable,
  mergeOpportunityShiftTables,
} from "./engine.js";
import type {
  BeneficiaryUsageInput,
  InjuryVacancyInput,
  OpportunityShiftTable,
} from "./types.js";

export type EspnInjuryTeamLike = {
  team?: string;
  entries?: Array<{
    player?: string;
    status?: string;
    position?: string | null;
    athleteId?: string | null;
  }>;
};

export type PropPlayerLike = {
  player: string;
  athleteId?: string | null;
  team?: string | null;
  position?: string | null;
  isHome?: boolean | null;
  pricedInFactor?: number;
  channelUsage?: BeneficiaryUsageInput["channelUsage"];
  minutesL5?: number | null;
  minutesSeason?: number | null;
};

/**
 * One table for the game (home+away merged), built once and reused across candidates.
 */
export function buildOpportunityShiftForGame(opts: {
  sport: string;
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  injuries: readonly EspnInjuryTeamLike[];
  players: readonly PropPlayerLike[];
}): OpportunityShiftTable {
  const injuryInputs: InjuryVacancyInput[] = [];
  for (const t of opts.injuries) {
    const team = String(t.team ?? "").trim();
    if (!team) continue;
    for (const e of t.entries ?? []) {
      const player = String(e.player ?? "").trim();
      if (!player) continue;
      injuryInputs.push({
        player,
        athleteId: e.athleteId,
        team,
        position: e.position,
        status: String(e.status ?? ""),
      });
    }
  }

  const beneficiaries: BeneficiaryUsageInput[] = opts.players
    .filter((p) => p.player && p.team)
    .map((p) => ({
      player: p.player,
      athleteId: p.athleteId,
      team: String(p.team),
      position: p.position,
      channelUsage: p.channelUsage,
      minutesL5: p.minutesL5,
      minutesSeason: p.minutesSeason,
      pricedInFactor: p.pricedInFactor,
    }));

  // Also ensure injured players appear as usage sources when listed on injuries only.
  for (const inj of injuryInputs) {
    if (!beneficiaries.some((b) => b.player === inj.player && b.team === inj.team)) {
      beneficiaries.push({
        player: inj.player,
        athleteId: inj.athleteId,
        team: inj.team,
        position: inj.position,
      });
    }
  }

  const home = buildOpportunityShiftTable({
    sport: opts.sport,
    gameKey: opts.gameKey,
    team: opts.homeTeam,
    injuries: injuryInputs,
    beneficiaries,
  });
  const away = buildOpportunityShiftTable({
    sport: opts.sport,
    gameKey: opts.gameKey,
    team: opts.awayTeam,
    injuries: injuryInputs,
    beneficiaries,
  });
  return mergeOpportunityShiftTables([home, away]);
}
