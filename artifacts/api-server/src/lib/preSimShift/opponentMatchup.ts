/**
 * Opponent Matchup Shift — role/stat production vs opponent defensive profile.
 *
 * Hierarchy (do not loosen n≥3 blindly):
 *   1. player vs opponent when n ≥ 3 (shrunk + capped)
 *   2. else defenseIndex when present (shrunk toward 1)
 *   3. else neutral 1.0
 *
 * A single prior H2H game never produces a strong multiplier by itself.
 *
 * When both player-vs-opp (n≥3) and defenseIndex are present, combine with
 * diminishing overlap:
 *   logM = 0.65·log(player) + 0.35·log(defense)
 *
 * QB receiving coupling (optional, usage-weighted upstream):
 *   passMatchup *= (1 + qbCoupling · (coupledReceiving − 1))
 *   then re-cap to [0.90, 1.14]
 */

import { opportunityMarketFamily, isFamilyShiftAllowed } from "../opportunityShift/marketFamily.js";
import { filterSeriesForMarket } from "./periodGuard.js";
import { cappedRatio, meanFinite, safeRatio, shrinkRatioToOne } from "./shrink.js";
import { PRE_SIM_SHIFT_CAPS, type OpponentMatchupInput } from "./types.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type OpponentMatchupResult = {
  factor: number;
  sample: number;
  explain: string | null;
  family: string | null;
  /** True when vsOpponent series contributed (caller should suppress soft blend). */
  usedVsOpponent: boolean;
  usedDefenseIndex: boolean;
};

export function computeOpponentMatchupShift(
  input: OpponentMatchupInput,
): OpponentMatchupResult {
  const family = opportunityMarketFamily(input.market, input.sport);
  if (!isFamilyShiftAllowed(family, input.sport)) {
    return {
      factor: 1,
      sample: 0,
      explain: null,
      family,
      usedVsOpponent: false,
      usedDefenseIndex: false,
    };
  }

  const season = filterSeriesForMarket(
    input.market,
    input.seasonValues,
    input.seasonTags,
  );
  const vs = filterSeriesForMarket(
    input.market,
    input.vsOpponentValues,
    input.vsOpponentTags,
  );
  const seasonMean = meanFinite(season);
  const vsMean = meanFinite(vs);
  const rawPlayer = safeRatio(vsMean, seasonMean);

  let playerFactor = 1;
  let playerSample = vs.length;
  let usedVsOpponent = false;
  // Hierarchy step 1: only trust player-vs-opp at n ≥ minSample.
  if (rawPlayer != null && playerSample >= PRE_SIM_SHIFT_CAPS.minSample) {
    const capped = cappedRatio(
      rawPlayer,
      playerSample,
      PRE_SIM_SHIFT_CAPS.matchupMin,
      PRE_SIM_SHIFT_CAPS.matchupMax,
    );
    playerFactor = capped.factor;
    playerSample = capped.sample;
    usedVsOpponent = playerFactor !== 1;
  }

  let defenseFactor = 1;
  let usedDefenseIndex = false;
  const di = input.defenseIndex;
  if (di != null && Number.isFinite(di) && di > 0) {
    const shrunk = shrinkRatioToOne(di, 12);
    defenseFactor = clamp(
      shrunk,
      PRE_SIM_SHIFT_CAPS.matchupMin,
      PRE_SIM_SHIFT_CAPS.matchupMax,
    );
    usedDefenseIndex = defenseFactor !== 1;
  }

  let factor = 1;
  if (playerFactor !== 1 && defenseFactor !== 1) {
    factor = Math.exp(0.65 * Math.log(playerFactor) + 0.35 * Math.log(defenseFactor));
  } else if (playerFactor !== 1) {
    factor = playerFactor;
  } else if (defenseFactor !== 1) {
    // Hierarchy step 2: defense profile when H2H unreliable.
    factor = defenseFactor;
  }

  // QB pass yards ← dampened teammate receiving matchup (usage-weighted upstream).
  const coupled = input.coupledReceivingMatchup;
  if (
    coupled != null &&
    Number.isFinite(coupled) &&
    coupled > 0 &&
    (family === "pass_yds" || family === "pass_attempts" || family === "pass_completions")
  ) {
    const w = PRE_SIM_SHIFT_CAPS.qbReceivingCoupling;
    factor *= 1 + w * (coupled - 1);
  }

  factor = clamp(factor, PRE_SIM_SHIFT_CAPS.matchupMin, PRE_SIM_SHIFT_CAPS.matchupMax);

  if (factor === 1) {
    return {
      factor: 1,
      sample: playerSample,
      explain: null,
      family,
      usedVsOpponent: false,
      usedDefenseIndex: false,
    };
  }

  const parts: string[] = [];
  if (usedVsOpponent && rawPlayer != null) {
    parts.push(`vs-opp n=${playerSample} raw=${rawPlayer.toFixed(3)}`);
  } else if (playerSample > 0 && playerSample < PRE_SIM_SHIFT_CAPS.minSample) {
    parts.push(`vs-opp n=${playerSample} ignored(<${PRE_SIM_SHIFT_CAPS.minSample})`);
  }
  if (usedDefenseIndex && di != null) {
    parts.push(`def-idx=${di.toFixed(3)}`);
  }
  if (coupled != null && Number.isFinite(coupled) && coupled !== 1) {
    parts.push(`qb←rec couple=${coupled.toFixed(3)}`);
  }

  return {
    factor,
    sample: playerSample,
    family,
    usedVsOpponent,
    usedDefenseIndex,
    explain: `Opponent Matchup: ${parts.join("; ")} → ×${factor.toFixed(3)}`,
  };
}

/**
 * Role-aware receiving families that may couple into QB pass production.
 */
export function isReceivingFamilyForQbCoupling(family: string | null): boolean {
  return (
    family === "rec_yds" ||
    family === "receptions" ||
    family === "rec_longest" ||
    family === "targets"
  );
}
