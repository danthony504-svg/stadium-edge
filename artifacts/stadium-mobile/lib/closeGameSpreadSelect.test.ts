import assert from "node:assert/strict";
import test from "node:test";
import {
  COMFORTABLE_WIN_SIM_MIN,
  filterRowsForCloseGameSpread,
  isAggressiveSpreadEntry,
  isSaferSpreadEntry,
  selectBestSaferLineForCloseGame,
  selectBestSpreadLineForOpenGame,
  selectBestTeamSpreadLine,
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

test("isAggressiveSpreadEntry flags -2 and deeper lays", () => {
  assert.equal(
    isAggressiveSpreadEntry({
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Alt Spread",
      pick: "Braves -2",
      odds: 191,
    }),
    true,
  );
  assert.equal(
    isSaferSpreadEntry({
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Alt Spread",
      pick: "Braves +1.5",
      odds: -190,
    }),
    true,
  );
  assert.equal(
    isSaferSpreadEntry({
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Spread",
      pick: "Braves -1.5",
      odds: -110,
    }),
    false,
  );
});

test("close game prefers higher win-probability safer line over aggressive alt", () => {
  const best = selectBestSaferLineForCloseGame([
    mockEvalRow("Alt Spread", "Braves -2", 3.5, 0.51),
    mockEvalRow("Alt Spread", "Braves +1.5", 1.4, 0.58),
    mockEvalRow("Spread", "Braves -1.5", 0.8, 0.5),
  ]);
  assert.equal(best?.entry.pick, "Braves +1.5");
});

test("close game can select moneyline when it has the best safer cover", () => {
  const best = selectBestSaferLineForCloseGame([
    mockEvalRow("Moneyline", "Braves ML", 1.2, 0.57),
    mockEvalRow("Alt Spread", "Braves +1.5", 1.4, 0.55),
  ]);
  assert.equal(best?.entry.market, "Moneyline");
});

test("open game rejects aggressive -2 without comfortable sim cover", () => {
  const best = selectBestSpreadLineForOpenGame([
    mockEvalRow("Alt Spread", "Braves -2", 2.8, 0.51),
    mockEvalRow("Alt Spread", "Braves +1.5", 1.1, 0.56),
  ]);
  assert.equal(best?.entry.pick, "Braves +1.5");
});

test("open game allows aggressive alt when sim projects comfortable cover", () => {
  const best = selectBestSpreadLineForOpenGame([
    mockEvalRow("Alt Spread", "Braves -2.5", 2.4, COMFORTABLE_WIN_SIM_MIN + 0.02),
    mockEvalRow("Alt Spread", "Braves +1.5", 1.0, 0.57),
  ]);
  assert.match(best?.entry.pick ?? "", /-2\.5/);
});

test("filterRowsForCloseGameSpread keeps safest +EV line on tight sim", () => {
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
      pick: "Braves -2",
      odds: 191,
      edge: 3.1,
    },
  ];
  const rows = [
    mockEvalRow("Spread", "Braves -1.5", 0.4, 0.49),
    mockEvalRow("Alt Spread", "Braves +1.5", 2.2, 0.58),
    mockEvalRow("Alt Spread", "Braves -2", 3.1, 0.51),
  ];
  const filtered = filterRowsForCloseGameSpread(rows, TIGHT_SIM, evalLines);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.entry.pick, "Braves +1.5");
});

test("filterRowsForCloseGameSpread drops team-sided lines when no safer +EV line exists", () => {
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
      pick: "Braves -2",
      odds: 191,
      edge: 1.5,
    },
  ];
  const rows = [
    mockEvalRow("Spread", "Braves -1.5", 0.4, 0.49),
    mockEvalRow("Alt Spread", "Braves -2", 1.5, 0.51),
    mockEvalRow("Total", "Over 8.5", 1.5, 0.56),
  ];
  const filtered = filterRowsForCloseGameSpread(rows, TIGHT_SIM, evalLines);
  assert.equal(filtered.length, 1);
  assert.match(filtered[0]!.entry.market, /Total/i);
});

test("selectBestTeamSpreadLine uses safer policy on close sim", () => {
  const evalLines = [
    {
      sport: "mlb",
      game: TIGHT_GAME,
      market: "Spread",
      pick: "Braves -1.5",
      odds: 168,
      edge: 0.4,
    },
  ];
  const rows = [
    mockEvalRow("Alt Spread", "Braves -2.5", 2.0, 0.52),
    mockEvalRow("Alt Spread", "Braves +2.5", 1.0, 0.61),
  ];
  const best = selectBestTeamSpreadLine(rows, TIGHT_SIM, evalLines, "Braves", TIGHT_GAME);
  assert.equal(best?.entry.pick, "Braves +2.5");
});
