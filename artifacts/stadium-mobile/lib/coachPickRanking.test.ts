import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  coachFinalScoresNear,
  compareCoachPicksByFinalScore,
  computeCoachFinalScore,
  COACH_FINAL_SCORE_TIE_PCT,
} from "./coachPickRanking.ts";

function basePick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "A @ B",
    market: "Hits",
    pick: "Player Over 1.5 Hits",
    odds: -110,
    isProp: true,
    player: "Player",
    finalAiScore: {
      composite: 7,
      grade: "B",
      confidencePct: 62,
      edgePct: 3,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {
          matchup: 7,
          trend: 6,
          lineValue: 7.5,
          injury: 6.5,
          lineShopping: 7,
          simulation: 7,
        },
        composite: 7,
        grade: "B",
        confidencePct: 62,
        edgePct: 3,
      },
    },
    scores: {
      scores: {
        matchup: 7,
        trend: 6,
        lineValue: 7.5,
        injury: 6.5,
        lineShopping: 7,
        simulation: 7,
      },
      composite: 7,
      grade: "B",
      confidencePct: 62,
      edgePct: 3,
    },
    ...overrides,
  };
}

test("computeCoachFinalScore blends rubric factors", () => {
  const score = computeCoachFinalScore(basePick());
  assert.ok(score != null && score > 5 && score <= 10);
});

test("coachFinalScoresNear detects 1-2% band", () => {
  assert.equal(coachFinalScoresNear(7.0, 7.1), true);
  assert.equal(coachFinalScoresNear(7.0, 7.3), false);
  assert.ok(COACH_FINAL_SCORE_TIE_PCT >= 0.01 && COACH_FINAL_SCORE_TIE_PCT <= 0.02);
});

test("compareCoachPicksByFinalScore prefers higher confidence on near tie", () => {
  const a = basePick({
    finalAiScore: {
      ...basePick().finalAiScore!,
      confidencePct: 55,
      composite: 7,
    },
  });
  const b = basePick({
    finalAiScore: {
      ...basePick().finalAiScore!,
      confidencePct: 62,
      composite: 7.05,
    },
  });
  assert.ok(compareCoachPicksByFinalScore(a, b) > 0);
});

test("compareCoachPicksByFinalScore prefers lower diversity load on close scores", () => {
  const a = basePick({ game: "Game A" });
  const b = basePick({ game: "Game B" });
  const cmp = compareCoachPicksByFinalScore(a, b, {
    diversityLoad: (p) => (p.game === "Game A" ? 2 : 0),
  });
  assert.ok(cmp > 0);
});
