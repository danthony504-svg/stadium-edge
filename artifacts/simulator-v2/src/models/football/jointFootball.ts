/**
 * Phase B joint NFL/NCAAF scenario generator.
 *
 * One draw produces Q1–Q4, H1/H2, and FG scores with exact conservation:
 *   FG = Q1+Q2+Q3+Q4 = H1+H2
 *   H1 = Q1+Q2, H2 = Q3+Q4
 *
 * Periods are the generative process — never an independent overwrite of FG.
 * Shadow-only: tensors are not production-served under default flags.
 */

import {
  SIM_V2_DEEP_DRAWS,
  SIM_V2_SCHEMA_VERSION,
} from "../../version.js";
import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import {
  LEAGUE_FG_MEAN,
  LEAGUE_QUARTER_SHARES,
  QUARTER_PACE_SIGMA,
  type FootballSport,
  isFootballSport,
} from "./priors.js";

export const FOOTBALL_JOINT_MODEL_ID = "football.joint.phase_b" as const;
export const FOOTBALL_JOINT_MODEL_VERSION = "0.2.0" as const;

export type FootballTeamInput = {
  teamId: string;
  /** Historical mean points scored by quarter (Q1..Q4). */
  scoredByQuarter?: [number, number, number, number] | null;
  /** Historical mean points allowed by quarter. */
  allowedByQuarter?: [number, number, number, number] | null;
  /** Full-game pts for (fallback when quarter history missing). */
  ptsFor?: number | null;
  /** Full-game pts against (fallback). */
  ptsAgainst?: number | null;
  /** Recent full-game scores for volatility. */
  recentFgScores?: number[];
};

export type JointFootballInput = {
  sport: FootballSport;
  eventId: string;
  seed: string;
  home: FootballTeamInput;
  away: FootballTeamInput;
  nDraws?: number;
  /** Optional weather / pace scalar in [-1, 1] applied to both teams. */
  paceImpact?: number | null;
  /** Provenance labels for dataFingerprint / audit. */
  provenanceProviders?: string[];
};

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Box–Muller normal using seeded RNG. */
function normalSample(rng: () => number, mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

/** Knuth Poisson for λ; normal approx for larger λ. Seeded. */
export function poissonSample(lambda: number, rng: () => number): number {
  const lam = Math.max(0, lambda);
  if (lam === 0) return 0;
  if (lam > 30) {
    return Math.max(0, Math.round(normalSample(rng, lam, Math.sqrt(lam))));
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

function teamFgMean(team: FootballTeamInput, opp: FootballTeamInput, sport: FootballSport): number {
  const parts = [team.ptsFor, opp.ptsAgainst].filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0,
  );
  if (parts.length) return parts.reduce((a, b) => a + b, 0) / parts.length;
  if (team.scoredByQuarter) {
    return team.scoredByQuarter.reduce((a, b) => a + b, 0);
  }
  return LEAGUE_FG_MEAN[sport];
}

/**
 * Per-quarter expected points for `offense` vs `defense` (opponent).
 * Blend own period scored with opp period allowed when both exist.
 */
export function quarterMeansForSide(
  offense: FootballTeamInput,
  defense: FootballTeamInput,
  sport: FootballSport,
): [number, number, number, number] {
  const shares = LEAGUE_QUARTER_SHARES[sport];
  const fgMean = teamFgMean(offense, defense, sport);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const scored = offense.scoredByQuarter?.[q];
    const allowed = defense.allowedByQuarter?.[q];
    const parts = [scored, allowed].filter(
      (v): v is number => v != null && Number.isFinite(v) && v >= 0,
    );
    if (parts.length) {
      out[q] = parts.reduce((a, b) => a + b, 0) / parts.length;
    } else {
      out[q] = Math.max(0.05, fgMean * shares[q]);
    }
  }
  return out;
}

export function buildJointFootballTensor(input: JointFootballInput): SimV2ScenarioTensor {
  if (!isFootballSport(input.sport)) {
    throw new Error(`football_joint_sport_unsupported:${input.sport}`);
  }
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const homeQ = quarterMeansForSide(input.home, input.away, input.sport);
  const awayQ = quarterMeansForSide(input.away, input.home, input.sport);

  let paceMul = 1;
  if (input.paceImpact != null && Number.isFinite(input.paceImpact)) {
    paceMul = 1 + clamp(input.paceImpact, -1, 1) * 0.06;
  }

  const homeFg = new Float64Array(n);
  const awayFg = new Float64Array(n);
  const homeQ1 = new Float64Array(n);
  const homeQ2 = new Float64Array(n);
  const homeQ3 = new Float64Array(n);
  const homeQ4 = new Float64Array(n);
  const awayQ1 = new Float64Array(n);
  const awayQ2 = new Float64Array(n);
  const awayQ3 = new Float64Array(n);
  const awayQ4 = new Float64Array(n);
  const homeH1 = new Float64Array(n);
  const homeH2 = new Float64Array(n);
  const awayH1 = new Float64Array(n);
  const awayH2 = new Float64Array(n);

  const paceSigma = QUARTER_PACE_SIGMA[input.sport];
  const homeVol =
    input.home.recentFgScores && input.home.recentFgScores.length >= 2
      ? Math.sqrt(
          input.home.recentFgScores.reduce((a, x) => a + (x - avg(input.home.recentFgScores!)) ** 2, 0) /
            Math.max(1, input.home.recentFgScores.length - 1),
        ) / Math.max(1, teamFgMean(input.home, input.away, input.sport))
      : paceSigma;
  const awayVol =
    input.away.recentFgScores && input.away.recentFgScores.length >= 2
      ? Math.sqrt(
          input.away.recentFgScores.reduce((a, x) => a + (x - avg(input.away.recentFgScores!)) ** 2, 0) /
            Math.max(1, input.away.recentFgScores.length - 1),
        ) / Math.max(1, teamFgMean(input.away, input.home, input.sport))
      : paceSigma;

  for (let i = 0; i < n; i++) {
    // Shared game pace factor — correlates quarters without breaking conservation.
    const gamePace = Math.exp(clamp(normalSample(next, 0, paceSigma), -0.45, 0.45));
    const homePace = gamePace * Math.exp(clamp(normalSample(next, 0, homeVol * 0.5), -0.35, 0.35));
    const awayPace = gamePace * Math.exp(clamp(normalSample(next, 0, awayVol * 0.5), -0.35, 0.35));

    const hq = [
      poissonSample(homeQ[0] * paceMul * homePace, next),
      poissonSample(homeQ[1] * paceMul * homePace, next),
      poissonSample(homeQ[2] * paceMul * homePace, next),
      poissonSample(homeQ[3] * paceMul * homePace, next),
    ] as const;
    const aq = [
      poissonSample(awayQ[0] * paceMul * awayPace, next),
      poissonSample(awayQ[1] * paceMul * awayPace, next),
      poissonSample(awayQ[2] * paceMul * awayPace, next),
      poissonSample(awayQ[3] * paceMul * awayPace, next),
    ] as const;

    homeQ1[i] = hq[0];
    homeQ2[i] = hq[1];
    homeQ3[i] = hq[2];
    homeQ4[i] = hq[3];
    awayQ1[i] = aq[0];
    awayQ2[i] = aq[1];
    awayQ3[i] = aq[2];
    awayQ4[i] = aq[3];

    homeH1[i] = hq[0] + hq[1];
    homeH2[i] = hq[2] + hq[3];
    awayH1[i] = aq[0] + aq[1];
    awayH2[i] = aq[2] + aq[3];
    homeFg[i] = homeH1[i] + homeH2[i];
    awayFg[i] = awayH1[i] + awayH2[i];
  }

  const createdAt = new Date().toISOString();
  const providers = input.provenanceProviders?.length
    ? input.provenanceProviders
    : ["historical_team_form", "league_priors"];
  const dataFingerprint = fingerprintPayload([
    FOOTBALL_JOINT_MODEL_ID,
    FOOTBALL_JOINT_MODEL_VERSION,
    input.sport,
    input.eventId,
    input.seed,
    n,
    homeQ,
    awayQ,
    input.home,
    input.away,
    input.paceImpact ?? null,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId: FOOTBALL_JOINT_MODEL_ID,
      modelVersion: FOOTBALL_JOINT_MODEL_VERSION,
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
          "phase_b_shadow_only",
          "not_accepted_for_production_serve",
          "calibration_gates_required_before_p0_lift",
        ],
        participationReady: false,
        oddsReady: true,
      },
      periodsPresent: ["fg", "q1", "q2", "q3", "q4", "h1", "h2"],
      playerStatKeys: [],
      provenance: providers.map((provider) => ({
        provider,
        fetchedAt: createdAt,
        rawHash: dataFingerprint.slice(0, 16),
      })),
    },
    team: {
      homeFg,
      awayFg,
      homeByPeriod: {
        q1: homeQ1,
        q2: homeQ2,
        q3: homeQ3,
        q4: homeQ4,
        h1: homeH1,
        h2: homeH2,
      },
      awayByPeriod: {
        q1: awayQ1,
        q2: awayQ2,
        q3: awayQ3,
        q4: awayQ4,
        h1: awayH1,
        h2: awayH2,
      },
    },
    players: {},
  };
}

/** Mean FG / period scores across draws (diagnostics). */
export function summarizeJointFootballTensor(tensor: SimV2ScenarioTensor): {
  homeFgMean: number;
  awayFgMean: number;
  homeQuarterMeans: number[];
  awayQuarterMeans: number[];
  totalFgMean: number;
} {
  const n = tensor.meta.nDraws;
  const mean = (arr: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += arr[i];
    return s / n;
  };
  const hq = ["q1", "q2", "q3", "q4"].map((p) => mean(tensor.team.homeByPeriod[p]!));
  const aq = ["q1", "q2", "q3", "q4"].map((p) => mean(tensor.team.awayByPeriod[p]!));
  const homeFgMean = mean(tensor.team.homeFg);
  const awayFgMean = mean(tensor.team.awayFg);
  return {
    homeFgMean,
    awayFgMean,
    homeQuarterMeans: hq,
    awayQuarterMeans: aq,
    totalFgMean: homeFgMean + awayFgMean,
  };
}
