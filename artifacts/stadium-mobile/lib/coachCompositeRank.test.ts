import assert from "node:assert/strict";
import test from "node:test";
import {
  COACH_COMPOSITE_RANK_WEIGHTS,
  coachCompositeRankScore,
  combineCoachRankFactors,
  evPctToRankScore,
  simConfidenceToRankScore,
} from "./coachCompositeRank.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

test("COACH_COMPOSITE_RANK_WEIGHTS match requested ranking blend", () => {
  const sum = Object.values(COACH_COMPOSITE_RANK_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.ev, 0.35);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.simulation, 0.25);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.matchup, 0.15);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.recentForm, 0.1);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.injury, 0.05);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.lineMovement, 0.05);
  assert.equal(COACH_COMPOSITE_RANK_WEIGHTS.marketEfficiency, 0.05);
});

test("evPctToRankScore maps +20% EV to 10", () => {
  assert.equal(evPctToRankScore(20), 10);
  assert.equal(evPctToRankScore(0), 0);
});

test("simConfidenceToRankScore prefers sim hit over confidence pct", () => {
  assert.equal(simConfidenceToRankScore(0.58, 52), 5.8);
});

test("combineCoachRankFactors renormalizes present factors", () => {
  const composite = combineCoachRankFactors({
    ev: 10,
    simulation: 8,
    matchup: null,
    recentForm: null,
    injury: null,
    lineMovement: null,
    marketEfficiency: null,
  });
  assert.equal(composite, 9.17);
});

test("coachCompositeRankScore ranks higher EV above weaker EV with same sim", () => {
  const base = (evPct: number): BoardScoredLeg => ({
    pick: {
      game: "A @ B",
      market: "Spread",
      pick: "A +3.5",
      odds: 110,
      finalAiScore: {
        composite: 6,
        grade: "B",
        confidencePct: 55,
        edgePct: 3,
        simHit: 0.55,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: {
          composite: 6,
          grade: "B",
          confidencePct: 55,
          edgePct: 3,
          scores: {
            matchup: 6,
            trend: 6,
            injury: 5.5,
            lineValue: 6,
            lineShopping: 6,
            simulation: 5.5,
          },
        },
      },
    },
    evPct,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 47,
    lineShoppingScore: 6,
    grade: "B",
    simHit: 0.55,
    composite: 6,
    rankScore: 0,
  });
  const highEv = coachCompositeRankScore(base(12));
  const lowEv = coachCompositeRankScore(base(4));
  assert.ok(highEv > lowEv);
});

test("coachCompositeRankScore penalizes missing contextual factors", () => {
  const rich: BoardScoredLeg = {
    pick: {
      game: "A @ B",
      market: "Points",
      pick: "Star Over 22.5",
      odds: -105,
      isProp: true,
      player: "Star",
      finalAiScore: {
        composite: 7,
        grade: "B+",
        confidencePct: 60,
        edgePct: 4,
        simHit: 0.57,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: {
          composite: 7,
          grade: "B+",
          confidencePct: 60,
          edgePct: 4,
          scores: {
            matchup: 7,
            trend: 7,
            injury: 6.5,
            lineValue: 7,
            lineShopping: 6,
            simulation: 7,
          },
        },
        propHolistic: {
          composite: 7,
          grade: "B+",
          confidencePct: 60,
          coveragePct: 80,
          missingCount: 1,
          applicableCount: 8,
          recommends: true,
          factors: [
            { key: "recentForm", label: "Recent Form", score: 7, applicable: true, present: true },
            { key: "matchup", label: "Matchup", score: 7, applicable: true, present: true },
            { key: "opponentTendency", label: "Opponent", score: 6.5, applicable: true, present: true },
            { key: "injury", label: "Injury", score: 6.5, applicable: true, present: true },
            { key: "lineMovement", label: "Line Movement", score: 6, applicable: true, present: true },
            { key: "sportsbookValue", label: "Value", score: 7, applicable: true, present: true },
            { key: "simulation", label: "Simulation", score: 7, applicable: true, present: true },
          ],
        },
      },
    },
    evPct: 8,
    edgePct: 4,
    confidencePct: 60,
    impliedProbPct: 51,
    lineShoppingScore: 6,
    grade: "B+",
    simHit: 0.57,
    composite: 7,
    rankScore: 0,
  };
  const thin: BoardScoredLeg = {
    ...rich,
    pick: {
      ...rich.pick,
      finalAiScore: {
        ...rich.pick.finalAiScore!,
        propHolistic: {
          ...rich.pick.finalAiScore!.propHolistic!,
          factors: [
            { key: "sportsbookValue", label: "Value", score: 7, applicable: true, present: true },
            { key: "simulation", label: "Simulation", score: 7, applicable: true, present: true },
          ],
        },
      },
    },
  };
  assert.ok(coachCompositeRankScore(rich) > coachCompositeRankScore(thin));
});
