/**
 * Greenfield NFL / NCAAF props-only selection — pure, no api.ts.
 *
 * Phone empties ("9 leg NFL player props" → PROP_ALL_NO_SIM_GRADE after deep-simming
 * 72 of 4713) came from the generic board-scan enrich race wiping wide batches.
 * Selection here is athleteId-required + finishable skill mix; the ticket builder
 * grades local-first in tiny batches (see coachFootballPropsOnlyTicket.ts).
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { footballSkillPropRank } from "./boardScanPropDelivery.ts";
import {
  footballMixSimFamily,
  isRealisticBoardPropCandidate,
  selectFootballMixPropSimCandidates,
  shouldUseFootballSkillPropSim,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";

/** Tiny batches so local history enrich can finish (wide batches were timing out → 0 grades). */
export const FOOTBALL_PROPS_ONLY_BATCH = 8;

/** Cap candidates — finishable under Coach absolute budget with local-first grading. */
export function footballPropsOnlyMaxCandidates(targetLegs: number, poolSize: number): number {
  const mixCap = boardScanMaxPropsToSimForMix(targetLegs, poolSize);
  // Slightly under mix cap — props-only has no game phase competing, but enrich is heavier.
  return Math.min(mixCap, Math.max(targetLegs * 6, 40));
}

export function shouldBuildFootballPropsOnlyTicket(opts: {
  propsOnly?: boolean;
  pool: readonly { sport?: string | null }[];
}): boolean {
  return shouldUseFootballSkillPropSim({
    propsOnly: opts.propsOnly,
    pool: opts.pool,
  });
}

/**
 * AthleteId-required skill candidacy. Rows without ids cannot local-grade and
 * were the missing_athlete_id dead-end behind empty props-only tickets.
 */
export function selectFootballPropsOnlyFromPicks(
  picks: ParsedPick[],
  targetLegs: number,
): ParsedPick[] {
  const ranked = picks
    .filter(isRealisticBoardPropCandidate)
    .filter((p) => !!p.athleteId)
    .sort((a, b) => {
      const skill =
        footballSkillPropRank(b.propMarketKey ?? b.market) -
        footballSkillPropRank(a.propMarketKey ?? a.market);
      if (skill !== 0) return skill;
      return 0;
    });
  const max = footballPropsOnlyMaxCandidates(targetLegs, ranked.length);
  const { selected } = selectFootballMixPropSimCandidates(ranked, max);
  return selected;
}

/** Family mix on athleteId-only selection. */
export function footballPropsOnlyFamilyCounts(picks: ParsedPick[]): Record<string, number> {
  const counts: Record<string, number> = { yards: 0, td: 0, volume: 0, other: 0 };
  for (const p of picks) {
    const fam = footballMixSimFamily(p);
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  return counts;
}
