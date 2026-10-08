/**
 * Milestone D.1 — NHL joint period goals model (shadow-only).
 * P1+P2+P3 = FG on every draw. No football imports / params.
 */

import { SIM_V2_DEEP_DRAWS, SIM_V2_SCHEMA_VERSION } from "../../version.js";
import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { NHL_PERIOD_SHARES, NHL_TEAM_FG_MEAN, isHockeySport, type HockeySport } from "./priors.js";

export const HOCKEY_JOINT_MODEL_ID = "hockey.joint.v0" as const;
export const HOCKEY_JOINT_MODEL_VERSION = "0.1.0" as const;
export const HOCKEY_JOINT_MODEL_IDS = [HOCKEY_JOINT_MODEL_ID] as const;

export type HockeyTeamInput = {
  teamId: string;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  recentFgGoals?: number[];
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

export type HockeyPropPlayerInput = {
  playerId: string;
  teamSide: "home" | "away";
  /** Share of team goals / SOG volume. */
  usage: number;
  participateProb?: number;
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

function teamFgMean(team: HockeyTeamInput, opp: HockeyTeamInput): number {
  const offense = team.goalsFor ?? avg(team.recentFgGoals, NHL_TEAM_FG_MEAN);
  const defense = opp.goalsAgainst ?? NHL_TEAM_FG_MEAN;
  return clamp(0.55 * offense + 0.45 * defense, 1.5, 5.0);
}

export function buildJointHockeyTensor(input: JointHockeyInput): SimV2ScenarioTensor {
  if (!isHockeySport(input.sport)) {
    throw new Error(`hockey_joint_sport_unsupported:${input.sport}`);
  }
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const homeMean = teamFgMean(input.home, input.away) + 0.15; // mild HFA
  const awayMean = teamFgMean(input.away, input.home);

  const homeFg = new Float64Array(n);
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

  for (let i = 0; i < n; i++) {
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
  }

  const players: SimV2ScenarioTensor["players"] = {};
  const playerStatKeys = ["goals", "assists", "points", "shots_on_goal"];
  for (const pl of input.players ?? []) {
    const usage = clamp(pl.usage, 0, 1);
    const partP = clamp(pl.participateProb ?? 0.95, 0, 1);
    const participated = new Uint8Array(n);
    const goals = new Float64Array(n);
    const assists = new Float64Array(n);
    const points = new Float64Array(n);
    const sog = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const inGame = next() < partP ? 1 : 0;
      participated[i] = inGame;
      if (!inGame) continue;
      const teamG = pl.teamSide === "home" ? homeFg[i]! : awayFg[i]!;
      goals[i] = poissonSample(teamG * usage * 0.35, next);
      assists[i] = poissonSample(teamG * usage * 0.4, next);
      points[i] = goals[i]! + assists[i]!;
      sog[i] = poissonSample(2.8 + teamG * usage * 1.1, next);
    }
    players[pl.playerId] = {
      participated,
      stats: { goals, assists, points, shots_on_goal: sog },
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
        warnings: ["hockey_v0_shadow_only", "not_accepted_for_production_serve"],
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
      homeByPeriod: { p1: homeP[0], p2: homeP[1], p3: homeP[2] },
      awayByPeriod: { p1: awayP[0], p2: awayP[1], p3: awayP[2] },
    },
    players,
  };
}
