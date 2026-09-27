/**
 * Greenfield NFL / NCAAF props-only selection — pure, no api.ts.
 *
 * Rebuild after #541: Odds API anytime_td often has line:null. Generic
 * isRealisticBoardPropCandidate dropped those rows → propLegsScored=0.
 * Props-only candidacy normalizes binary null→0.5 and still requires athleteId.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { footballSkillPropRank } from "./boardScanPropDelivery.ts";
import {
  footballMixSimFamily,
  selectFootballMixPropSimCandidates,
  shouldUseFootballSkillPropSim,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import {
  normalizePropsOnlyPick,
  propsOnlyEffectiveLine,
  propsOnlyLegClearsOdds,
} from "./coachFootballPropsOnlyGrade.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

/** Tiny batches so local history enrich can finish (wide batches were timing out → 0 grades). */
export const FOOTBALL_PROPS_ONLY_BATCH = 8;

/** Cap candidates — finishable under Coach absolute budget with local-first grading. */
export function footballPropsOnlyMaxCandidates(targetLegs: number, poolSize: number): number {
  const mixCap = boardScanMaxPropsToSimForMix(targetLegs, poolSize);
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
 * Props-only candidacy: posted odds + sim-supported market + effective line
 * (null anytime TD → 0.5). AthleteId required for local history grade.
 */
export function isFootballPropsOnlyCandidate(pick: ParsedPick): boolean {
  if (!pick.isProp) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  const norm = normalizePropsOnlyPick(pick);
  const line = propsOnlyEffectiveLine(norm);
  if (line == null || !Number.isFinite(line)) return false;
  const side = norm.propSide === "Under" || norm.propSide === "Over" ? norm.propSide : null;
  if (!side) return false;
  return marketSupportsSimulation(norm.market ?? "", norm);
}

/**
 * AthleteId-required skill candidacy. Null-line TDs normalize to 0.5 first
 * so they are not dropped before the finishable skill mix.
 */
export function selectFootballPropsOnlyFromPicks(
  picks: ParsedPick[],
  targetLegs: number,
): ParsedPick[] {
  const ranked = picks
    .map(normalizePropsOnlyPick)
    .filter(isFootballPropsOnlyCandidate)
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

/** Stage best-EV scored legs — EV-first, one player/market, ≤3 per game. */
export function stageFootballPropsOnlyLegs(
  scored: BoardScoredLeg[],
  target: number,
): ParsedPick[] {
  const picks: ParsedPick[] = [];
  const usedPlayerMarket = new Set<string>();
  const usedGames = new Map<string, number>();
  const ordered = [...scored].sort((a, b) => {
    const evDiff = (b.evPct ?? -999) - (a.evPct ?? -999);
    if (evDiff !== 0) return evDiff;
    return (b.rankScore ?? 0) - (a.rankScore ?? 0);
  });
  for (const leg of ordered) {
    if (picks.length >= target) break;
    const p = normalizePropsOnlyPick(leg.pick);
    if (!propsOnlyLegClearsOdds(p, leg.simHit)) continue;
    const pm = `${p.player}|${p.propMarketKey ?? p.market}`.toLowerCase();
    if (usedPlayerMarket.has(pm)) continue;
    const gameCount = usedGames.get(p.game) ?? 0;
    if (gameCount >= 3) continue;
    usedPlayerMarket.add(pm);
    usedGames.set(p.game, gameCount + 1);
    picks.push({
      ...p,
      ticketRole: p.propIsAlt ? "alt" : "main",
      finalAiScore: p.finalAiScore,
    });
  }
  return picks;
}
