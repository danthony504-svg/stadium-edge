/**
 * Sport-specific generative knobs frozen from chronological TRAINING folds only.
 * NFL train = 2022 eligible; NCAAF train = 2023 eligible.
 * Never re-estimated on validation or final holdout.
 *
 * Retuned on train after first correct-model pass showed var ratio ≫ 1 from
 * uncentered log-margin shocks; holdout was not used for this retune.
 */

import type { FootballSport } from "./priors.js";

export type FrozenFootballParams = {
  /** Residual home-field advantage (points added to home FG expectation). */
  homeFieldAdvantage: number;
  trainTotalMean: number;
  trainTotalVar: number;
  trainMarginSd: number;
  nTrainGames: number;
  trainSeasonLabel: string;
  /**
   * Shared game gamma shape (mean 1). Lower ⇒ heavier total overdispersion.
   */
  gameGammaShape: number;
  teamGammaShape: number;
  quarterGammaShape: number;
  /** Log-space margin shock SD (then sum-normalized across home/away). */
  marginShockSd: number;
  blowoutProb: number;
  blowoutMarginShockSd: number;
  teamVolFloor: number;
  teamVolCeil: number;
};

export const FROZEN_TRAIN_PARAMS: Record<FootballSport, FrozenFootballParams> = {
  nfl: {
    homeFieldAdvantage: 2.55,
    trainTotalMean: 44.08,
    trainTotalVar: 188.6,
    trainMarginSd: 12.73,
    nTrainGames: 220,
    trainSeasonLabel: "2022",
    // Train-only retune targeting MC/actual FG var ratio ≈ 1.0–1.3.
    gameGammaShape: 22,
    teamGammaShape: 24,
    quarterGammaShape: 30,
    marginShockSd: 0.22,
    blowoutProb: 0.05,
    blowoutMarginShockSd: 0.55,
    teamVolFloor: 0.08,
    teamVolCeil: 0.4,
  },
  ncaaf: {
    homeFieldAdvantage: 2.87,
    trainTotalMean: 53.55,
    trainTotalVar: 301.3,
    trainMarginSd: 19.79,
    nTrainGames: 531,
    trainSeasonLabel: "2023",
    gameGammaShape: 28,
    teamGammaShape: 28,
    quarterGammaShape: 32,
    marginShockSd: 0.24,
    blowoutProb: 0.05,
    blowoutMarginShockSd: 0.6,
    teamVolFloor: 0.1,
    teamVolCeil: 0.5,
  },
};
