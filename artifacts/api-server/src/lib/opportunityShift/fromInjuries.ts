/**
 * Build Opportunity Shift tables from already-loaded ESPN injury + prop player lists.
 * Sync only — never fetches.
 */

import {
  classifyVacancyConfirmation,
  vacancyFractionForConfirmation,
} from "./confirmation.js";
import {
  buildOpportunityShiftTable,
  mergeOpportunityShiftTables,
} from "./engine.js";
import type {
  BeneficiaryUsageInput,
  InjuryVacancyInput,
  OpportunityShiftTable,
} from "./types.js";

function normKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

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

  // Enrich prop-player positions from the injury feed when simulate/coach
  // omit roster position (common on /sports/simulate/props).
  const positionByPlayer = new Map<string, string>();
  const athleteIdByPlayer = new Map<string, string>();
  for (const inj of injuryInputs) {
    const key = normKey(inj.player);
    if (inj.position && !positionByPlayer.has(key)) {
      positionByPlayer.set(key, String(inj.position));
    }
    if (inj.athleteId && !athleteIdByPlayer.has(key)) {
      athleteIdByPlayer.set(key, String(inj.athleteId));
    }
  }

  const beneficiaries: BeneficiaryUsageInput[] = opts.players
    .filter((p) => p.player && p.team)
    .map((p) => {
      const key = normKey(p.player);
      return {
        player: p.player,
        athleteId: p.athleteId ?? athleteIdByPlayer.get(key) ?? null,
        team: String(p.team),
        position: p.position ?? positionByPlayer.get(key) ?? null,
        channelUsage: p.channelUsage,
        minutesL5: p.minutesL5,
        minutesSeason: p.minutesSeason,
        pricedInFactor: p.pricedInFactor,
      };
    });

  // Only confirmed vacancies are appended — as usage sources for vacated
  // channels. Do NOT dump the entire injury report into the beneficiary pool
  // (that diluted shares onto non-role Active/Q players and broke conservation).
  for (const inj of injuryInputs) {
    const frac = vacancyFractionForConfirmation(
      classifyVacancyConfirmation(inj.status),
    );
    if (frac <= 0) continue;
    if (
      !beneficiaries.some(
        (b) =>
          normKey(b.player) === normKey(inj.player) &&
          b.team === inj.team,
      )
    ) {
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
