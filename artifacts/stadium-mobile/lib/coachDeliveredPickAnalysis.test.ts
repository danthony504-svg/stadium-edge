import assert from "node:assert/strict";
import test from "node:test";
import {
  coachPickDisplayGrade,
  ensureCoachDeliveredPickAnalysis,
  ensureCoachDeliveredPickAnalyses,
} from "./coachDeliveredPickAnalysis.ts";
import { applyCoachTicketFallbackLadder } from "./coachTicketFallbackLadder.ts";
import { finalizeBoardBuiltCoachTicket, pickGradeDisplayLabel, NOT_AI_RECOMMENDED } from "./pickRecommendation.ts";
import { buildCoachCardHolistic } from "./propHolisticRecommendation.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "./parsedPick.ts";

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
  rubric: {
    composite: 6,
    grade: "B",
    confidencePct: 55,
    edgePct: 2,
    scores: {
      matchup: 5.8,
      trend: 5.5,
      lineValue: 6.2,
      injury: null,
      lineShopping: 5.9,
      simulation: 6.1,
    },
  },
};

const mediumPropScore = {
  ...bTierScore,
  grade: "C",
  confidencePct: 48,
  composite: 5.5,
  propHolistic: {
    composite: 5.5,
    grade: "C",
    confidencePct: 48,
    coveragePct: 42,
    missingCount: 3,
    applicableCount: 6,
    recommends: false,
    factors: [
      { key: "sportsbookValue", label: "EV", score: 5.6, applicable: true, present: true },
      { key: "simulation", label: "Sim", score: 5.8, applicable: true, present: true, display: "56% hit" },
      { key: "matchup", label: "Matchup", score: null, applicable: true, present: false },
      { key: "recentForm", label: "Form", score: null, applicable: true, present: false },
      { key: "injury", label: "Injuries", score: null, applicable: true, present: false },
      { key: "lineMovement", label: "Market", score: 5.4, applicable: true, present: true },
    ],
  },
};

test("delivered B-tier game line shows letter grade instead of Not Rec", () => {
  const pick: ParsedPick = {
    game: "A @ B",
    market: "Spread",
    pick: "A -3.5",
    odds: -110,
    isProp: false,
    sport: "nba",
    coachFillTier: "B",
    coachDelivered: true,
    finalAiScore: bTierScore,
  };
  assert.equal(pickGradeDisplayLabel(pick, pick.finalAiScore), "B");
  assert.notEqual(pickGradeDisplayLabel(pick, pick.finalAiScore), NOT_AI_RECOMMENDED);
});

test("medium-confidence delivered prop preserves holistic analysis", () => {
  const pick: ParsedPick = {
    game: "A @ B",
    market: "Points",
    pick: "Star Over 24.5 Points",
    odds: -110,
    isProp: true,
    player: "Star",
    sport: "nba",
    propLine: 24.5,
    propSide: "Over",
    coachConfidenceLabel: "Medium confidence",
    coachDelivered: true,
    coachDeliveryTier: 3,
    finalAiScore: mediumPropScore,
  };
  const enriched = ensureCoachDeliveredPickAnalysis(pick);
  assert.ok(enriched.finalAiScore?.propHolistic, "propHolistic must be preserved");
  assert.equal(coachPickDisplayGrade(enriched, enriched.finalAiScore), "C");
  assert.equal(pickGradeDisplayLabel(enriched, enriched.finalAiScore), "C");
  assert.ok((enriched.finalAiScore?.propHolistic?.missingCount ?? 0) > 0);
});

test("strict gate failure without delivery flag still shows Not Rec", () => {
  const pick: ParsedPick = {
    game: "A @ B",
    market: "Spread",
    pick: "A -3.5",
    odds: -110,
    isProp: false,
    sport: "nba",
    finalAiScore: {
      ...bTierScore,
      simAligned: false,
      grade: "C-",
      confidencePct: 40,
      edgePct: 0.5,
      recommends: false,
    },
  };
  assert.equal(pickGradeDisplayLabel(pick, pick.finalAiScore), NOT_AI_RECOMMENDED);
});

const fullRubricScores = {
  matchup: 5.8,
  trend: 5.5,
  lineValue: 6.2,
  injury: null as number | null,
  lineShopping: 5.9,
  simulation: 6.1,
};

function scoredLeg(
  pick: Partial<ParsedPick> & Pick<ParsedPick, "game" | "market" | "pick" | "odds">,
  finalAiScore: NonNullable<ParsedPick["finalAiScore"]>,
  rankScore = 80,
): BoardScoredLeg {
  const full: ParsedPick = { isProp: false, sport: "mlb", ...pick, finalAiScore };
  return {
    pick: full,
    evPct: finalAiScore.edgePct ?? 2,
    edgePct: finalAiScore.edgePct ?? 2,
    confidencePct: finalAiScore.confidencePct ?? 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: finalAiScore.grade ?? "B",
    simHit: finalAiScore.simHit ?? 0.55,
    composite: finalAiScore.composite ?? 6,
    rankScore,
  };
}

const fullQualityScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: {
    composite: 8,
    grade: "B+",
    confidencePct: 58,
    edgePct: 4,
    scores: { ...fullRubricScores, injury: 6.4 },
  },
};

const altLineScore = {
  composite: 6.5,
  grade: "B-",
  confidencePct: 51,
  edgePct: 2.5,
  simHit: 0.55,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 6.5, grade: "B-", confidencePct: 51, edgePct: 2.5, scores: fullRubricScores },
};

const mediumFallbackScore = {
  composite: 5.5,
  grade: "C",
  confidencePct: 48,
  edgePct: 1.5,
  simHit: 0.54,
  simAligned: false,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 5.5, grade: "C", confidencePct: 48, edgePct: 1.5, scores: fullRubricScores },
  propHolistic: mediumPropScore.propHolistic,
};

function assertCompleteCoachCardAnalysis(pick: ParsedPick) {
  const score = pick.finalAiScore;
  assert.ok(score, "finalAiScore required");
  assert.ok(score.simHit != null, "simulationHitRate required");
  assert.ok(score.edgePct != null, "edge required");
  assert.ok(score.confidencePct != null, "confidence required");
  assert.ok(score.grade, "aiGrade required");

  const enriched = ensureCoachDeliveredPickAnalysis(pick);
  const holistic = buildCoachCardHolistic(enriched) ?? enriched.finalAiScore?.propHolistic;
  assert.ok(holistic, "holistic analysis required");

  for (const key of ["sportsbookValue", "simulation", "matchup", "recentForm", "injury", "lineMovement"]) {
    const factor = holistic.factors.find((f) => f.key === key);
    assert.ok(factor?.applicable, `${key} row must be present on card`);
  }
  assert.ok(holistic.coveragePct != null, "contextGroundedPercent required");
  assert.ok(holistic.missingCount != null, "missingSignals required");

  const label = pickGradeDisplayLabel(enriched, enriched.finalAiScore);
  assert.notEqual(label, NOT_AI_RECOMMENDED, "delivered pick must not show Not Rec");
  assert.ok(label, "delivered pick must show a letter grade");
}

function finalizeFiveLegParlay(scored: BoardScoredLeg[], seed: string) {
  const { picks: ladderPicks } = applyCoachTicketFallbackLadder(scored, [], 5, seed);
  const { picks: delivered } = finalizeBoardBuiltCoachTicket(ladderPicks, {
    realOdds: [],
    propPool: [],
    gameMeta: [],
  });
  return delivered;
}

test("5-leg full-quality parlay keeps complete EV/Sim/Match/Form/Inj/Mkt rows", () => {
  const scored = Array.from({ length: 8 }, (_, i) =>
    scoredLeg(
      { game: `A${i} @ B${i}`, market: "Spread", pick: `A${i} -1.5`, odds: -110 },
      fullQualityScore,
      90 - i,
    ),
  );
  const delivered = finalizeFiveLegParlay(scored, "full-quality-5");
  assert.equal(delivered.length, 5);
  for (const pick of delivered) assertCompleteCoachCardAnalysis(pick);
});

test("5-leg alternate-line parlay keeps complete analysis rows", () => {
  const scored = Array.from({ length: 8 }, (_, i) =>
    scoredLeg(
      {
        game: `C${i} @ D${i}`,
        market: "Alt Spread",
        pick: `C${i} +4.5`,
        odds: -115,
        propIsAlt: true,
        ticketRole: "alt",
      },
      altLineScore,
      85 - i,
    ),
  );
  const delivered = finalizeFiveLegParlay(scored, "alt-line-5");
  assert.equal(delivered.length, 5);
  for (const pick of delivered) {
    assertCompleteCoachCardAnalysis(pick);
    assert.ok(pick.coachDeliveryTier === 3 || pick.coachAlternateLineLabel === "Alternate line");
  }
});

test("5-leg medium-confidence parlay keeps complete analysis rows", () => {
  const scored = Array.from({ length: 8 }, (_, i) =>
    scoredLeg(
      { game: `E${i} @ F${i}`, market: "Total", pick: `Over ${7 + i}.5`, odds: -110 },
      mediumFallbackScore,
      80 - i,
    ),
  );
  const delivered = finalizeFiveLegParlay(scored, "medium-confidence-5");
  assert.equal(delivered.length, 5);
  for (const pick of delivered) {
    assertCompleteCoachCardAnalysis(pick);
    assert.equal(pick.coachConfidenceLabel, "Medium confidence");
    assert.ok((pick.finalAiScore?.propHolistic?.missingCount ?? 0) > 0);
  }
});
