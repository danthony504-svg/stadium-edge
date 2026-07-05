import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_SIM_BAND_HIGH,
  CLOSE_SIM_BAND_LOW,
  GAME_LINE_FINAL_SCORE_WEIGHTS,
  computeGameLineFinalScore,
  computeGameLineFinalScoreBreakdown,
  expectedValuePct,
  isCloseSimBand,
  rankGameLineByFinalScore,
} from "./gameLineFinalScore.ts";
import type { CloseGameSpreadRow } from "./closeGameSpreadSelect.ts";
import { isGameLineMainTicketQualified } from "./parlayQualifiedGate.ts";

const GAME = "Milwaukee Brewers @ Arizona Diamondbacks";

function row(
  market: string,
  pick: string,
  odds: number,
  edge: number,
  winProb: number,
  bookSpread?: number | null,
): CloseGameSpreadRow {
  return {
    entry: {
      sport: "mlb",
      game: GAME,
      market,
      pick,
      odds,
      edge,
      bookSpread: bookSpread ?? null,
    },
    finalAiScore: {
      composite: 7,
      grade: "B",
      confidencePct: 62,
      edgePct: edge,
      simHit: winProb,
      simAligned: winProb >= 0.52,
      highRiskValuePlay: false,
      recommends: isGameLineMainTicketQualified(
        {
          composite: 7,
          grade: "B",
          confidencePct: 62,
          edgePct: edge,
          simHit: winProb,
          simAligned: winProb >= 0.52,
          highRiskValuePlay: false,
          recommends: true,
          factors: [],
          rubric: { scores: {}, composite: 7, grade: "B", confidencePct: 62, edgePct: edge },
        },
        odds,
        edge,
      ),
      factors: [],
      rubric: {
        scores: { lineShopping: 7 },
        composite: 7,
        grade: "B",
        confidencePct: 62,
        edgePct: edge,
      },
    },
    winProb,
    edgePct: edge,
  };
}

test("GAME_LINE_FINAL_SCORE_WEIGHTS sum to 1", () => {
  const sum = Object.values(GAME_LINE_FINAL_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
});

test("computeGameLineFinalScore weights EV highest", () => {
  const lowEv = row("Spread", "Brewers -1.5", -110, 0.8, 0.55);
  const highEv = row("Alt Spread", "Brewers +1.5", 110, 3.2, 0.55);
  assert.ok(computeGameLineFinalScore(highEv) > computeGameLineFinalScore(lowEv));
});

test("isCloseSimBand covers 48–52% coin-flip range", () => {
  assert.equal(isCloseSimBand(CLOSE_SIM_BAND_LOW), true);
  assert.equal(isCloseSimBand(0.5), true);
  assert.equal(isCloseSimBand(CLOSE_SIM_BAND_HIGH), true);
  assert.equal(isCloseSimBand(0.47), false);
  assert.equal(isCloseSimBand(0.53), false);
});

test("rankGameLineByFinalScore prefers higher composite score", () => {
  const a = row("Spread", "Brewers -1.5", -154, 0.4, 0.5);
  const b = row("Alt Spread", "Brewers +1.5", -130, 1.8, 0.58);
  assert.ok(rankGameLineByFinalScore(a, b) > 0);
});

test("expectedValuePct returns positive for +EV line", () => {
  const ev = expectedValuePct(0.55, -110, null, 2);
  assert.ok(ev != null && ev > 0);
});

test("breakdown includes all five components", () => {
  const breakdown = computeGameLineFinalScoreBreakdown(row("Moneyline", "Brewers ML", -105, 2, 0.56, 3));
  assert.ok(breakdown.normEv > 0);
  assert.ok(breakdown.normSim > 0);
  assert.ok(breakdown.normConfidence > 0);
  assert.ok(breakdown.normGrade > 0);
  assert.ok(breakdown.finalScore > 0);
});
