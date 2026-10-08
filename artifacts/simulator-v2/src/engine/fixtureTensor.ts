/**
 * Phase A fixture tensor builder — NOT a sport model.
 * Produces conserved joint FG/period/player draws for contract tests only.
 * meta.isFixture = true always; production serve paths must reject fixtures.
 */

import {
  SIM_V2_DEEP_DRAWS,
  SIM_V2_SCHEMA_VERSION,
} from "../version.js";
import type { SimV2ScenarioTensor } from "../schemas/scenarioTensor.js";
import type { SimV2SportId } from "../schemas/sport.js";
import { createSeededRng, fingerprintPayload } from "../seed/mulberry32.js";

export type FixtureTensorInput = {
  sport: SimV2SportId;
  eventId: string;
  seed: string;
  nDraws?: number;
  /** Mean points per half for a trivial conserved process. */
  homeHalfMeans?: [number, number];
  awayHalfMeans?: [number, number];
  playerId?: string;
  playerStatKey?: string;
};

function sampleNonNeg(rng: () => number, mean: number): number {
  // Simple non-negative draw around mean (fixture only).
  const v = mean + (rng() - 0.5) * mean * 0.4;
  return Math.max(0, Math.round(v * 10) / 10);
}

export function buildFixtureScenarioTensor(input: FixtureTensorInput): SimV2ScenarioTensor {
  const n = input.nDraws ?? SIM_V2_DEEP_DRAWS;
  const { next } = createSeededRng(input.seed);
  const homeHalfMeans = input.homeHalfMeans ?? [12, 12];
  const awayHalfMeans = input.awayHalfMeans ?? [10, 11];

  const homeFg = new Float64Array(n);
  const awayFg = new Float64Array(n);
  const homeH1 = new Float64Array(n);
  const homeH2 = new Float64Array(n);
  const awayH1 = new Float64Array(n);
  const awayH2 = new Float64Array(n);

  const playerId = input.playerId ?? "fixture-player-1";
  const statKey = input.playerStatKey ?? "points";
  const participated = new Uint8Array(n);
  const playerStat = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const h1 = sampleNonNeg(next, homeHalfMeans[0]);
    const h2 = sampleNonNeg(next, homeHalfMeans[1]);
    const a1 = sampleNonNeg(next, awayHalfMeans[0]);
    const a2 = sampleNonNeg(next, awayHalfMeans[1]);
    homeH1[i] = h1;
    homeH2[i] = h2;
    awayH1[i] = a1;
    awayH2[i] = a2;
    homeFg[i] = h1 + h2;
    awayFg[i] = a1 + a2;
    participated[i] = 1;
    // Player points share of home FG (fixture joint link).
    playerStat[i] = Math.min(homeFg[i], Math.round(homeFg[i] * (0.2 + next() * 0.15) * 10) / 10);
  }

  const createdAt = new Date().toISOString();
  const dataFingerprint = fingerprintPayload([
    "fixture",
    input.sport,
    input.eventId,
    input.seed,
    n,
    homeHalfMeans,
    awayHalfMeans,
  ]);

  return {
    meta: {
      schemaVersion: SIM_V2_SCHEMA_VERSION,
      engineId: "simulator-v2",
      modelId: "fixture.phase_a",
      modelVersion: "0.1.0",
      sport: input.sport,
      eventId: input.eventId,
      nDraws: n,
      seed: input.seed,
      dataFingerprint,
      createdAt,
      isFixture: true,
      quality: {
        status: "pass",
        missingFields: [],
        warnings: ["phase_a_fixture_not_a_sport_model"],
        participationReady: true,
        oddsReady: true,
      },
      periodsPresent: ["fg", "h1", "h2"],
      playerStatKeys: [statKey],
      provenance: [
        {
          provider: "fixture",
          fetchedAt: createdAt,
          rawHash: dataFingerprint.slice(0, 16),
        },
      ],
    },
    team: {
      homeFg,
      awayFg,
      homeByPeriod: { h1: homeH1, h2: homeH2 },
      awayByPeriod: { h1: awayH1, h2: awayH2 },
    },
    players: {
      [playerId]: {
        participated,
        stats: { [statKey]: playerStat },
      },
    },
  };
}
