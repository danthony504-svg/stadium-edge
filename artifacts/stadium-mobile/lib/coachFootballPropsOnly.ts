/**
 * Greenfield props-only selection — pure, no api.ts.
 *
 * Phone root cause (not a gate tweak):
 * "8 leg player prop" on a WNBA-heavy afternoon board skipped the dedicated
 * ticket builder because shouldUseFootballSkillPropSim required ≥50% NFL/NCAAF,
 * then fell through to generic board scan (confidence≥52 + Match/Form/Inj
 * holistic) and staged only 3 legs. "7 leg NFL player prop" emptied on the
 * same broken generic path whenever the football gate missed.
 *
 * Rebuild: EVERY props-only ask (any sport) uses this candidacy + the history/EV
 * ticket builder — never the multi-signal board-scan fill path.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { footballSkillPropRank, skillPropRank } from "./boardScanPropDelivery.ts";
import {
  footballMixSimFamily,
  selectBoardPropSimCandidates,
  selectFootballMixPropSimCandidates,
  shouldUseFootballSkillPropSim,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import {
  normalizePropsOnlyPick,
  propsOnlyCollapseLadderKey,
  propsOnlyEffectiveLine,
  propsOnlyLegClearsOdds,
} from "./coachFootballPropsOnlyGrade.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

/** Tiny batches so local history enrich can finish (wide batches were timing out → 0 grades). */
export const FOOTBALL_PROPS_ONLY_BATCH = 8;
/** @deprecated alias — batches are sport-agnostic now. */
export const PROPS_ONLY_BATCH = FOOTBALL_PROPS_ONLY_BATCH;

/** Cap candidates — finishable under Coach absolute budget with local-first grading. */
export function footballPropsOnlyMaxCandidates(targetLegs: number, poolSize: number): number {
  const mixCap = boardScanMaxPropsToSimForMix(targetLegs, poolSize);
  return Math.min(mixCap, Math.max(targetLegs * 6, 40));
}

export const propsOnlyMaxCandidates = footballPropsOnlyMaxCandidates;

function poolIsFootballHeavy(pool: readonly { sport?: string | null }[]): boolean {
  let football = 0;
  let total = 0;
  for (const p of pool) {
    const s = String(p.sport ?? "").toLowerCase();
    if (!s) continue;
    total += 1;
    if (s === "nfl" || s === "ncaaf") football += 1;
  }
  return total > 0 && football / total >= 0.5;
}

/**
 * Props-only ticket builder entry — ANY sport with a posted prop pool.
 * Previously football-gated (≥50% NFL/NCAAF); that sent "8 leg player prop"
 * into the generic board scan that only clears ~3 legs.
 */
export function shouldBuildFootballPropsOnlyTicket(opts: {
  propsOnly?: boolean;
  pool: readonly { sport?: string | null }[];
}): boolean {
  if (!opts.propsOnly || opts.pool.length === 0) return false;
  return true;
}

/** @deprecated Prefer shouldBuildFootballPropsOnlyTicket — same contract. */
export const shouldBuildPropsOnlyTicket = shouldBuildFootballPropsOnlyTicket;

/** Football mix deep-sim path (non-props-only "10 leg nfl") — unchanged. */
export function shouldUseFootballPropsOnlySkillMix(opts: {
  requirePropMix?: boolean;
  propsOnly?: boolean;
  pool: readonly { sport?: string | null }[];
}): boolean {
  return shouldUseFootballSkillPropSim(opts);
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

export const isPropsOnlyCandidate = isFootballPropsOnlyCandidate;

/**
 * AthleteId-required skill candidacy. Football-heavy pools keep yards/TD
 * family quotas; multi-sport / WNBA / NBA boards use ladder-deduped skill rank
 * so points/rebounds are not starved by empty football buckets.
 */
export function selectFootballPropsOnlyFromPicks(
  picks: ParsedPick[],
  targetLegs: number,
  poolSports?: readonly { sport?: string | null }[],
): ParsedPick[] {
  const ranked = picks
    .map(normalizePropsOnlyPick)
    .filter(isFootballPropsOnlyCandidate)
    .filter((p) => !!p.athleteId)
    .sort((a, b) => {
      const skill =
        skillPropRank(b.propMarketKey ?? b.market) -
        skillPropRank(a.propMarketKey ?? a.market);
      if (skill !== 0) return skill;
      // Prefer football skill rank as a soft tiebreak when both are football.
      return (
        footballSkillPropRank(b.propMarketKey ?? b.market) -
        footballSkillPropRank(a.propMarketKey ?? a.market)
      );
    });
  const max = footballPropsOnlyMaxCandidates(targetLegs, ranked.length);
  const footballHeavy =
    poolSports != null ? poolIsFootballHeavy(poolSports) : poolIsFootballHeavy(ranked);
  if (footballHeavy) {
    const { selected } = selectFootballMixPropSimCandidates(ranked, max);
    return selected;
  }
  const { selected } = selectBoardPropSimCandidates(ranked, max);
  return selected;
}

export const selectPropsOnlyFromPicks = selectFootballPropsOnlyFromPicks;

/** Family mix on athleteId-only selection. */
export function footballPropsOnlyFamilyCounts(picks: ParsedPick[]): Record<string, number> {
  const counts: Record<string, number> = { yards: 0, td: 0, volume: 0, other: 0 };
  for (const p of picks) {
    const fam = footballMixSimFamily(p);
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  return counts;
}

/**
 * Per-game ceiling for props-only thin slates.
 * Phone: "7 leg NFL player props" → oddsOk=23 staged=3 because a hard ≤3/game
 * cap met a 1-game Thursday board. Player props correlate less than stacking
 * game lines — raise the ceiling from the games we actually have so a fixed
 * leg ask can fill without inventing filler.
 */
export function propsOnlyPerGameCeiling(
  target: number,
  uniqueGamesInPool: number,
): number {
  const games = Math.max(1, uniqueGamesInPool);
  // Enough to reach target from the games present (1 game → all legs from it).
  return Math.min(target, Math.ceil(target / Math.min(games, 3)));
}

function stageFootballPropsOnlyLegsWithCap(
  ordered: BoardScoredLeg[],
  target: number,
  maxPerGame: number,
  maxSameGameMarketSide: number,
): ParsedPick[] {
  const picks: ParsedPick[] = [];
  const usedPlayerMarket = new Set<string>();
  const usedGames = new Map<string, number>();
  // Cap identical market+side stacks per game (phone: CBJ Under 0.5 Points × roster).
  const usedGameMarketSide = new Map<string, number>();
  for (const leg of ordered) {
    if (picks.length >= target) break;
    const p = normalizePropsOnlyPick(leg.pick);
    if (!propsOnlyLegClearsOdds(p, leg.simHit)) continue;
    // Canonical ladder — main + `_alternate` share one seat per player.
    const pm = propsOnlyCollapseLadderKey(p);
    if (usedPlayerMarket.has(pm)) continue;
    const gameKey = String(p.game ?? "");
    const gameCount = usedGames.get(gameKey) ?? 0;
    if (gameCount >= maxPerGame) continue;
    const marketSide = `${String(p.propMarketKey ?? p.market ?? "")
      .toLowerCase()
      .replace(/_/g, " ")}|${String(p.propSide ?? "").toLowerCase()}`;
    const gameMarketSide = `${gameKey}|${marketSide}`;
    const gmsCount = usedGameMarketSide.get(gameMarketSide) ?? 0;
    if (gmsCount >= maxSameGameMarketSide) continue;
    usedPlayerMarket.add(pm);
    usedGames.set(gameKey, gameCount + 1);
    usedGameMarketSide.set(gameMarketSide, gmsCount + 1);
    picks.push({
      ...p,
      // Mark props-only delivery so PickCard shows the letter grade (not Not Rec.)
      // when history/EV cleared but holistic confidence sits at 50–51.
      propsOnlyTicket: true,
      ticketRole: p.propIsAlt ? "alt" : "main",
      finalAiScore: p.finalAiScore,
    });
  }
  return picks;
}

/** Stage best-EV scored legs — EV-first, one player/market, thin-slate per-game raise. */
export function stageFootballPropsOnlyLegs(
  scored: BoardScoredLeg[],
  target: number,
): ParsedPick[] {
  const ordered = [...scored].sort((a, b) => {
    const evDiff = (b.evPct ?? -999) - (a.evPct ?? -999);
    if (evDiff !== 0) return evDiff;
    return (b.rankScore ?? 0) - (a.rankScore ?? 0);
  });
  const uniqueGames = new Set(
    ordered.map((l) => String(l.pick.game ?? "")).filter(Boolean),
  ).size;
  const ceiling = propsOnlyPerGameCeiling(target, uniqueGames || 1);
  const thinSlate = uniqueGames <= 1;
  // Start at 3 (historic props-only default); raise to ceiling when short.
  // Prefer 1× same market+side per game on multi-game boards; raise only to fill.
  let best: ParsedPick[] = [];
  for (let cap = Math.min(3, ceiling); cap <= ceiling; cap++) {
    const msStart = thinSlate ? cap : 1;
    for (let msCap = msStart; msCap <= cap; msCap++) {
      best = stageFootballPropsOnlyLegsWithCap(ordered, target, cap, msCap);
      if (best.length >= target) return best;
    }
  }
  return best;
}

export const stagePropsOnlyLegs = stageFootballPropsOnlyLegs;
