/**
 * Milestone D.2+ — NHL joint model with regulation / OT / SO layers (shadow-only).
 * P1+P2+P3 = regulation FG. Final scores add OT goal or SO winner (+1).
 * v0.3.0: form shrinkage + lognormal mean shocks + milder HFA (calib fix).
 * No football imports.
 */

import { SIM_V2_DEEP_DRAWS, SIM_V2_SCHEMA_VERSION } from "../../version.js";
import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { NHL_PERIOD_SHARES, NHL_TEAM_FG_MEAN, isHockeySport, type HockeySport } from "./priors.js";

export const HOCKEY_JOINT_MODEL_ID = "hockey.joint.v0" as const;
export const HOCKEY_JOINT_MODEL_VERSION = "0.3.0" as const;
export const HOCKEY_JOINT_MODEL_IDS = [HOCKEY_JOINT_MODEL_ID] as const;

/** Shrink raw form 40% toward league mean (reduces form overconfidence). */
export const NHL_FORM_SHRINK_TO_LEAGUE = 0.4 as const;
/** Per-draw lognormal σ on team means (adds overdispersion vs thin Poisson). */
export const NHL_MEAN_SHOCK_SIGMA = 0.15 as const;
/** Milder home-ice advantage (goals) vs v0.2.0's 0.15. */
export const NHL_HFA_GOALS = 0.08 as const;

export type HockeyTeamInput = {
  teamId: string;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  recentFgGoals?: number[];
};

export type HockeyPropPlayerInput = {
  playerId: string;
  teamSide: "home" | "away";
  usage: number;
  participateProb?: number;
  /** Goalie flag for saves markets. */
  isGoalie?: boolean;
};

export type JointHockeyInput = {
  sport: HockeySport;
  eventId: string;
  seed: string;
  home: HockeyTeamInput;
  away: HockeyTeamInput;
  nDraws?: number;
  players?: HockeyPropPlayerInput[];
};

function avg(vals: number[] | undefined, fallback: number): number {
  if (!vals?.length) return fallback;
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

function shrinkToLeague(raw: number): number {
  return (1 - NHL_FORM_SHRINK_TO_LEAGUE) * raw + NHL_FORM_SHRINK_TO_LEAGUE * NHL_TEAM_FG_MEAN;
}

function teamFgMean(team: HockeyTeamInput, opp: HockeyTeamInput): number {
  const offense = shrinkToLeague(team.goalsFor ?? avg(team.recentFgGoals, NHL_TEAM_FG_MEAN));
  const defense = shrinkToLeague(opp.goalsAgainst ?? NHL_TEAM_FG_MEAN);
  return clamp(0.55 * offense + 0.45 * defense, 1.5, 5.0);
}

export function buildJointHockeyTensor(input: JointHockeyInput): SimV2ScenarioTensor {
  if (!isHockeySport(input.sport)) {
    throw new Error(`hockey_joint_sport_unsupported:${input.sport}`);
  }
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const homeMeanBase = teamFgMean(input.home, input.away) + NHL_HFA_GOALS;
  const awayMeanBase = teamFgMean(input.away, input.home);

  const homeFg = new Float64Array(n); // regulation
  const awayFg = new Float64Array(n);
  const homeP: [Float64Array, Float64Array, Float64Array] = [
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
  ];
  const awayP: [Float64Array, Float64Array, Float64Array] = [
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
  ];
  const homeOt = new Float64Array(n);
  const awayOt = new Float64Array(n);
  const homeSo = new Float64Array(n); // 1 if won SO
  const awaySo = new Float64Array(n);
  const wentOt = new Float64Array(n);
  const wentSo = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const homeMean = homeMeanBase * Math.exp(normalSample(next, 0, NHL_MEAN_SHOCK_SIGMA));
    const awayMean = awayMeanBase * Math.exp(normalSample(next, 0, NHL_MEAN_SHOCK_SIGMA));
    let hs = 0;
    let as = 0;
    for (let p = 0; p < 3; p++) {
      const hg = poissonSample(homeMean * NHL_PERIOD_SHARES[p]!, next);
      const ag = poissonSample(awayMean * NHL_PERIOD_SHARES[p]!, next);
      homeP[p]![i] = hg;
      awayP[p]![i] = ag;
      hs += hg;
      as += ag;
    }
    homeFg[i] = hs;
    awayFg[i] = as;

    if (hs === as) {
      wentOt[i] = 1;
      // 5-on-5 / 3-on-3 OT: low-scoring sudden death
      const hot = next() < 0.35 ? 1 : 0;
      const aot = hot === 1 ? 0 : next() < 0.35 ? 1 : 0;
      if (hot === 1) {
        homeOt[i] = 1;
      } else if (aot === 1) {
        awayOt[i] = 1;
      } else {
        // still tied → SO
        wentSo[i] = 1;
        if (next() < 0.52) homeSo[i] = 1;
        else awaySo[i] = 1;
      }
    }
  }

  const players: SimV2ScenarioTensor["players"] = {};
  const playerStatKeys = ["goals", "assists", "points", "shots_on_goal", "saves"];
  for (const pl of input.players ?? []) {
    const usage = clamp(pl.usage, 0, 1);
    const partP = clamp(pl.participateProb ?? 0.95, 0, 1);
    const participated = new Uint8Array(n);
    const goals = new Float64Array(n);
    const assists = new Float64Array(n);
    const points = new Float64Array(n);
    const sog = new Float64Array(n);
    const saves = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const inGame = next() < partP ? 1 : 0;
      participated[i] = inGame;
      if (!inGame) continue;
      const teamG = pl.teamSide === "home" ? homeFg[i]! : awayFg[i]!;
      const oppG = pl.teamSide === "home" ? awayFg[i]! : homeFg[i]!;
      if (pl.isGoalie) {
        // Saves ≈ opponent SOG − goals; proxy opponent SOG from goals
        const oppSog = poissonSample(28 + oppG * 2.5, next);
        saves[i] = Math.max(0, oppSog - oppG);
        sog[i] = 0;
      } else {
        goals[i] = poissonSample(teamG * usage * 0.35, next);
        assists[i] = poissonSample(teamG * usage * 0.4, next);
        points[i] = goals[i]! + assists[i]!;
        sog[i] = poissonSample(2.8 + teamG * usage * 1.1, next);
      }
    }
    players[pl.playerId] = {
      participated,
      stats: { goals, assists, points, shots_on_goal: sog, saves },
    };
  }

  const createdAt = new Date().toISOString();
  const dataFingerprint = fingerprintPayload([
    HOCKEY_JOINT_MODEL_ID,
    HOCKEY_JOINT_MODEL_VERSION,
    input,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId: HOCKEY_JOINT_MODEL_ID,
      modelVersion: HOCKEY_JOINT_MODEL_VERSION,
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
          "hockey_v0_shadow_only",
          "not_accepted_for_production_serve",
          "fg_is_regulation_use_nhl_final_paths",
          "form_shrink_0.4_league_plus_lognormal_shock",
        ],
        participationReady: (input.players?.length ?? 0) > 0,
        oddsReady: true,
      },
      periodsPresent: ["fg", "p1", "p2", "p3"],
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
      homeByPeriod: {
        p1: homeP[0],
        p2: homeP[1],
        p3: homeP[2],
        ot: homeOt,
        so: homeSo,
        went_ot: wentOt,
        went_so: wentSo,
      },
      awayByPeriod: {
        p1: awayP[0],
        p2: awayP[1],
        p3: awayP[2],
        ot: awayOt,
        so: awaySo,
        went_ot: wentOt,
        went_so: wentSo,
      },
    },
    players,
  };
}

/** Final home goals including OT goal or SO win (+1). */
export function nhlFinalHomeSeries(tensor: SimV2ScenarioTensor): Float64Array {
  const n = tensor.meta.nDraws;
  const out = new Float64Array(n);
  const ot = tensor.team.homeByPeriod.ot ?? new Float64Array(n);
  const so = tensor.team.homeByPeriod.so ?? new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = tensor.team.homeFg[i]! + ot[i]! + so[i]!;
  return out;
}

export function nhlFinalAwaySeries(tensor: SimV2ScenarioTensor): Float64Array {
  const n = tensor.meta.nDraws;
  const out = new Float64Array(n);
  const ot = tensor.team.awayByPeriod.ot ?? new Float64Array(n);
  const so = tensor.team.awayByPeriod.so ?? new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = tensor.team.awayFg[i]! + ot[i]! + so[i]!;
  return out;
}
