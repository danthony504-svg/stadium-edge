/**
 * Phase C.1 — attach skill player props to the joint football tensor.
 * Stats are sampled conditional on the same draw's team FG (joint, not independent V1).
 * Shadow-only; production serve remains off.
 */

import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { poissonSample } from "./jointFootball.js";

export const FOOTBALL_PROP_STAT_KEYS = [
  "pass_yds",
  "rush_yds",
  "rec_yds",
  "receptions",
  "pass_attempts",
  "any_td",
] as const;

export type FootballPropRole = "qb" | "rb" | "wr" | "te" | "flex";

export type FootballPropPlayerInput = {
  playerId: string;
  teamSide: "home" | "away";
  role: FootballPropRole;
  /** 0–1 share of team skill volume for this player's primary stat. */
  usage: number;
  /** Expected participation; <0.5 ⇒ often DNP in draws. */
  participateProb?: number;
};

export type AttachFootballPlayerPropsInput = {
  tensor: SimV2ScenarioTensor;
  players: FootballPropPlayerInput[];
  /** Extra entropy mixed into seed (deterministic). */
  propSeedSuffix?: string;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Rough yards-per-point scaling so props move with team scoring on the same draw. */
function teamYardBudget(points: number, kind: "pass" | "rush" | "rec"): number {
  const pts = Math.max(0, points);
  if (kind === "pass") return 8.5 * pts + 120;
  if (kind === "rush") return 3.2 * pts + 60;
  return 5.5 * pts + 80;
}

/**
 * Mutates a shallow-copied tensor with joint player stats.
 * Does not invent sportsbook markets — callers attach real lines via market builders.
 */
export function attachFootballPlayerProps(input: AttachFootballPlayerPropsInput): SimV2ScenarioTensor {
  const base = input.tensor;
  const n = base.meta.nDraws;
  const seed = `${base.meta.seed}|props|${input.propSeedSuffix ?? "c1"}`;
  const { next } = createSeededRng(seed);

  const players: SimV2ScenarioTensor["players"] = { ...base.players };
  const warnings = [...base.meta.quality.warnings, "phase_c1_player_props_shadow"];

  for (const p of input.players) {
    if (!p.playerId) continue;
    const usage = clamp01(p.usage);
    const partP = clamp01(p.participateProb ?? 0.92);
    const participated = new Uint8Array(n);
    const passYds = new Float64Array(n);
    const rushYds = new Float64Array(n);
    const recYds = new Float64Array(n);
    const receptions = new Float64Array(n);
    const passAttempts = new Float64Array(n);
    const anyTd = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const teamPts =
        p.teamSide === "home" ? base.team.homeFg[i]! : base.team.awayFg[i]!;
      const inGame = next() < partP ? 1 : 0;
      participated[i] = inGame;
      if (!inGame) continue;

      const passBud = teamYardBudget(teamPts, "pass");
      const rushBud = teamYardBudget(teamPts, "rush");
      const recBud = teamYardBudget(teamPts, "rec");

      if (p.role === "qb") {
        passYds[i] = poissonSample(passBud * usage, next);
        passAttempts[i] = poissonSample(22 * usage + 8, next);
        rushYds[i] = poissonSample(rushBud * usage * 0.15, next);
        anyTd[i] = next() < clamp01(0.04 * teamPts * usage) ? 1 : 0;
      } else if (p.role === "rb") {
        rushYds[i] = poissonSample(rushBud * usage, next);
        recYds[i] = poissonSample(recBud * usage * 0.35, next);
        receptions[i] = poissonSample(2.2 * usage, next);
        anyTd[i] = next() < clamp01(0.05 * teamPts * usage) ? 1 : 0;
      } else {
        // wr / te / flex
        recYds[i] = poissonSample(recBud * usage, next);
        receptions[i] = poissonSample(3.5 * usage, next);
        rushYds[i] = poissonSample(rushBud * usage * 0.05, next);
        anyTd[i] = next() < clamp01(0.035 * teamPts * usage) ? 1 : 0;
      }
    }

    players[p.playerId] = {
      participated,
      stats: {
        pass_yds: passYds,
        rush_yds: rushYds,
        rec_yds: recYds,
        receptions,
        pass_attempts: passAttempts,
        any_td: anyTd,
      },
    };
  }

  const playerStatKeys = [...FOOTBALL_PROP_STAT_KEYS];
  const dataFingerprint = fingerprintPayload([
    base.meta.dataFingerprint,
    "football_props_c1",
    input.players,
    seed,
  ]);

  return {
    ...base,
    meta: {
      ...base.meta,
      dataFingerprint,
      playerStatKeys,
      quality: {
        ...base.meta.quality,
        participationReady: input.players.length > 0,
        warnings,
      },
    },
    players,
  };
}
