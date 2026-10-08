/**
 * Milestone E.1 — Basketball joint scoring + skill props (shadow-only).
 * NBA/WNBA: Q1–Q4 sum to FG; H1/H2 derived. NCAAB: H1+H2 = FG.
 * Separate means per sport; no football reuse.
 */

import { SIM_V2_DEEP_DRAWS, SIM_V2_SCHEMA_VERSION } from "../../version.js";
import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import {
  BASKETBALL_FG_MEAN,
  BASKETBALL_QUARTER_SHARES,
  isBasketballSport,
  type BasketballSport,
} from "./priors.js";

export const BASKETBALL_JOINT_MODEL_ID = "basketball.joint.v0" as const;
/** v0.3: mild form shrink + per-draw game shock (calibration). */
export const BASKETBALL_JOINT_MODEL_VERSION = "0.3.0" as const;
export const BASKETBALL_JOINT_MODEL_IDS = [BASKETBALL_JOINT_MODEL_ID] as const;

export type BasketballCalibrationProfile = "v0.2" | "v0.3";

export function basketballProfileLevers(profile: BasketballCalibrationProfile = "v0.3") {
  if (profile === "v0.2") {
    return {
      profile: "v0.2" as const,
      modelVersion: "0.2.0",
      shrinkWeight: 0,
      shockSigmaNba: 0,
      shockSigmaNcaab: 0,
      hfaNba: 2.4,
      hfaWnba: 2.4,
      hfaNcaab: 3.2,
    };
  }
  return {
    profile: "v0.3" as const,
    modelVersion: "0.3.0",
    shrinkWeight: 0.2,
    shockSigmaNba: 0.12,
    shockSigmaNcaab: 0.14,
    hfaNba: 2.0,
    hfaWnba: 1.8,
    hfaNcaab: 2.6,
  };
}

export type BasketballTeamInput = {
  teamId: string;
  ptsFor?: number | null;
  ptsAgainst?: number | null;
  recentFgScores?: number[];
};

export type BasketballPropPlayerInput = {
  playerId: string;
  teamSide: "home" | "away";
  usage: number;
  participateProb?: number;
};

export type JointBasketballInput = {
  sport: BasketballSport;
  eventId: string;
  seed: string;
  home: BasketballTeamInput;
  away: BasketballTeamInput;
  nDraws?: number;
  players?: BasketballPropPlayerInput[];
  /** A/B profile. Default v0.3 (corrected). v0.2 = pre-correction. */
  calibrationProfile?: BasketballCalibrationProfile;
};

function avg(vals: number[] | undefined, fallback: number): number {
  if (!vals?.length) return fallback;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function poissonSample(lambda: number, rng: () => number): number {
  const lam = Math.max(0, lambda);
  if (lam === 0) return 0;
  if (lam > 40) {
    // normal approx
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * z));
  }
  const L = Math.exp(-lam);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function tensorQ1(byPeriod: Record<string, Float64Array>, i: number): number | null {
  const q1 = byPeriod.q1;
  return q1 ? q1[i]! : null;
}

function shrinkToLeague(raw: number, league: number, weight: number): number {
  if (weight <= 0) return raw;
  return weight * league + (1 - weight) * raw;
}

function teamMean(
  sport: BasketballSport,
  team: BasketballTeamInput,
  opp: BasketballTeamInput,
  shrinkWeight: number,
): number {
  const league = BASKETBALL_FG_MEAN[sport];
  const offense = shrinkToLeague(team.ptsFor ?? avg(team.recentFgScores, league), league, shrinkWeight);
  const defense = shrinkToLeague(opp.ptsAgainst ?? league, league, shrinkWeight);
  const lo = sport === "nba" ? 90 : sport === "wnba" ? 65 : 55;
  const hi = sport === "nba" ? 140 : sport === "wnba" ? 105 : 95;
  return clamp(0.55 * offense + 0.45 * defense, lo, hi);
}

function logNormalShock(rng: () => number, sigma: number): number {
  if (sigma <= 0) return 1;
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(sigma * z - 0.5 * sigma * sigma);
}

export function buildJointBasketballTensor(input: JointBasketballInput): SimV2ScenarioTensor {
  if (!isBasketballSport(input.sport)) {
    throw new Error(`basketball_joint_sport_unsupported:${input.sport}`);
  }
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const levers = basketballProfileLevers(input.calibrationProfile ?? "v0.3");
  const hfa =
    input.sport === "ncaab"
      ? levers.hfaNcaab
      : input.sport === "wnba"
        ? levers.hfaWnba
        : levers.hfaNba;
  const homeBase = teamMean(input.sport, input.home, input.away, levers.shrinkWeight) + hfa;
  const awayBase = teamMean(input.sport, input.away, input.home, levers.shrinkWeight);
  const shockSigma = input.sport === "ncaab" ? levers.shockSigmaNcaab : levers.shockSigmaNba;
  const collegeHalves = input.sport === "ncaab";

  const homeFg = new Float64Array(n);
  const awayFg = new Float64Array(n);
  const homeByPeriod: Record<string, Float64Array> = {};
  const awayByPeriod: Record<string, Float64Array> = {};

  if (collegeHalves) {
    homeByPeriod.h1 = new Float64Array(n);
    homeByPeriod.h2 = new Float64Array(n);
    awayByPeriod.h1 = new Float64Array(n);
    awayByPeriod.h2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const homeMean = homeBase * logNormalShock(next, shockSigma);
      const awayMean = awayBase * logNormalShock(next, shockSigma);
      const hh1 = poissonSample(homeMean * 0.48, next);
      const hh2 = poissonSample(homeMean * 0.52, next);
      const ah1 = poissonSample(awayMean * 0.48, next);
      const ah2 = poissonSample(awayMean * 0.52, next);
      homeByPeriod.h1[i] = hh1;
      homeByPeriod.h2[i] = hh2;
      awayByPeriod.h1[i] = ah1;
      awayByPeriod.h2[i] = ah2;
      homeFg[i] = hh1 + hh2;
      awayFg[i] = ah1 + ah2;
    }
  } else {
    const hq = [0, 1, 2, 3].map(() => new Float64Array(n));
    const aq = [0, 1, 2, 3].map(() => new Float64Array(n));
    homeByPeriod.h1 = new Float64Array(n);
    homeByPeriod.h2 = new Float64Array(n);
    awayByPeriod.h1 = new Float64Array(n);
    awayByPeriod.h2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const homeMean = homeBase * logNormalShock(next, shockSigma);
      const awayMean = awayBase * logNormalShock(next, shockSigma);
      let hs = 0;
      let as = 0;
      for (let q = 0; q < 4; q++) {
        const h = poissonSample(homeMean * BASKETBALL_QUARTER_SHARES[q]!, next);
        const a = poissonSample(awayMean * BASKETBALL_QUARTER_SHARES[q]!, next);
        hq[q]![i] = h;
        aq[q]![i] = a;
        hs += h;
        as += a;
      }
      homeFg[i] = hs;
      awayFg[i] = as;
      homeByPeriod.h1[i] = hq[0]![i]! + hq[1]![i]!;
      homeByPeriod.h2[i] = hq[2]![i]! + hq[3]![i]!;
      awayByPeriod.h1[i] = aq[0]![i]! + aq[1]![i]!;
      awayByPeriod.h2[i] = aq[2]![i]! + aq[3]![i]!;
    }
    homeByPeriod.q1 = hq[0]!;
    homeByPeriod.q2 = hq[1]!;
    homeByPeriod.q3 = hq[2]!;
    homeByPeriod.q4 = hq[3]!;
    awayByPeriod.q1 = aq[0]!;
    awayByPeriod.q2 = aq[1]!;
    awayByPeriod.q3 = aq[2]!;
    awayByPeriod.q4 = aq[3]!;
  }

  const players: SimV2ScenarioTensor["players"] = {};
  const playerStatKeys = [
    "points",
    "rebounds",
    "assists",
    "threes",
    "pra",
    "pr",
    "pa",
    "ra",
    "points_q1",
  ];
  for (const pl of input.players ?? []) {
    const usage = clamp(pl.usage, 0, 1);
    const partP = clamp(pl.participateProb ?? 0.9, 0, 1);
    const participated = new Uint8Array(n);
    const points = new Float64Array(n);
    const rebounds = new Float64Array(n);
    const assists = new Float64Array(n);
    const threes = new Float64Array(n);
    const pra = new Float64Array(n);
    const pr = new Float64Array(n);
    const pa = new Float64Array(n);
    const ra = new Float64Array(n);
    const pointsQ1 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const inGame = next() < partP ? 1 : 0;
      participated[i] = inGame;
      if (!inGame) continue;
      const teamPts = pl.teamSide === "home" ? homeFg[i]! : awayFg[i]!;
      const q1 =
        pl.teamSide === "home"
          ? (tensorQ1(homeByPeriod, i) ?? teamPts * 0.24)
          : (tensorQ1(awayByPeriod, i) ?? teamPts * 0.24);
      points[i] = poissonSample(teamPts * usage * 0.22, next);
      rebounds[i] = poissonSample(4 + usage * 6, next);
      assists[i] = poissonSample(2 + usage * 5, next);
      threes[i] = poissonSample(usage * 2.4, next);
      pra[i] = points[i]! + rebounds[i]! + assists[i]!;
      pr[i] = points[i]! + rebounds[i]!;
      pa[i] = points[i]! + assists[i]!;
      ra[i] = rebounds[i]! + assists[i]!;
      pointsQ1[i] = poissonSample(Math.max(0, q1) * usage * 0.22, next);
    }
    players[pl.playerId] = {
      participated,
      stats: {
        points,
        rebounds,
        assists,
        threes,
        pra,
        pr,
        pa,
        ra,
        points_q1: pointsQ1,
      },
    };
  }

  const createdAt = new Date().toISOString();
  const dataFingerprint = fingerprintPayload([
    BASKETBALL_JOINT_MODEL_ID,
    levers.modelVersion,
    input.sport,
    input,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId: BASKETBALL_JOINT_MODEL_ID,
      modelVersion: levers.modelVersion,
      sport: input.sport,
      eventId: input.eventId,
      nDraws: n,
      seed: input.seed,
      dataFingerprint,
      createdAt,
      isFixture: false,
      quality: {
        status: "pass",
        missingFields: [],
        warnings: [
          "basketball_v0_shadow_only",
          "not_accepted_for_production_serve",
          `sport_params:${input.sport}`,
        ],
        participationReady: (input.players?.length ?? 0) > 0,
        oddsReady: true,
      },
      periodsPresent: collegeHalves
        ? ["fg", "h1", "h2"]
        : ["fg", "q1", "q2", "q3", "q4", "h1", "h2"],
      playerStatKeys: (input.players?.length ?? 0) > 0 ? playerStatKeys : [],
      provenance: [
        {
          provider: "historical_team_form",
          fetchedAt: createdAt,
          rawHash: dataFingerprint.slice(0, 16),
        },
      ],
    },
    team: { homeFg, awayFg, homeByPeriod, awayByPeriod },
    players,
  };
}
