import assert from "node:assert/strict";
import test from "node:test";
import {
  positiveEdgeScoredLegs,
  salvageCoachDelivery,
  shouldSalvageCoachDelivery,
} from "./coachDeliverySalvage.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const bTierScore = {
  composite: 6,
  grade: "B",
  confidencePct: 55,
  edgePct: 2,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 6, grade: "B", confidencePct: 55, edgePct: 2, scores: {} as never },
};

const mediumScore = {
  composite: 5.5,
  grade: "C",
  confidencePct: 48,
  edgePct: 1.5,
  simHit: 0.54,
  simAligned: false,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 5.5, grade: "C", confidencePct: 48, edgePct: 1.5, scores: {} as never },
};

function leg(
  pick: { game: string; market: string; pick: string; odds: number; isProp?: boolean },
  score: typeof bTierScore,
  rank = 80,
): BoardScoredLeg {
  return {
    pick: { isProp: false, sport: "mlb", ...pick, finalAiScore: score },
    evPct: score.edgePct,
    edgePct: score.edgePct,
    confidencePct: score.confidencePct,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: score.grade,
    simHit: score.simHit,
    composite: score.composite,
    rankScore: rank,
  };
}

test("positiveEdgeScoredLegs keeps sim-graded legs with positive edge", () => {
  const scored = [leg({ game: "A @ B", market: "Spread", pick: "A -1.5", odds: -110 }, bTierScore)];
  assert.equal(positiveEdgeScoredLegs(scored).length, 1);
});

test("shouldSalvageCoachDelivery when delivery is short but pool has candidates", () => {
  const scored = Array.from({ length: 6 }, (_, i) =>
    leg({ game: `A${i} @ B${i}`, market: "Spread", pick: `A${i} -1.5`, odds: -110 }, bTierScore, 90 - i),
  );
  assert.ok(shouldSalvageCoachDelivery(0, 5, scored));
  assert.ok(!shouldSalvageCoachDelivery(5, 5, scored));
});

test("salvageCoachDelivery fills target from medium-confidence pool", () => {
  const scored = Array.from({ length: 8 }, (_, i) =>
    leg({ game: `E${i} @ F${i}`, market: "Total", pick: `Over ${7 + i}.5`, odds: -110 }, mediumScore, 80 - i),
  );
  const result = salvageCoachDelivery({
    scored,
    target: 5,
    stagedPicks: [],
    varietySeed: "medium-salvage",
  });
  assert.ok(result.picks.length > 0, "salvage must return picks when positive-edge pool exists");
  assert.ok(result.relaxationsApplied.length > 0);
});
