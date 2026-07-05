import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRowsForCloseGameSpread,
  selectBestCloseGameAltSpread,
  type CloseGameSpreadRow,
} from "./closeGameSpreadSelect.ts";

function mockEvalRow(
  market: string,
  pick: string,
  edge: number,
  winProb: number,
  game = "New York Mets @ Atlanta Braves",
): CloseGameSpreadRow {
  const qualified = winProb >= 0.52 && edge >= 0;
  return {
    entry: {
      sport: "mlb",
      game,
      market,
      pick,
      odds: -110,
      edge,
    },
    finalAiScore: {
      composite: 7,
      grade: "B",
      confidencePct: 55,
      edgePct: edge,
      simHit: winProb,
      simAligned: qualified,
      highRiskValuePlay: false,
      recommends: qualified,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "B", confidencePct: 55, edgePct: edge },
    },
    winProb,
    edgePct: edge,
  };
}

const TIGHT_GAME = "New York Mets @ Atlanta Braves";
const TIGHT_SIM = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.494,
  awayWinProbability: 0.506,
  tieProbability: 0,
  homeProjectedScore: 4.5,
  awayProjectedScore: 4.52,
  mostLikelyWinner: "away" as const,
  mostLikelyWinnerPct: 0.506,
  confidenceScore: 50,
};

test("selectBestCloseGameAltSpread ranks edge then win probability", () => {
  const best = selectBestCloseGameAltSpread([
    mockEvalRow("Alt Spread", "Braves +1.5", 2.2, 0.58),
    mockEvalRow("Alt Spread", "Braves +2.5", 1.1, 0.62),
  ]);
  assert.equal(best?.entry.pick, "Braves +1.5");
});

test("filterRowsForCloseGameSpread keeps highest-edge alt spread on tight sim", () => {
  const evalLines = [
    {
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Spread",
      pick: "Braves -1.5",
      odds: 168,
      edge: 0.4,
    },
    {
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Alt Spread",
      pick: "Braves +1.5",
      odds: -190,
      edge: 2.2,
    },
    {
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Alt Spread",
      pick: "Braves +2.5",
      odds: -250,
      edge: 1.1,
    },
  ];
  const rows = [
    mockEvalRow("Spread", "Braves -1.5", 0.4, 0.49),
    mockEvalRow("Alt Spread", "Braves +1.5", 2.2, 0.58),
    mockEvalRow("Alt Spread", "Braves +2.5", 1.1, 0.62),
  ];
  const filtered = filterRowsForCloseGameSpread(rows, TIGHT_SIM, evalLines);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.entry.pick, "Braves +1.5");
});

test("filterRowsForCloseGameSpread drops team-sided lines when no +EV alt exists", () => {
  const evalLines = [
    {
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Spread",
      pick: "Braves -1.5",
      odds: 168,
      edge: 0.4,
    },
    {
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Alt Spread",
      pick: "Braves +1.5",
      odds: -190,
      edge: -0.5,
    },
  ];
  const rows = [
    mockEvalRow("Spread", "Braves -1.5", 0.4, 0.49),
    mockEvalRow("Alt Spread", "Braves +1.5", -0.5, 0.55),
    mockEvalRow("Total", "Over 8.5", 1.5, 0.56),
  ];
  const filtered = filterRowsForCloseGameSpread(rows, TIGHT_SIM, evalLines);
  assert.equal(filtered.length, 1);
  assert.match(filtered[0]!.entry.market, /Total/i);
});
