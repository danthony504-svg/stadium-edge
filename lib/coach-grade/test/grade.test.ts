import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CoachCandidateLeg, CoachSimResult, CoachSportContext } from "@workspace/coach-types";
import type { CoachGateEvaluationContext } from "@workspace/coach-gates";

import {
  buildGradeSubScores,
  computeCoachGrade,
  compositeToDisplayScore,
  gradeFromComposite,
  scoreLineValue,
  scoreSimulation,
} from "../src/index";

const candidate: CoachCandidateLeg = {
  legId: "g1:prop:hits",
  legFingerprint: "fp1",
  kind: "player_prop",
  sport: "mlb",
  gameId: "g1",
  gameLabel: "NYY @ BOS",
  marketKey: "batter_hits",
  marketLabel: "Hits",
  pick: "Over 1.5",
  odds: -110,
  line: 1.5,
  startsAt: "2026-07-12T23:00:00.000Z",
  isAlt: false,
  playerId: "p1",
  playerName: "Aaron Judge",
  propSide: "Over",
};

const sim: CoachSimResult = {
  legFingerprint: "fp1",
  tier: "deep",
  iterations: 10_000,
  hitProbability: 0.562,
  evPct: 4.2,
  edgePct: 3.1,
  distributionSummary: { confidenceScore: 58 },
  computedAt: "2026-07-12T20:00:00.000Z",
};

const context: CoachGateEvaluationContext = {
  matchup: {
    mlLean: { side: "Aaron Judge", edge: 2.0 },
    pickTeam: "Aaron Judge",
  },
  trends: { momentum: 0.45, sampleSize: 5 },
  injuries: { favor: 0.35 },
  lineMovement: { direction: "toward", magnitudePct: 1.2 },
};

describe("coach-grade scorers", () => {
  it("scores positive line value above neutral", () => {
    const score = scoreLineValue(3.1);
    assert.ok(score != null && score > 5.5);
  });

  it("maps composite to letter grades", () => {
    assert.equal(gradeFromComposite(7.84), "B+");
    assert.equal(gradeFromComposite(9.0), "A+");
  });

  it("maps 1–10 composite to 0–100 display score", () => {
    assert.equal(compositeToDisplayScore(7.84), 78.4);
  });
});

describe("coach-grade compute", () => {
  it("builds sub-scores from sim and context", () => {
    const sub = buildGradeSubScores(candidate, sim, context);
    assert.ok(sub.simulation != null && sub.simulation > 5.5);
    assert.ok(sub.lineValue != null && sub.lineValue > 5.5);
    assert.ok(sub.trends != null);
  });

  it("produces competitive grade for strong qualified prop", () => {
    const strongSim: CoachSimResult = {
      ...sim,
      hitProbability: 0.58,
      evPct: 5.5,
      edgePct: 4.2,
      distributionSummary: { confidenceScore: 62 },
    };
    const result = computeCoachGrade({ candidate, sim: strongSim, context });
    assert.ok(result.compositeScore >= 65, `compositeScore=${result.compositeScore}`);
    assert.ok(["B-", "B", "B+", "A-", "A", "A+"].includes(result.grade), `grade=${result.grade}`);
    assert.equal(result.confidencePct, 62);
    assert.equal(result.weights.simulation, 0.3);
    assert.ok(result.breakdown.simulation != null);
  });

  it("allows sport grade hook to adjust confidence only", () => {
    const sportContext: CoachSportContext = {
      sport: "mlb",
      injuries: {},
      matchupHistory: {},
      playerHistory: {},
      lineMovement: {},
      trends: {},
    };
    const result = computeCoachGrade({
      candidate,
      sim,
      context,
      sportContext,
      gradeHook: (leg, base) => ({
        ...base,
        confidencePct: base.confidencePct + 2,
        breakdown: { ...base.breakdown, learningNudge: 0.2 },
      }),
    });
    assert.equal(result.confidencePct, 60);
  });

  it("rewards favorable simulation hit rate", () => {
    const weakSim = { ...sim, hitProbability: 0.51, edgePct: 0.5, evPct: 0.3 };
    const strong = computeCoachGrade({ candidate, sim, context });
    const weak = computeCoachGrade({ candidate, sim: weakSim, context });
    assert.ok(strong.compositeScore > weak.compositeScore);
  });
});
