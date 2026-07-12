import assert from "node:assert/strict";
import test from "node:test";
import { serverBoardLegQualifies } from "../src/lib/coachSlateLegQualification.js";
import type { ParsedPick } from "../src/lib/coachSlateTypes.js";

function propPick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "Away @ Home",
    market: "Points",
    pick: "Player Over 24.5 Points",
    odds: -110,
    isProp: true,
    player: "Player",
    propLine: 24.5,
    propSide: "Over",
    ...overrides,
  };
}

test("serverBoardLegQualifies accepts alt prop with sim+edge below strict recommends", () => {
  const pick = propPick({ propIsAlt: true });
  const score = {
    composite: 54,
    grade: "C+",
    confidencePct: 52,
    edgePct: 1.2,
    simHit: 0.54,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 54, grade: "C+", confidencePct: 52, edgePct: 1.2, scores: {} as never },
  };
  assert.equal(serverBoardLegQualifies(pick, score), true);
});

test("serverBoardLegQualifies rejects prop without sim hit", () => {
  const pick = propPick();
  const score = {
    composite: 40,
    grade: "C+",
    confidencePct: 52,
    edgePct: 2,
    simHit: null,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 40, grade: "C+", confidencePct: 52, edgePct: 2, scores: {} as never },
  };
  assert.equal(serverBoardLegQualifies(pick, score), false);
});

test("serverBoardLegQualifies promotes alt rung when main fails strict recommends", () => {
  const main = {
    pick: propPick(),
    rankScore: 90,
    isAlt: false,
    pickScore: undefined as never,
  };
  const alt = {
    pick: propPick({ propIsAlt: true, propLine: 22.5, pick: "Player Over 22.5 Points" }),
    rankScore: 70,
    isAlt: true,
    pickScore: undefined as never,
  };
  main.pick.finalAiScore = {
    composite: 50,
    grade: "C",
    confidencePct: 48,
    edgePct: 0.5,
    simHit: 0.51,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 50, grade: "C", confidencePct: 48, edgePct: 0.5, scores: {} as never },
  };
  alt.pick.finalAiScore = {
    composite: 55,
    grade: "C+",
    confidencePct: 52,
    edgePct: 1.5,
    simHit: 0.55,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 55, grade: "C+", confidencePct: 52, edgePct: 1.5, scores: {} as never },
  };

  assert.equal(serverBoardLegQualifies(main.pick, main.pick.finalAiScore), false);
  assert.equal(serverBoardLegQualifies(alt.pick, alt.pick.finalAiScore), true);
});
