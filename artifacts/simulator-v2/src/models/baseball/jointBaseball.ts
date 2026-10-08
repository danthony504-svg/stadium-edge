/**
 * Milestone F.1 — MLB joint runs model (shadow-only).
 * Samples 9 inning run vectors; F5 = sum(i1..i5); FG = sum(i1..i9).
 * Guarantees F5 ≤ FG on every draw. No football reuse.
 */

import { SIM_V2_DEEP_DRAWS, SIM_V2_SCHEMA_VERSION } from "../../version.js";
import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { MLB_TEAM_FG_MEAN, isBaseballSport, type BaseballSport } from "./priors.js";

export const BASEBALL_JOINT_MODEL_ID = "baseball.joint.v0" as const;
/** v0.3: form shrinkage + per-draw game shock (ML ECE calibration). */
export const BASEBALL_JOINT_MODEL_VERSION = "0.3.0" as const;
export const BASEBALL_JOINT_MODEL_IDS = [BASEBALL_JOINT_MODEL_ID] as const;

/** Shrink noisy recent form toward league mean — primary ECE fix alongside game shock. */
function shrinkToLeague(raw: number, league: number, weight = 0.4): number {
  return weight * league + (1 - weight) * raw;
}

/** Box-Muller then exp — per-draw multiplicative shock (underdispersion fix). */
function logNormalShock(rng: () => number, sigma: number): number {
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

function teamMean(team: BaseballTeamInput, opp: BaseballTeamInput): number {
  const offense = shrinkToLeague(
    team.runsFor ?? avg(team.recentFgRuns, MLB_TEAM_FG_MEAN),
    MLB_TEAM_FG_MEAN,
  );
  const defense = shrinkToLeague(opp.runsAgainst ?? MLB_TEAM_FG_MEAN, MLB_TEAM_FG_MEAN);
  return clamp(0.55 * offense + 0.45 * defense, 2.0, 7.5);
}

/** Per-draw lognormal sigma on team means (game-level shock). */
const BASEBALL_GAME_SHOCK_SIGMA = 0.18;
/** Milder home edge vs prior 0.1 — reduced ML overconfidence. */
const BASEBALL_HOME_EDGE = 0.05;

export function buildJointBaseballTensor(input: JointBaseballInput): SimV2ScenarioTensor {
  if (!isBaseballSport(input.sport)) {
    throw new Error(`baseball_joint_sport_unsupported:${input.sport}`);
  }
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const homeBase = teamMean(input.home, input.away) + BASEBALL_HOME_EDGE;
  const awayBase = teamMean(input.away, input.home);

  const homeFg = new Float64Array(n);
  const awayFg = new Float64Array(n);
  const homeF5 = new Float64Array(n);
  const awayF5 = new Float64Array(n);
  const homeI1 = new Float64Array(n);
  const awayI1 = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const homeMean = homeBase * logNormalShock(next, BASEBALL_GAME_SHOCK_SIGMA);
    const awayMean = awayBase * logNormalShock(next, BASEBALL_GAME_SHOCK_SIGMA);
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
    BASEBALL_JOINT_MODEL_VERSION,
    input,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId: BASEBALL_JOINT_MODEL_ID,
      modelVersion: BASEBALL_JOINT_MODEL_VERSION,
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
