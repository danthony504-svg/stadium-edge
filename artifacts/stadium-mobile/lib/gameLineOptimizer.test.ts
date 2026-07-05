import assert from "node:assert/strict";
import test from "node:test";
import {
  bestGameLine,
  mergeOddsEntries,
  gameLabelsMatch,
  buildGameLineOptimizerNote,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";

function mockEval(composite: number, edge: number, winProb: number): EvaluatedGameLine {
  return {
    entry: {
      sport: "mlb",
      game: "A @ B",
      market: "Spread",
      pick: "B +1.5",
      odds: -110,
      edge,
    },
    pick: { game: "A @ B", market: "Spread", pick: "B +1.5", odds: -110, isProp: false },
    finalAiScore: {
      composite,
      grade: "B+",
      confidencePct: 60,
      edgePct: edge,
      simHit: winProb,
      simAligned: winProb >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite, grade: "B+", confidencePct: 60, edgePct: edge },
    },
    winProb,
    edgePct: edge,
  };
}

test("bestGameLine picks highest Final AI composite", () => {
  const best = bestGameLine([
    mockEval(7.2, 1.5, 0.55),
    mockEval(8.1, 0.5, 0.62),
    mockEval(7.8, 3.0, 0.48),
  ]);
  assert.equal(best?.finalAiScore.composite, 8.1);
});

test("bestGameLine tie-breaks on edge then win prob", () => {
  const best = bestGameLine([mockEval(8.0, 1.0, 0.54), mockEval(8.0, 2.5, 0.51)]);
  assert.equal(best?.edgePct, 2.5);
});

test("mergeOddsEntries prefers later eval-line edge over chat context", () => {
  const merged = mergeOddsEntries(
    [{ sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +1.5", odds: -110, edge: null }],
    [{ sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +1.5", odds: -105, edge: 2.1 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.odds, -105);
  assert.equal(merged[0]?.edge, 2.1);
});

test("gameLabelsMatch accepts nickname vs full team names", () => {
  assert.equal(
    gameLabelsMatch("Mets @ Braves", "New York Mets @ Atlanta Braves"),
    true,
  );
  assert.equal(
    gameLabelsMatch("New York Mets @ Atlanta Braves", "New York Mets @ Atlanta Braves"),
    true,
  );
  assert.equal(gameLabelsMatch("Yankees @ Red Sox", "Mets @ Braves"), false);
});

test("buildGameLineOptimizerNote omits sub-52% game lines from transparency note", () => {
  const picks = [
    {
      game: "New York Mets @ Atlanta Braves",
      market: "Spread",
      pick: "Atlanta Braves -1.5",
      odds: -110,
      isProp: false,
      sport: "mlb",
      finalAiScore: {
        grade: "C+",
        simHit: 0.49,
        edgePct: 0.5,
        composite: 6.5,
        confidencePct: 52,
        simAligned: false,
        highRiskValuePlay: false,
        recommends: false,
        factors: [],
        rubric: { scores: {}, composite: 6.5, grade: "C+", confidencePct: 52, edgePct: 0.5 },
      },
    },
  ];
  const note = buildGameLineOptimizerNote(picks, new Map(), {
    evalLinesByGame: new Map(),
    realOdds: [],
  });
  assert.equal(note, "");
});

test("buildGameLineOptimizerNote lists only final ticket legs with scores", () => {
  const picks = [
    {
      game: "New York Mets @ Atlanta Braves",
      market: "Spread",
      pick: "New York Mets +1.5",
      odds: 110,
      isProp: false,
      sport: "mlb",
      finalAiScore: {
        grade: "B+",
        simHit: 0.58,
        edgePct: 2.1,
        composite: 8,
        confidencePct: 60,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: { scores: {}, composite: 8, grade: "B+", confidencePct: 60, edgePct: 2.1 },
      },
      gameLineFinal: {
        reason: "Selected because it had the highest Final Score.",
        finalScore: 72,
      },
    },
  ];
  const note = buildGameLineOptimizerNote(picks, new Map(), {
    evalLinesByGame: new Map(),
    realOdds: [],
  });
  assert.match(note, /New York Mets \+1\.5/);
  assert.match(note, /Final Score 72/);
  assert.match(note, /sim 58%/);
  assert.match(note, /edge \+2\.1%/);
  assert.doesNotMatch(note, /\[box/i);
});

test("buildGameLineOptimizerNote fuzzy-matches nickname spread sim and edge", () => {
  const GAME = "Minnesota Twins @ New York Yankees";
  const picks = [
    {
      game: GAME,
      market: "Spread",
      pick: "Twins +1.5",
      odds: -110,
      isProp: false,
      sport: "mlb",
      finalAiScore: {
        grade: "B",
        simHit: 0.54,
        edgePct: 1.8,
        composite: 7.5,
        confidencePct: 55,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: { scores: {}, composite: 7.5, grade: "B", confidencePct: 55, edgePct: 1.8 },
      },
      gameLineFinal: {
        reason: "Selected because it had the highest Final Score.",
        finalScore: 65,
      },
    },
  ];
  const simByGame = new Map([
    [
      GAME,
      {
        sport: "mlb",
        simulations: 10_000,
        homeWinProbability: 0.55,
        awayWinProbability: 0.45,
        tieProbability: 0,
        homeProjectedScore: 5,
        awayProjectedScore: 4,
        mostLikelyWinner: "home" as const,
        mostLikelyWinnerPct: 0.55,
        confidenceScore: 55,
        coverHitRates: {
          [`${GAME.toLowerCase()}|spread|minnesota twins +1.5`]: 0.54,
        },
      },
    ],
  ]);
  const note = buildGameLineOptimizerNote(picks, simByGame, {
    evalLinesByGame: new Map([
      [
        GAME,
        [
          {
            sport: "mlb",
            game: GAME,
            market: "Spread",
            pick: "Minnesota Twins +1.5",
            odds: -110,
            edge: 1.8,
          },
        ],
      ],
    ]),
    realOdds: [],
  });
  assert.match(note, /sim 54%/);
  assert.match(note, /edge \+1\.8%/);
  assert.doesNotMatch(note, /sim —/);
  assert.doesNotMatch(note, /edge —/);
});

test("buildGameLineOptimizerNote resolves Cubs nickname spread from alt ladder", () => {
  const GAME = "St. Louis Cardinals @ Chicago Cubs";
  const picks = [
    {
      game: GAME,
      market: "Spread",
      pick: "Cubs -1.5",
      odds: -110,
      isProp: false,
      sport: "mlb",
      finalAiScore: {
        grade: "C+",
        simHit: 0.56,
        edgePct: 1.5,
        composite: 7.2,
        confidencePct: 54,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: { scores: {}, composite: 7.2, grade: "C+", confidencePct: 54, edgePct: 1.5 },
      },
      gameLineFinal: {
        reason: "Selected because it had the highest Final Score.",
        finalScore: 64,
      },
    },
  ];
  const simByGame = new Map([
    [
      GAME,
      {
        sport: "mlb",
        simulations: 10_000,
        homeWinProbability: 0.56,
        awayWinProbability: 0.44,
        tieProbability: 0,
        homeProjectedScore: 5,
        awayProjectedScore: 3.5,
        mostLikelyWinner: "home" as const,
        mostLikelyWinnerPct: 0.56,
        confidenceScore: 56,
        coverHitRates: {
          [`${GAME.toLowerCase()}|alt spread|chicago cubs -1.5`]: 0.56,
        },
      },
    ],
  ]);
  const note = buildGameLineOptimizerNote(picks, simByGame, {
    evalLinesByGame: new Map([
      [
        GAME,
        [
          {
            sport: "mlb",
            game: GAME,
            market: "Alt Spread",
            pick: "Chicago Cubs -1.5",
            odds: -110,
            edge: 1.5,
          },
        ],
      ],
    ]),
    realOdds: [],
  });
  assert.match(note, /sim 56%/);
  assert.match(note, /edge \+1\.5%/);
  assert.doesNotMatch(note, /sim —/);
});

test("buildGameLineOptimizerNote uses attachPickScores simHit on final ticket pick", () => {
  const GAME = "St. Louis Cardinals @ Chicago Cubs";
  const picks = [
    {
      game: GAME,
      market: "Spread",
      pick: "Cubs -1.5",
      odds: -110,
      isProp: false,
      sport: "mlb",
      finalAiScore: {
        grade: "C+",
        simHit: 0.56,
        edgePct: 1.5,
        composite: 7.2,
        confidencePct: 54,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: { scores: {}, composite: 7.2, grade: "C+", confidencePct: 54, edgePct: 1.5 },
      },
      gameLineFinal: {
        reason: "Selected because it had the highest Final Score.",
        finalScore: 64,
      },
    },
  ];
  const note = buildGameLineOptimizerNote(picks, new Map(), {
    evalLinesByGame: new Map(),
    realOdds: [],
  });
  assert.match(note, /Cubs -1\.5/);
  assert.match(note, /sim 56%/);
  assert.match(note, /edge \+1\.5%/);
});

test("buildGameLineOptimizerNote never disagrees with finalized pick on card", () => {
  const pick = {
    game: "Boston Red Sox @ Los Angeles Angels",
    market: "Alt Spread",
    pick: "Los Angeles Angels +2",
    odds: -172,
    isProp: false,
    sport: "mlb",
    finalAiScore: {
      grade: "B-",
      simHit: 0.58,
      edgePct: 1.4,
      composite: 6.8,
      confidencePct: 52,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 6.8, grade: "B-", confidencePct: 52, edgePct: 1.4 },
    },
    gameLineFinal: {
      reason: "Main line rejected. Alt +2 selected — highest Final Score among safer +EV lines.",
      finalScore: 66,
    },
  };
  const note = buildGameLineOptimizerNote([pick], new Map(), {
    evalLinesByGame: new Map(),
    realOdds: [],
  });
  assert.match(note, /Angels \+2/);
  assert.doesNotMatch(note, /Red Sox -1\.5/);
});
