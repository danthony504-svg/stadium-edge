/**
 * Milestone F.1 / F.5 — MLB joint runs model (shadow-only).
 * Samples 9 inning run vectors; F5 = sum(i1..i5); FG = sum(i1..i9).
 * Guarantees F5 ≤ FG on every draw. No football reuse.
 *
 * calibrationProfile:
 *   - "v0.2" pre-correction: no shrink, no lognormal shock, HFA 0.1
 *   - "v0.3" aggressive correction: shrink 0.4, σ0.18 shock, HFA 0.05
 *     (A/B ECE↓ but VAL ML separation↓ / holdout shrink-to-50 — not accepted for ml/team_total)
 *   - "v0.3.1" prior default: less shrink / more variance (Option B)
 *   - "v0.3.2" candidate: strength-preserving form (less shrink + raw blend +
 *     recent residual) — promote to default only if holdout ML ECE improves
 *     without shrink-to-50 and without Brier/LL regression vs v0.3.1
 */

import { SIM_V2_DEEP_DRAWS, SIM_V2_SCHEMA_VERSION } from "../../version.js";
import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { MLB_TEAM_FG_MEAN, isBaseballSport, type BaseballSport } from "./priors.js";

export const BASEBALL_JOINT_MODEL_ID = "baseball.joint.v0" as const;
/**
 * Default published version string. Starts as v0.3.1; F.5 acceptance may
 * promote to 0.3.2 when holdout ML criteria clear (see runMlbF5Acceptance).
 * Keep in sync with baseballProfileLevers() default + package.json version.
 */
export const BASEBALL_JOINT_MODEL_VERSION = "0.3.1" as const;
export const BASEBALL_JOINT_MODEL_IDS = [BASEBALL_JOINT_MODEL_ID] as const;

export type BaseballCalibrationProfile = "v0.2" | "v0.3" | "v0.3.1" | "v0.3.2";

export type BaseballProfileLevers = {
  profile: BaseballCalibrationProfile;
  modelVersion: string;
  shrinkWeight: number;
  gameShockSigma: number;
  homeEdge: number;
  /**
   * Blend weight toward unshrunk season rates (between-game strength preserve).
   * 0 = fully use shrunk rates; 1 = fully use raw rates.
   */
  strengthPreserve: number;
  /** Weight on (recent − season) residual, clamped ±0.5 runs. */
  formResidualWeight: number;
};

/**
 * Profile levers. Default remains v0.3.1 until F.5 holdout promotion of v0.3.2.
 * v0.3.2 (VAL-informed): less shrink + strengthPreserve raw blend + mild recent
 * residual — restores between-game discrimination without shrink-to-50.
 * Tuned on VAL only; holdout applied once in runMlbF5Acceptance.
 */
export function baseballProfileLevers(
  profile: BaseballCalibrationProfile = "v0.3.1",
): BaseballProfileLevers {
  if (profile === "v0.2") {
    return {
      profile: "v0.2",
      modelVersion: "0.2.0",
      shrinkWeight: 0,
      gameShockSigma: 0,
      homeEdge: 0.1,
      strengthPreserve: 0,
      formResidualWeight: 0,
    };
  }
  if (profile === "v0.3") {
    return {
      profile: "v0.3",
      modelVersion: "0.3.0",
      shrinkWeight: 0.4,
      gameShockSigma: 0.18,
      homeEdge: 0.05,
      strengthPreserve: 0,
      formResidualWeight: 0,
    };
  }
  if (profile === "v0.3.2") {
    return {
      profile: "v0.3.2",
      modelVersion: "0.3.2",
      shrinkWeight: 0.1,
      gameShockSigma: 0.24,
      homeEdge: 0.08,
      strengthPreserve: 0.45,
      formResidualWeight: 0.3,
    };
  }
  return {
    profile: "v0.3.1",
    modelVersion: "0.3.1",
    shrinkWeight: 0.2,
    gameShockSigma: 0.22,
    homeEdge: 0.07,
    strengthPreserve: 0,
    formResidualWeight: 0,
  };
}

/** Shrink noisy recent form toward league mean — primary ECE fix alongside game shock. */
function shrinkToLeague(raw: number, league: number, weight: number): number {
  if (weight <= 0) return raw;
  return weight * league + (1 - weight) * raw;
}

/** Box-Muller then exp — per-draw multiplicative shock (underdispersion fix). */
function logNormalShock(rng: () => number, sigma: number): number {
  if (sigma <= 0) return 1;
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(sigma * z - 0.5 * sigma * sigma);
}

export type BaseballTeamInput = {
  teamId: string;
  runsFor?: number | null;
  runsAgainst?: number | null;
  recentFgRuns?: number[];
};

export type BaseballPropPlayerInput = {
  playerId: string;
  teamSide: "home" | "away";
  kind: "batter" | "pitcher";
  usage: number;
  participateProb?: number;
  /** Confirmed starter / batting order slot (1–9). OUT when null and required. */
  battingOrder?: number | null;
  confirmedStarter?: boolean;
  /** Opponent pitcher K rate proxy for matchup (pitcher K / 9 IP scale). */
  oppPitcherKPer9?: number | null;
};

export type JointBaseballInput = {
  sport: BaseballSport;
  eventId: string;
  seed: string;
  home: BaseballTeamInput;
  away: BaseballTeamInput;
  nDraws?: number;
  players?: BaseballPropPlayerInput[];
  /**
   * A/B calibration profile. Default "v0.3.1" until F.5 promotes v0.3.2.
   * "v0.2" = pre-correction; "v0.3" = aggressive shrink; "v0.3.2" = strength-preserve.
   */
  calibrationProfile?: BaseballCalibrationProfile;
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
 * Team FG mean runs. v0.3.2 preserves between-game strength via strengthPreserve
 * (blend toward unshrunk season rates) and a capped recent-form residual.
 */
function teamMean(
  team: BaseballTeamInput,
  opp: BaseballTeamInput,
  levers: BaseballProfileLevers,
): number {
  const rawOff = team.runsFor ?? avg(team.recentFgRuns, MLB_TEAM_FG_MEAN);
  const rawDef = opp.runsAgainst ?? MLB_TEAM_FG_MEAN;
  const shrunkOff = shrinkToLeague(rawOff, MLB_TEAM_FG_MEAN, levers.shrinkWeight);
  const shrunkDef = shrinkToLeague(rawDef, MLB_TEAM_FG_MEAN, levers.shrinkWeight);
  const sp = clamp(levers.strengthPreserve, 0, 1);
  const offense = (1 - sp) * shrunkOff + sp * rawOff;
  const defense = (1 - sp) * shrunkDef + sp * rawDef;
  let mean = 0.55 * offense + 0.45 * defense;
  if (levers.formResidualWeight > 0 && team.recentFgRuns?.length) {
    const recent = avg(team.recentFgRuns, rawOff);
    mean += clamp((recent - rawOff) * levers.formResidualWeight, -0.5, 0.5);
  }
  return clamp(mean, 2.0, 7.5);
}

export function buildJointBaseballTensor(input: JointBaseballInput): SimV2ScenarioTensor {
  if (!isBaseballSport(input.sport)) {
    throw new Error(`baseball_joint_sport_unsupported:${input.sport}`);
  }
  const levers = baseballProfileLevers(input.calibrationProfile ?? "v0.3.1");
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const homeBase = teamMean(input.home, input.away, levers) + levers.homeEdge;
  const awayBase = teamMean(input.away, input.home, levers);

  const homeFg = new Float64Array(n);
  const awayFg = new Float64Array(n);
  const homeF5 = new Float64Array(n);
  const awayF5 = new Float64Array(n);
  const homeI1 = new Float64Array(n);
  const awayI1 = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    // v0.2: sigma=0 → identity multiplier and no RNG consumption (pre-correction stream).
    const homeMean = homeBase * logNormalShock(next, levers.gameShockSigma);
    const awayMean = awayBase * logNormalShock(next, levers.gameShockSigma);
    const perInningH = homeMean / 9;
    const perInningA = awayMean / 9;
    let hf = 0;
    let af = 0;
    let h5 = 0;
    let a5 = 0;
    for (let inn = 1; inn <= 9; inn++) {
      const hr = poissonSample(perInningH, next);
      const ar = poissonSample(perInningA, next);
      if (inn === 1) {
        homeI1[i] = hr;
        awayI1[i] = ar;
      }
      hf += hr;
      af += ar;
      if (inn <= 5) {
        h5 += hr;
        a5 += ar;
      }
    }
    homeFg[i] = hf;
    awayFg[i] = af;
    homeF5[i] = h5;
    awayF5[i] = a5;
  }

  const players: SimV2ScenarioTensor["players"] = {};
  const playerStatKeys = [
    "hits",
    "total_bases",
    "home_runs",
    "strikeouts",
    "rbis",
    "stolen_bases",
  ];
  for (const pl of input.players ?? []) {
    const usage = clamp(pl.usage, 0, 1);
    let partP = clamp(pl.participateProb ?? 0.9, 0, 1);
    // Fail-closed: non-starter pitchers and batters without order/starter confirmation.
    if (pl.kind === "pitcher" && pl.confirmedStarter === false) partP = 0;
    if (
      pl.kind === "batter" &&
      pl.battingOrder == null &&
      pl.confirmedStarter !== true
    ) {
      partP = 0;
    }
    if (pl.confirmedStarter || (pl.kind === "batter" && pl.battingOrder != null)) {
      partP = Math.max(partP, 0.95);
    }
    const participated = new Uint8Array(n);
    const hits = new Float64Array(n);
    const totalBases = new Float64Array(n);
    const homeRuns = new Float64Array(n);
    const strikeouts = new Float64Array(n);
    const rbis = new Float64Array(n);
    const stolen = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const inGame = next() < partP ? 1 : 0;
      participated[i] = inGame;
      if (!inGame) continue;
      const teamR = pl.teamSide === "home" ? homeFg[i]! : awayFg[i]!;
      if (pl.kind === "pitcher") {
        const k9 = pl.oppPitcherKPer9 != null ? pl.oppPitcherKPer9 / 9 : 1;
        strikeouts[i] = poissonSample((4.5 + usage * 3) * clamp(k9, 0.7, 1.4), next);
      } else {
        const kPenalty =
          pl.oppPitcherKPer9 != null ? clamp(1.15 - pl.oppPitcherKPer9 / 20, 0.75, 1.1) : 1;
        hits[i] = poissonSample((0.7 + usage * 0.9) * kPenalty, next);
        homeRuns[i] = next() < 0.08 * usage * (teamR / 4) * kPenalty ? 1 : 0;
        totalBases[i] = hits[i]! + homeRuns[i]! * 2 + poissonSample(0.3, next);
        rbis[i] = poissonSample(usage * teamR * 0.15, next);
        stolen[i] = next() < 0.08 * usage ? 1 : 0;
        strikeouts[i] = poissonSample((0.8 + (pl.oppPitcherKPer9 ?? 8) / 12) * usage, next);
      }
    }
    players[pl.playerId] = {
      participated,
      stats: {
        hits,
        total_bases: totalBases,
        home_runs: homeRuns,
        strikeouts,
        rbis,
        stolen_bases: stolen,
      },
    };
  }

  const createdAt = new Date().toISOString();
  const dataFingerprint = fingerprintPayload([
    BASEBALL_JOINT_MODEL_ID,
    levers.modelVersion,
    levers.profile,
    input,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId: BASEBALL_JOINT_MODEL_ID,
      modelVersion: levers.modelVersion,
      sport: "mlb",
      eventId: input.eventId,
      nDraws: n,
      seed: input.seed,
      dataFingerprint,
      createdAt,
      isFixture: false,
      quality: {
        status: "pass",
        missingFields: [],
        warnings: ["baseball_v0_shadow_only", "not_accepted_for_production_serve"],
        participationReady: (input.players?.length ?? 0) > 0,
        oddsReady: true,
      },
      periodsPresent: ["fg", "f5", "i1"],
      playerStatKeys: (input.players?.length ?? 0) > 0 ? playerStatKeys : [],
      provenance: [
        {
          provider: "historical_team_form",
          fetchedAt: createdAt,
          rawHash: dataFingerprint.slice(0, 16),
        },
      ],
    },
    team: {
      homeFg,
      awayFg,
      homeByPeriod: { f5: homeF5, i1: homeI1 },
      awayByPeriod: { f5: awayF5, i1: awayI1 },
    },
    players,
  };
}

/** F5 ≤ FG on every draw (milestone conservation). */
export function assertBaseballF5Conserved(tensor: SimV2ScenarioTensor): void {
  const n = tensor.meta.nDraws;
  const hf5 = tensor.team.homeByPeriod.f5;
  const af5 = tensor.team.awayByPeriod.f5;
  if (!hf5 || !af5) throw new Error("missing_f5");
  for (let i = 0; i < n; i++) {
    if (hf5[i]! > tensor.team.homeFg[i]! + 1e-9) {
      throw new Error(`f5_gt_fg_home:${i}`);
    }
    if (af5[i]! > tensor.team.awayFg[i]! + 1e-9) {
      throw new Error(`f5_gt_fg_away:${i}`);
    }
  }
}
