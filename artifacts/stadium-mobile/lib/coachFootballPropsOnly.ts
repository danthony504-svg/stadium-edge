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
  PROPS_ONLY_ODDS_SLACK,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  isRareCountPropMarket,
  rareCountEvRankWeight,
  rareCountGameFamilyKey,
} from "./rareCountPropModel.ts";
import { withCoachQualification } from "./coach/qualifyCoachCandidate.ts";
import { rareMultiCountNormalSeatAllowed } from "./rareMultiCountCoachGate.ts";
import {
  anytimeTdNormalSeatAllowed,
  isAnytimeTdPropMarket,
} from "./anytimeTdPropModel.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { distinctPropSimSeeds } from "./coachPropSimCoverage.ts";
import { requiresScoringOrder } from "./binaryPropMarket.ts";

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
  if (requiresScoringOrder(pick.propMarketKey)) return false;
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
  const seeds = distinctPropSimSeeds(ranked);
  const max = footballPropsOnlyMaxCandidates(targetLegs, ranked.length);
  const footballHeavy =
    poolSports != null ? poolIsFootballHeavy(poolSports) : poolIsFootballHeavy(ranked);
  if (footballHeavy) {
    const { selected } = selectFootballMixPropSimCandidates(seeds, max);
    return selected;
  }
  const { selected } = selectBoardPropSimCandidates(seeds, max);
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

/**
 * Reliability-weighted EV sort key — extreme longshot EV from weak rare-count
 * probabilities cannot outrank ordinary high-confidence props.
 */
export function propsOnlyReliabilityWeightedEv(leg: BoardScoredLeg): number {
  const ev = leg.evPct ?? -999;
  const market = leg.pick.propMarketKey ?? leg.pick.market;
  if (!isRareCountPropMarket(market) && !isAnytimeTdPropMarket(market)) return ev;
  const rel =
    leg.hitReliability != null && Number.isFinite(leg.hitReliability)
      ? leg.hitReliability
      : 0.25;
  return ev * rareCountEvRankWeight(rel);
}

export function comparePropsOnlyLegsByReliableEv(a: BoardScoredLeg, b: BoardScoredLeg): number {
  const evDiff = propsOnlyReliabilityWeightedEv(b) - propsOnlyReliabilityWeightedEv(a);
  if (evDiff !== 0) return evDiff;
  return (b.rankScore ?? 0) - (a.rankScore ?? 0);
}

/** Opt-in staging reject tallies for funnel audits (PROPS_ONLY_STAGE_AUDIT=1). */
export type PropsOnlyStageAudit = {
  scoredIn: number;
  oddsFail: number;
  qualifyFail: Record<string, number>;
  rareFail: number;
  anytimeFail: number;
  ladderDedupe: number;
  perGameCap: number;
  marketSideCap: number;
  rareFamilyCap: number;
  seated: number;
  samples: Array<{
    player?: string | null;
    market?: string | null;
    line?: number | null;
    side?: string | null;
    isAlt?: boolean;
    odds?: number | null;
    simHit?: number | null;
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    reason: string;
    game?: string | null;
  }>;
};

let propsOnlyStageAudit: PropsOnlyStageAudit | null = null;

export function takePropsOnlyStageAudit(): PropsOnlyStageAudit | null {
  const out = propsOnlyStageAudit;
  propsOnlyStageAudit = null;
  return out;
}

function stageFootballPropsOnlyLegsWithCap(
  ordered: BoardScoredLeg[],
  target: number,
  maxPerGame: number,
  maxSameGameMarketSide: number,
  oddsSlack: number = PROPS_ONLY_ODDS_SLACK,
  allowRareCountFamilyStack = false,
  seatOpts?: {
    askText?: string | null;
    ticketStyle?: string | null;
    allowRareMultiCount?: boolean;
  },
): ParsedPick[] {
  // Always tally stage rejects for failDiag (samples only when PROPS_ONLY_STAGE_AUDIT=1).
  const keepSamples = process.env.PROPS_ONLY_STAGE_AUDIT === "1";
  const audit: PropsOnlyStageAudit = {
    scoredIn: ordered.length,
    oddsFail: 0,
    qualifyFail: {},
    rareFail: 0,
    anytimeFail: 0,
    ladderDedupe: 0,
    perGameCap: 0,
    marketSideCap: 0,
    rareFamilyCap: 0,
    seated: 0,
    samples: [],
  };
  const bumpFail = (reason: string, sample?: PropsOnlyStageAudit["samples"][number]) => {
    if (reason.startsWith("qualify:")) {
      const key = reason.slice("qualify:".length);
      audit.qualifyFail[key] = (audit.qualifyFail[key] ?? 0) + 1;
    } else if (reason === "odds") audit.oddsFail += 1;
    else if (reason === "rare") audit.rareFail += 1;
    else if (reason === "anytime") audit.anytimeFail += 1;
    else if (reason === "ladder") audit.ladderDedupe += 1;
    else if (reason === "per_game") audit.perGameCap += 1;
    else if (reason === "market_side") audit.marketSideCap += 1;
    else if (reason === "rare_family") audit.rareFamilyCap += 1;
    if (keepSamples && sample && audit.samples.length < 20) audit.samples.push(sample);
  };

  const picks: ParsedPick[] = [];
  const usedPlayerMarket = new Set<string>();
  const usedGames = new Map<string, number>();
  // Cap identical market+side stacks per game (phone: CBJ Under 0.5 Points × roster).
  const usedGameMarketSide = new Map<string, number>();
  // Generic tickets: one rare-count family (HR / SB / goals) seat per event.
  const usedRareGameFamily = new Map<string, number>();
  for (const leg of ordered) {
    if (picks.length >= target) break;
    const p = normalizePropsOnlyPick(leg.pick);
    if (!propsOnlyLegClearsOdds(p, leg.simHit, oddsSlack)) {
      bumpFail("odds");
      continue;
    }
    // Shared quality authority — props-only may add stricter constraints above,
    // but must never replace a shared rejection with a forged "qualified".
    const grade = leg.grade ?? p.finalAiScore?.grade ?? null;
    const confidencePct =
      leg.confidencePct ?? p.finalAiScore?.confidencePct ?? null;
    const edgePct = leg.edgePct ?? p.finalAiScore?.edgePct ?? null;
    const simHit = leg.simHit ?? p.finalAiScore?.simHit ?? null;
    const propProbabilityProvenance =
      (p as { propProbabilityProvenance?: import("./coachPropProbabilityProvenance.ts").PropProbabilityProvenance | null })
        .propProbabilityProvenance ??
      p.finalAiScore?.propProbabilityProvenance ??
      null;
    const qualified = withCoachQualification(
      {
        ...p,
        isProp: true,
        propsOnlyTicket: true,
        grade,
        confidencePct,
        edgePct,
        simHit,
        odds: p.odds,
        finalAiScore: p.finalAiScore,
        propProbabilityProvenance,
      },
      { requestStyle: "props_only", isProp: true },
    );
    if (qualified.qualificationStatus !== "qualified") {
      bumpFail(`qualify:${qualified.qualificationReason ?? "rejected"}`, {
        player: p.player,
        market: p.propMarketKey ?? p.market,
        line: p.propLine,
        side: p.propSide,
        isAlt: !!p.propIsAlt,
        odds: p.odds,
        simHit,
        grade,
        confidencePct,
        edgePct,
        reason: qualified.qualificationReason ?? "rejected",
        game: p.game,
      });
      continue;
    }
    // Rare multi-count Overs: normal props-only fail-closed unless lottery /
    // explicit 2+ ask or sufficient reliability.
    if (
      !rareMultiCountNormalSeatAllowed(
        { ...p, isProp: true },
        {
          askText: seatOpts?.askText,
          ticketStyle: seatOpts?.ticketStyle,
          hitReliability: leg.hitReliability,
          allowLotteryPath: seatOpts?.allowRareMultiCount,
        },
      )
    ) {
      bumpFail("rare", {
        player: p.player,
        market: p.propMarketKey ?? p.market,
        line: p.propLine,
        side: p.propSide,
        isAlt: !!p.propIsAlt,
        odds: p.odds,
        simHit,
        grade,
        confidencePct,
        edgePct,
        reason: "rare_multi_count",
        game: p.game,
      });
      continue;
    }
    if (
      !anytimeTdNormalSeatAllowed(
        { ...p, isProp: true },
        {
          hitReliability: leg.hitReliability,
          odds: p.odds,
          simHit,
        },
      )
    ) {
      bumpFail("anytime", {
        player: p.player,
        market: p.propMarketKey ?? p.market,
        line: p.propLine,
        side: p.propSide,
        isAlt: !!p.propIsAlt,
        odds: p.odds,
        simHit,
        grade,
        confidencePct,
        edgePct,
        reason: "anytime_td_seat",
        game: p.game,
      });
      continue;
    }
    // Canonical ladder — main + `_alternate` share one seat per player.
    const pm = propsOnlyCollapseLadderKey(p);
    if (usedPlayerMarket.has(pm)) {
      bumpFail("ladder");
      continue;
    }
    const gameKey = String(p.game ?? "");
    const gameCount = usedGames.get(gameKey) ?? 0;
    if (gameCount >= maxPerGame) {
      bumpFail("per_game");
      continue;
    }
    const marketSide = `${String(p.propMarketKey ?? p.market ?? "")
      .toLowerCase()
      .replace(/_/g, " ")}|${String(p.propSide ?? "").toLowerCase()}`;
    const gameMarketSide = `${gameKey}|${marketSide}`;
    const gmsCount = usedGameMarketSide.get(gameMarketSide) ?? 0;
    if (gmsCount >= maxSameGameMarketSide) {
      bumpFail("market_side");
      continue;
    }
    if (!allowRareCountFamilyStack) {
      const rareKey = rareCountGameFamilyKey({
        game: p.game,
        market: p.propMarketKey ?? p.market,
      });
      if (rareKey) {
        const rareCount = usedRareGameFamily.get(rareKey) ?? 0;
        // One seat per same-event rare family on generic mixed asks.
        if (rareCount >= 1) {
          bumpFail("rare_family");
          continue;
        }
      }
    }
    usedPlayerMarket.add(pm);
    usedGames.set(gameKey, gameCount + 1);
    usedGameMarketSide.set(gameMarketSide, gmsCount + 1);
    if (!allowRareCountFamilyStack) {
      const rareKey = rareCountGameFamilyKey({
        game: p.game,
        market: p.propMarketKey ?? p.market,
      });
      if (rareKey) {
        usedRareGameFamily.set(rareKey, (usedRareGameFamily.get(rareKey) ?? 0) + 1);
      }
    }
    audit.seated += 1;
    picks.push({
      ...qualified,
      propsOnlyTicket: true,
      ticketRole: p.propIsAlt ? "alt" : "main",
      finalAiScore: p.finalAiScore,
      ...(seatOpts?.allowRareMultiCount ? { allowRareMultiCount: true as const } : {}),
    });
  }
  propsOnlyStageAudit = audit;
  return picks;
}

export type StageFootballPropsOnlyOpts = {
  /** Explicit HR / SB / goals asks may fill multiple rare-family seats. */
  allowRareCountFamilyStack?: boolean;
  /** Raw ask — opens lottery / 2+ rare multi-count path when matched. */
  askText?: string | null;
  ticketStyle?: string | null;
  allowRareMultiCount?: boolean;
};

/**
 * Stage scored legs — reliability-weighted EV, one player/market, thin-slate
 * per-game raise, and same-event rare-family diversity on generic asks.
 */
export function stageFootballPropsOnlyLegs(
  scored: BoardScoredLeg[],
  target: number,
  oddsSlack: number = PROPS_ONLY_ODDS_SLACK,
  opts?: StageFootballPropsOnlyOpts,
): ParsedPick[] {
  const ordered = [...scored].sort(comparePropsOnlyLegsByReliableEv);
  const uniqueGames = new Set(
    ordered.map((l) => String(l.pick.game ?? "")).filter(Boolean),
  ).size;
  const ceiling = propsOnlyPerGameCeiling(target, uniqueGames || 1);
  const thinSlate = uniqueGames <= 1;
  const allowRare = !!opts?.allowRareCountFamilyStack;
  const seatOpts = {
    askText: opts?.askText,
    ticketStyle: opts?.ticketStyle,
    allowRareMultiCount: opts?.allowRareMultiCount,
  };
  // Start at 3 (historic props-only default); raise to ceiling when short.
  // Prefer 1× same market+side per game on multi-game boards; raise only to fill.
  let best: ParsedPick[] = [];
  let bestAudit: PropsOnlyStageAudit | null = null;
  for (let cap = Math.min(3, ceiling); cap <= ceiling; cap++) {
    const msStart = thinSlate ? cap : 1;
    for (let msCap = msStart; msCap <= cap; msCap++) {
      const staged = stageFootballPropsOnlyLegsWithCap(
        ordered,
        target,
        cap,
        msCap,
        oddsSlack,
        allowRare,
        seatOpts,
      );
      // Retry constraints can change which valid seats survive. Never replace
      // the best already-qualified ticket with a shorter retry result.
      if (staged.length > best.length) {
        best = staged;
        // Diagnostics must describe the delivered ticket, not the last
        // (possibly shorter) staging attempt.
        bestAudit = propsOnlyStageAudit;
      }
      if (best.length >= target) {
        propsOnlyStageAudit = bestAudit;
        return best;
      }
    }
  }
  propsOnlyStageAudit = bestAudit;
  return best;
}

export const stagePropsOnlyLegs = stageFootballPropsOnlyLegs;
