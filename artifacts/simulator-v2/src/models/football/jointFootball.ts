/**
 * Phase B joint NFL/NCAAF scenario generator.
 *
 * One draw produces Q1–Q4, H1/H2, and FG scores with exact conservation:
 *   FG = Q1+Q2+Q3+Q4 = H1+H2
 *   H1 = Q1+Q2, H2 = Q3+Q4
 *
 * Variants:
 *   - phase_b_v0: original thin-tailed Poisson (for A/B comparison)
 *   - phase_b_correct: HFA + gamma–Poisson overdispersion + margin/blowout shocks
 *     (train-frozen knobs; shadow-only)
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
import { FROZEN_TRAIN_PARAMS } from "./trainFrozenParams.js";

export type FootballModelVariant = "phase_b_v0" | "phase_b_correct";

export const FOOTBALL_JOINT_MODEL_ID_V0 = "football.joint.phase_b" as const;
export const FOOTBALL_JOINT_MODEL_ID = "football.joint.phase_b_correct" as const;
export const FOOTBALL_JOINT_MODEL_VERSION = "0.3.0" as const;
export const FOOTBALL_JOINT_MODEL_VERSION_V0 = "0.2.0" as const;

export const FOOTBALL_JOINT_MODEL_IDS = [
  FOOTBALL_JOINT_MODEL_ID,
  FOOTBALL_JOINT_MODEL_ID_V0,
] as const;

export type FootballTeamInput = {
  teamId: string;
  scoredByQuarter?: [number, number, number, number] | null;
  allowedByQuarter?: [number, number, number, number] | null;
  ptsFor?: number | null;
  ptsAgainst?: number | null;
  recentFgScores?: number[];
};

export type JointFootballInput = {
  sport: FootballSport;
  eventId: string;
  seed: string;
  home: FootballTeamInput;
  away: FootballTeamInput;
  nDraws?: number;
  paceImpact?: number | null;
  provenanceProviders?: string[];
  /** Default: phase_b_correct. */
  variant?: FootballModelVariant;
};

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalSample(rng: () => number, mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

/** Knuth Poisson; normal approx for large λ. */
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

/**
 * Gamma(shape, scale) with mean = shape*scale.
 * Marsaglia–Tsang for shape ≥ 1; boost for shape < 1.
 */
export function gammaSample(shape: number, scale: number, rng: () => number): number {
  if (!(shape > 0) || !(scale > 0)) return 0;
  if (shape < 1) {
    const g = gammaSample(shape + 1, scale, rng);
    return g * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normalSample(rng, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** Mean-1 gamma with variance 1/shape. */
function gammaMean1(shape: number, rng: () => number): number {
  const a = Math.max(0.5, shape);
  return gammaSample(a, 1 / a, rng);
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
 * Per-quarter expected points for offense vs defense.
 * Optional home-field points are applied by the caller on the home side only.
 */
export function quarterMeansForSide(
  offense: FootballTeamInput,
  defense: FootballTeamInput,
  sport: FootballSport,
  opts?: { homeFieldBonus?: number },
): [number, number, number, number] {
  const shares = LEAGUE_QUARTER_SHARES[sport];
  const fgMean = teamFgMean(offense, defense, sport) + (opts?.homeFieldBonus ?? 0);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const scored = offense.scoredByQuarter?.[q];
    const allowed = defense.allowedByQuarter?.[q];
    const parts = [scored, allowed].filter(
      (v): v is number => v != null && Number.isFinite(v) && v >= 0,
    );
    if (parts.length) {
      const base = parts.reduce((a, b) => a + b, 0) / parts.length;
      // Distribute HFA across quarters by league share when bonus provided via fgMean path only
      // when falling back; when parts exist, add share of bonus.
      const bonus = (opts?.homeFieldBonus ?? 0) * shares[q];
      out[q] = Math.max(0.05, base + (parts.length ? bonus : 0));
    } else {
      out[q] = Math.max(0.05, fgMean * shares[q]);
    }
  }
  return out;
}

function teamRelVol(
  team: FootballTeamInput,
  opp: FootballTeamInput,
  sport: FootballSport,
  floor: number,
  ceil: number,
): number {
  const mean = Math.max(1, teamFgMean(team, opp, sport));
  if (!team.recentFgScores || team.recentFgScores.length < 2) {
    return clamp(QUARTER_PACE_SIGMA[sport], floor, ceil);
  }
  const m = avg(team.recentFgScores);
  const v =
    team.recentFgScores.reduce((a, x) => a + (x - m) ** 2, 0) /
    Math.max(1, team.recentFgScores.length - 1);
  return clamp(Math.sqrt(v) / mean, floor, ceil);
}

function emptyPeriodArrays(n: number) {
  return {
    homeFg: new Float64Array(n),
    awayFg: new Float64Array(n),
    homeQ: [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)] as const,
    awayQ: [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)] as const,
    homeH1: new Float64Array(n),
    homeH2: new Float64Array(n),
    awayH1: new Float64Array(n),
    awayH2: new Float64Array(n),
  };
}

function finalizeDraw(
  arr: ReturnType<typeof emptyPeriodArrays>,
  i: number,
  hq: readonly [number, number, number, number],
  aq: readonly [number, number, number, number],
): void {
  for (let q = 0; q < 4; q++) {
    arr.homeQ[q][i] = hq[q]!;
    arr.awayQ[q][i] = aq[q]!;
  }
  arr.homeH1[i] = hq[0] + hq[1];
  arr.homeH2[i] = hq[2] + hq[3];
  arr.awayH1[i] = aq[0] + aq[1];
  arr.awayH2[i] = aq[2] + aq[3];
  arr.homeFg[i] = arr.homeH1[i] + arr.homeH2[i];
  arr.awayFg[i] = arr.awayH1[i] + arr.awayH2[i];
}

function simulateV0(
  homeQ: [number, number, number, number],
  awayQ: [number, number, number, number],
  sport: FootballSport,
  home: FootballTeamInput,
  away: FootballTeamInput,
  paceMul: number,
  next: () => number,
  n: number,
): ReturnType<typeof emptyPeriodArrays> {
  const arr = emptyPeriodArrays(n);
  const paceSigma = QUARTER_PACE_SIGMA[sport];
  const homeVol =
    home.recentFgScores && home.recentFgScores.length >= 2
      ? Math.sqrt(
          home.recentFgScores.reduce((a, x) => a + (x - avg(home.recentFgScores!)) ** 2, 0) /
            Math.max(1, home.recentFgScores.length - 1),
        ) / Math.max(1, teamFgMean(home, away, sport))
      : paceSigma;
  const awayVol =
    away.recentFgScores && away.recentFgScores.length >= 2
      ? Math.sqrt(
          away.recentFgScores.reduce((a, x) => a + (x - avg(away.recentFgScores!)) ** 2, 0) /
            Math.max(1, away.recentFgScores.length - 1),
        ) / Math.max(1, teamFgMean(away, home, sport))
      : paceSigma;

  for (let i = 0; i < n; i++) {
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
    finalizeDraw(arr, i, hq, aq);
  }
  return arr;
}

function simulateCorrect(
  homeQ: [number, number, number, number],
  awayQ: [number, number, number, number],
  sport: FootballSport,
  home: FootballTeamInput,
  away: FootballTeamInput,
  paceMul: number,
  next: () => number,
  n: number,
): ReturnType<typeof emptyPeriodArrays> {
  const p = FROZEN_TRAIN_PARAMS[sport];
  const arr = emptyPeriodArrays(n);
  const homeVol = teamRelVol(home, away, sport, p.teamVolFloor, p.teamVolCeil);
  const awayVol = teamRelVol(away, home, sport, p.teamVolFloor, p.teamVolCeil);
  // Map relative vol into gamma shape: higher vol ⇒ lower shape.
  const homeTeamShape = clamp(p.teamGammaShape / (1 + 3 * homeVol), 2, 40);
  const awayTeamShape = clamp(p.teamGammaShape / (1 + 3 * awayVol), 2, 40);

  for (let i = 0; i < n; i++) {
    const gameG = gammaMean1(p.gameGammaShape, next);
    const homeG = gammaMean1(homeTeamShape, next);
    const awayG = gammaMean1(awayTeamShape, next);
    const blowout = next() < p.blowoutProb;
    const marginZ = normalSample(
      next,
      0,
      blowout ? p.blowoutMarginShockSd : p.marginShockSd,
    );
    // Log-margin shock with sum-normalization so E[homeλ+awayλ] is not inflated by Jensen.
    const rawH = Math.exp(clamp(marginZ * 0.5, -1.0, 1.0));
    const rawA = Math.exp(clamp(-marginZ * 0.5, -1.0, 1.0));
    const norm = 2 / (rawH + rawA);
    const homeMarginMul = rawH * norm;
    const awayMarginMul = rawA * norm;

    const hq: [number, number, number, number] = [0, 0, 0, 0];
    const aq: [number, number, number, number] = [0, 0, 0, 0];
    for (let q = 0; q < 4; q++) {
      const qHomeG = gammaMean1(p.quarterGammaShape, next);
      const qAwayG = gammaMean1(p.quarterGammaShape, next);
      const hLam = homeQ[q]! * paceMul * gameG * homeG * homeMarginMul * qHomeG;
      const aLam = awayQ[q]! * paceMul * gameG * awayG * awayMarginMul * qAwayG;
      hq[q] = poissonSample(hLam, next);
      aq[q] = poissonSample(aLam, next);
    }
    finalizeDraw(arr, i, hq, aq);
  }
  return arr;
}

export function buildJointFootballTensor(input: JointFootballInput): SimV2ScenarioTensor {
  if (!isFootballSport(input.sport)) {
    throw new Error(`football_joint_sport_unsupported:${input.sport}`);
  }
  const variant: FootballModelVariant = input.variant ?? "phase_b_correct";
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);

  const hfa = variant === "phase_b_correct" ? FROZEN_TRAIN_PARAMS[input.sport].homeFieldAdvantage : 0;
  const homeQ = quarterMeansForSide(input.home, input.away, input.sport, {
    homeFieldBonus: hfa,
  });
  const awayQ = quarterMeansForSide(input.away, input.home, input.sport);

  let paceMul = 1;
  if (input.paceImpact != null && Number.isFinite(input.paceImpact)) {
    paceMul = 1 + clamp(input.paceImpact, -1, 1) * 0.06;
  }

  const arr =
    variant === "phase_b_correct"
      ? simulateCorrect(homeQ, awayQ, input.sport, input.home, input.away, paceMul, next, n)
      : simulateV0(homeQ, awayQ, input.sport, input.home, input.away, paceMul, next, n);

  const modelId = variant === "phase_b_correct" ? FOOTBALL_JOINT_MODEL_ID : FOOTBALL_JOINT_MODEL_ID_V0;
  const modelVersion =
    variant === "phase_b_correct" ? FOOTBALL_JOINT_MODEL_VERSION : FOOTBALL_JOINT_MODEL_VERSION_V0;

  const createdAt = new Date().toISOString();
  const providers = input.provenanceProviders?.length
    ? input.provenanceProviders
    : variant === "phase_b_correct"
      ? ["historical_team_form", "train_frozen_params", "league_priors"]
      : ["historical_team_form", "league_priors"];
  const dataFingerprint = fingerprintPayload([
    modelId,
    modelVersion,
    variant,
    input.sport,
    input.eventId,
    input.seed,
    n,
    homeQ,
    awayQ,
    input.home,
    input.away,
    input.paceImpact ?? null,
    variant === "phase_b_correct" ? FROZEN_TRAIN_PARAMS[input.sport] : null,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId,
      modelVersion,
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
          variant === "phase_b_correct" ? "phase_b_correct_train_frozen" : "phase_b_v0_unadjusted",
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
      homeFg: arr.homeFg,
      awayFg: arr.awayFg,
      homeByPeriod: {
        q1: arr.homeQ[0],
        q2: arr.homeQ[1],
        q3: arr.homeQ[2],
        q4: arr.homeQ[3],
        h1: arr.homeH1,
        h2: arr.homeH2,
      },
      awayByPeriod: {
        q1: arr.awayQ[0],
        q2: arr.awayQ[1],
        q3: arr.awayQ[2],
        q4: arr.awayQ[3],
        h1: arr.awayH1,
        h2: arr.awayH2,
      },
    },
    players: {},
  };
}

/** Convenience: original thin-tailed model. */
export function buildJointFootballTensorV0(
  input: Omit<JointFootballInput, "variant">,
): SimV2ScenarioTensor {
  return buildJointFootballTensor({ ...input, variant: "phase_b_v0" });
}

export function summarizeJointFootballTensor(tensor: SimV2ScenarioTensor): {
  homeFgMean: number;
  awayFgMean: number;
  homeQuarterMeans: number[];
  awayQuarterMeans: number[];
  totalFgMean: number;
  totalFgVar: number;
  marginMean: number;
  marginVar: number;
} {
  const n = tensor.meta.nDraws;
  const mean = (a: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i]!;
    return s / n;
  };
  const variance = (a: Float64Array, m: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i]! - m) ** 2;
    return s / Math.max(1, n - 1);
  };
  const hq = ["q1", "q2", "q3", "q4"].map((p) => mean(tensor.team.homeByPeriod[p]!));
  const aq = ["q1", "q2", "q3", "q4"].map((p) => mean(tensor.team.awayByPeriod[p]!));
  const homeFgMean = mean(tensor.team.homeFg);
  const awayFgMean = mean(tensor.team.awayFg);
  const totals = new Float64Array(n);
  const margins = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    totals[i] = tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
    margins[i] = tensor.team.homeFg[i]! - tensor.team.awayFg[i]!;
  }
  const totalFgMean = mean(totals);
  const marginMean = mean(margins);
  return {
    homeFgMean,
    awayFgMean,
    homeQuarterMeans: hq,
    awayQuarterMeans: aq,
    totalFgMean,
    totalFgVar: variance(totals, totalFgMean),
    marginMean,
    marginVar: variance(margins, marginMean),
  };
}
