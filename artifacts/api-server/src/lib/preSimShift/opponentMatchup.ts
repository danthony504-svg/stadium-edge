/**
 * Opponent Matchup Shift — role/stat production vs opponent defensive profile.
 *
 * Primary (always available from already-loaded history):
 *   vsRate     = mean(vsOpponentValues)
 *   seasonRate = mean(seasonValues)
 *   rawPlayer  = vsRate / seasonRate
 *   playerMatchup = clamp(shrink(rawPlayer, n, 8), 0.90, 1.14)
 *
 * Optional defense index (opp allowed / league avg, already normalized ≈1):
 *   defenseMatchup = clamp(shrink(defenseIndex, n_def≥3 ? 12 : 0), 0.90, 1.14)
 *
 * Combine player-vs-opp and defense index with diminishing overlap
 * (same underlying matchup signal must not fully stack):
 *   logM = 0.65*log(player) + 0.35*log(defense)   when both ≠1
 *   else the non-1 factor
 *
 * QB receiving coupling (optional):
 *   passMatchup *= (1 + qbCoupling * (coupledReceiving - 1))
 *   then re-cap to [0.90, 1.14]
 *
 * Sample < 3 and no defense index → 1.0.
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
};

export function computeOpponentMatchupShift(
  input: OpponentMatchupInput,
): OpponentMatchupResult {
  const family = opportunityMarketFamily(input.market, input.sport);
  if (!isFamilyShiftAllowed(family, input.sport)) {
    return { factor: 1, sample: 0, explain: null, family, usedVsOpponent: false };
  }

  const season = filterSeriesForMarket(input.market, input.seasonValues);
  const vs = filterSeriesForMarket(input.market, input.vsOpponentValues);
  const seasonMean = meanFinite(season);
  const vsMean = meanFinite(vs);
  const rawPlayer = safeRatio(vsMean, seasonMean);

  let playerFactor = 1;
  let playerSample = vs.length;
  let usedVsOpponent = false;
  if (rawPlayer != null) {
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
  const di = input.defenseIndex;
  if (di != null && Number.isFinite(di) && di > 0) {
    // Treat defense index as observed with moderate prior weight.
    const shrunk = shrinkRatioToOne(di, 12);
    defenseFactor = clamp(
      shrunk,
      PRE_SIM_SHIFT_CAPS.matchupMin,
      PRE_SIM_SHIFT_CAPS.matchupMax,
    );
  }

  let factor = 1;
  if (playerFactor !== 1 && defenseFactor !== 1) {
    // Diminishing overlap — do not fully stack player-vs-opp with team defense.
    factor = Math.exp(0.65 * Math.log(playerFactor) + 0.35 * Math.log(defenseFactor));
  } else if (playerFactor !== 1) {
    factor = playerFactor;
  } else if (defenseFactor !== 1) {
    factor = defenseFactor;
  }

  // QB pass yards ← dampened teammate receiving matchup (role-specific, not flat WR boost).
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
    };
  }

  const parts: string[] = [];
  if (usedVsOpponent && rawPlayer != null) {
    parts.push(`vs-opp n=${playerSample} raw=${rawPlayer.toFixed(3)}`);
  }
  if (defenseFactor !== 1 && di != null) {
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
    explain: `Opponent Matchup: ${parts.join("; ")} → ×${factor.toFixed(3)}`,
  };
}

/**
 * Role-aware receiving families that may couple into QB pass production.
 * Do not boost all receivers equally — only these receiving families feed QB.
 */
export function isReceivingFamilyForQbCoupling(family: string | null): boolean {
  return (
    family === "rec_yds" ||
    family === "receptions" ||
    family === "rec_longest" ||
    family === "targets"
  );
}
