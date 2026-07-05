import assert from "node:assert/strict";
import test from "node:test";
import type { PropSimulationResult } from "./api.ts";
import type { CombinedPickScore } from "./pickScore.ts";
import {
  evaluateSimulatorTicketQuality,
  SIM_TICKET_MIN_GRADE,
} from "./simulatorTicketOptimizer.ts";
import { gradeRank } from "./simulatorRecommendations.ts";

function mockScores(overrides: Partial<CombinedPickScore> = {}): CombinedPickScore {
  return {
    scores: {
      matchup: 7,
      trend: 7,
      lineValue: 7,
      injury: 6,
      lineShopping: 6,
      simulation: 7,
      ...(overrides.scores ?? {}),
    },
    composite: overrides.composite ?? 8,
    grade: overrides.grade ?? "A-",
    confidencePct: overrides.confidencePct ?? 68,
    edgePct: overrides.edgePct ?? 3.5,
    ...overrides,
  };
}

function mockSim(hit = 0.58): PropSimulationResult {
  return {
    key: "P|m|24.5|Over",
    player: "P",
    market: "m",
    line: 24.5,
    side: "Over",
    requestedSims: 10_000,
    completedSims: 10_000,
    failedSims: 0,
    actualSimCount: 10_000,
    startedAt: "",
    finishedAt: "",
    runTimeMs: 0,
    simulations: 10_000,
    hitProbability: hit,
    mostLikelyLine: 26,
    meanProjection: 26,
    medianProjection: 26,
    confidenceScore: 72,
    stdDev: null,
    sampleGames: 10,
    percentiles: null,
  };
}

test("evaluateSimulatorTicketQuality: strong prop passes", () => {
  const r = evaluateSimulatorTicketQuality(mockScores(), mockSim());
  assert.equal(r.passes, true);
});

test("evaluateSimulatorTicketQuality: fails below B+", () => {
  const r = evaluateSimulatorTicketQuality(
    mockScores({ grade: "B", composite: 7.2 }),
    mockSim(),
  );
  assert.equal(r.passes, false);
  assert.ok(gradeRank("B") < gradeRank(SIM_TICKET_MIN_GRADE));
});

test("evaluateSimulatorTicketQuality: fails without full deep sim", () => {
  const partial = { ...mockSim(), completedSims: 500, simulations: 500 };
  const r = evaluateSimulatorTicketQuality(mockScores(), partial);
  assert.equal(r.passes, false);
});
