import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  COACH_MIN_GRADE_RANK,
  evaluateCoachLegQuality,
} from "./coachLegQuality.ts";
import type { CombinedPickScore } from "./pickScore.ts";

const gradeRank = (g: string) =>
  ({ F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10 })[g] ?? -1;

function mockPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "A @ B",
    market: "Points",
    pick: "Player X Over 24.5 Points",
    odds: -110,
    isProp: true,
    player: "Player X",
    propLine: 24.5,
    propSide: "Over",
    ...overrides,
  };
}

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

function mockSim(hit = 0.58) {
  return {
    key: "k",
    player: "Player X",
    market: "player_points",
    line: 24.5,
    side: "Over" as const,
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

test("evaluateCoachLegQuality: strong prop passes all checks", () => {
  const pick = mockPick({ scores: mockScores() });
  const r = evaluateCoachLegQuality(pick, mockSim());
  assert.equal(r.passes, true);
  assert.equal(r.failures.length, 0);
});

test("evaluateCoachLegQuality: fails without B+ grade", () => {
  const pick = mockPick({
    scores: mockScores({ grade: "C+", composite: 6.4 }),
  });
  const r = evaluateCoachLegQuality(pick, mockSim());
  assert.equal(r.passes, false);
  assert.ok(r.failures.includes("low_grade"));
  assert.ok(gradeRank("C+") < COACH_MIN_GRADE_RANK);
});

test("evaluateCoachLegQuality: fails on negative edge", () => {
  const pick = mockPick({ scores: mockScores({ edgePct: -1.2 }) });
  const r = evaluateCoachLegQuality(pick, mockSim());
  assert.equal(r.passes, false);
  assert.ok(r.failures.includes("no_edge"));
});

test("evaluateCoachLegQuality: fails when sim hit below floor", () => {
  const pick = mockPick({ scores: mockScores() });
  const r = evaluateCoachLegQuality(pick, mockSim(0.41));
  assert.equal(r.passes, false);
  assert.ok(r.failures.includes("low_sim_hit"));
});

test("evaluateCoachLegQuality: game leg skips sim requirements", () => {
  const pick = mockPick({
    isProp: false,
    scores: mockScores(),
  });
  const r = evaluateCoachLegQuality(pick, null);
  assert.equal(r.passes, true);
});
