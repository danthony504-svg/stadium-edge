import assert from "node:assert/strict";
import { test } from "node:test";

import {
  americanToImplied,
  combinePickScore,
  gradeFromComposite,
  injuryFavorGame,
  injuryFavorProp,
  lineShoppingAdvantage,
  matchupAlignment,
  playerTrendMomentum,
  scoreInjury,
  scoreLineShopping,
  scoreLineValue,
  scoreMatchup,
  scoreTrend,
  teamTrendMomentum,
  winChancePct,
  type PickSubScores,
} from "./pickScore.ts";

test("americanToImplied: standard conversions", () => {
  assert.equal(Math.round((americanToImplied(-110) as number) * 1000), 524);
  assert.equal(Math.round((americanToImplied(100) as number) * 1000), 500);
  assert.equal(Math.round((americanToImplied(200) as number) * 1000), 333);
  assert.equal(americanToImplied(0), null);
  assert.equal(americanToImplied(null), null);
});

test("winChancePct: implied(odds) + edge, honest-null + clamped 5-95", () => {
  // -110 (52.38% implied) + 6.8 edge = 59% (de-vigged fair win chance).
  assert.equal(winChancePct(-110, 6.8), 59);
  // A coin-flip price with no edge reads ~50%, not an inflated number.
  assert.equal(winChancePct(-110, 0), 52);
  // No real price OR no real edge -> null (we never assert a win chance).
  assert.equal(winChancePct(null, 6.8), null);
  assert.equal(winChancePct(-110, null), null);
  // Clamped so nothing reads as a certainty / impossibility.
  assert.equal(winChancePct(-5000, 5), 95);
  assert.equal(winChancePct(1000, -20), 5);
});

test("winChancePct: fairProb (no-vig win prob) wins over price+edge, even with null edge", () => {
  // A real no-vig fair win prob is the honest win chance — used directly.
  assert.equal(winChancePct(-110, null, 0.58), 58);
  // The non-+EV side of a main market has NO edge but DOES carry a fair prob,
  // so it still reads a real win chance instead of "—".
  assert.equal(winChancePct(-110, null, 0.46), 46);
  // fairProb is preferred even when an edge is also present.
  assert.equal(winChancePct(-110, 6.8, 0.55), 55);
  // Clamped 5-95 so nothing reads as a certainty.
  assert.equal(winChancePct(-2000, null, 0.99), 95);
  assert.equal(winChancePct(800, null, 0.01), 5);
  // Invalid fairProb falls back to the price+edge basis.
  assert.equal(winChancePct(-110, 6.8, 0), 59);
  assert.equal(winChancePct(-110, 6.8, 1.5), 59);
  assert.equal(winChancePct(-110, 6.8, null), 59);
  // Invalid fairProb AND no edge basis -> null.
  assert.equal(winChancePct(-110, null, null), null);
});

test("scoreLineValue: null edge -> null; mirrors 5.5 + edge*0.45", () => {
  assert.equal(scoreLineValue(null), null);
  assert.equal(scoreLineValue(undefined), null);
  assert.equal(scoreLineValue(0), 5.5);
  assert.equal(scoreLineValue(6.8), 8.6);
  // Clamped at 9.9 on the high end and 1 on the low end.
  assert.equal(scoreLineValue(50), 9.9);
  assert.equal(scoreLineValue(-50), 1);
});

test("scoreLineShopping: 0 advantage is fair (5.0), scales up, null safe", () => {
  assert.equal(scoreLineShopping(null), null);
  assert.equal(scoreLineShopping(0), 5);
  assert.equal(scoreLineShopping(2), 7.4);
  assert.equal(scoreLineShopping(20), 10);
});

test("scoreMatchup: null aligned -> null; on-side positive, against negative", () => {
  assert.equal(scoreMatchup(null, 3), null);
  assert.equal(scoreMatchup(0, 3), 5.5);
  assert.equal(scoreMatchup(1, 5), 9); // 5.5 + 5*0.7
  assert.equal(scoreMatchup(-1, 5), 2); // 5.5 - 3.5
  // leanEdge is capped at 5 so a huge number cannot peg it past 9.
  assert.equal(scoreMatchup(1, 100), 9);
});

test("scoreTrend / scoreInjury: centered, clamped, null safe", () => {
  assert.equal(scoreTrend(null), null);
  assert.equal(scoreTrend(0), 5.5);
  assert.equal(scoreTrend(1), 9);
  assert.equal(scoreTrend(-1), 2);
  assert.equal(scoreInjury(null), null);
  assert.equal(scoreInjury(0), 5.5);
  assert.equal(scoreInjury(1), 8.5);
});

test("matchupAlignment: aligns the pick team to the lean side", () => {
  const lean = { side: "Boston Celtics", edge: 3 };
  assert.deepEqual(matchupAlignment(lean, "Celtics"), { aligned: 1, leanEdge: 3 });
  assert.deepEqual(matchupAlignment(lean, "Lakers"), { aligned: -1, leanEdge: 3 });
  // No lean / no pick side -> omitted.
  assert.equal(matchupAlignment(null, "Celtics").aligned, null);
  assert.equal(matchupAlignment(lean, null).aligned, null);
  // edge <= 0 means no real lean (coin flip).
  assert.equal(matchupAlignment({ side: "Celtics", edge: 0 }, "Celtics").aligned, 0);
});

test("teamTrendMomentum: win streak + positive margin is positive", () => {
  assert.equal(teamTrendMomentum(null, null), null);
  // 5-game W streak (0.6) + margin 15 (0.4) -> 1.0
  assert.equal(teamTrendMomentum({ type: "W", count: 5 }, 15), 1);
  // L streak + negative margin -> negative
  assert.ok((teamTrendMomentum({ type: "L", count: 4 }, -10) as number) < 0);
  // margin only still works
  assert.ok((teamTrendMomentum(null, 7.5) as number) > 0);
});

test("playerTrendMomentum: hit-rate vs line for the picked side", () => {
  // 4 of 5 over a 24.5 line, Over pick -> 0.8 rate -> +0.6
  assert.equal(playerTrendMomentum([28, 30, 22, 26, 31], 24.5, "Over"), 0.6);
  // Same sample, Under pick -> inverted -> -0.6
  assert.equal(playerTrendMomentum([28, 30, 22, 26, 31], 24.5, "Under"), -0.6);
  // No line or no sample -> null
  assert.equal(playerTrendMomentum([28, 30], null, "Over"), null);
  assert.equal(playerTrendMomentum([], 24.5, "Over"), null);
});

test("injuryFavorGame: favors the pick when its side is healthier", () => {
  assert.equal(injuryFavorGame(null, true), null);
  assert.equal(injuryFavorGame({ side: "neutral", magnitude: 0 }, true), 0);
  // Home edge, pick is home -> positive
  assert.ok((injuryFavorGame({ side: "home", magnitude: 3 }, true) as number) > 0);
  // Home edge, pick is away -> negative
  assert.ok((injuryFavorGame({ side: "home", magnitude: 3 }, false) as number) < 0);
});

test("injuryFavorProp: opponent injuries gently favor Over, null on Yes", () => {
  assert.ok((injuryFavorProp(4, "Over") as number) > 0);
  assert.ok((injuryFavorProp(4, "Under") as number) < 0);
  assert.equal(injuryFavorProp(4, "Yes"), null);
  assert.equal(injuryFavorProp(null, "Over"), null);
  // Capped gentle: max favor is 0.5 even with many injuries.
  assert.equal(injuryFavorProp(10, "Over"), 0.5);
});

test("lineShoppingAdvantage: best vs median implied, needs 2+ books", () => {
  assert.equal(lineShoppingAdvantage([-110]), null);
  // -105 is the best (lowest implied) vs a median around -115; small positive adv.
  const adv = lineShoppingAdvantage([-105, -115, -120]) as number;
  assert.ok(adv > 0);
  // All identical -> no advantage.
  assert.equal(lineShoppingAdvantage([-110, -110, -110]), 0);
});

test("combinePickScore: renormalizes over present scores only", () => {
  const all: PickSubScores = {
    matchup: 8,
    trend: 7,
    lineValue: 9,
    injury: 6,
    lineShopping: 5,
  };
  const full = combinePickScore(all, 7.8, -110);
  // Weighted: .25*8 + .2*7 + .3*9 + .15*6 + .1*5 = 2+1.4+2.7+0.9+0.5 = 7.5
  assert.equal(full.composite, 7.5);
  assert.equal(full.grade, "B+");
  assert.equal(full.edgePct, 7.8);
  // Confidence is the de-vigged win chance, INDEPENDENT of the value composite:
  // implied(-110)=52.38% + 7.8 edge = 60%.
  assert.equal(full.confidencePct, 60);

  // Only line value present -> composite equals that score (renormalized to 1).
  const partial = combinePickScore(
    { matchup: null, trend: null, lineValue: 8.6, injury: null, lineShopping: null },
    6.8,
  );
  assert.equal(partial.composite, 8.6);
  assert.equal(partial.grade, "A");

  // A pick on the non-+EV side of a main market: NO edge (so grade falls to the
  // other present sub-scores) but a real no-vig fair prob still grounds a real
  // Confidence instead of "—".
  const noEdgeSide = combinePickScore(
    { matchup: 7, trend: null, lineValue: null, injury: null, lineShopping: null },
    null,
    -110,
    0.46,
  );
  assert.equal(noEdgeSide.composite, 7);
  assert.equal(noEdgeSide.edgePct, null);
  assert.equal(noEdgeSide.confidencePct, 46);

  // Nothing present -> null everything except a null edge.
  const none = combinePickScore(
    { matchup: null, trend: null, lineValue: null, injury: null, lineShopping: null },
    null,
  );
  assert.equal(none.composite, null);
  assert.equal(none.grade, null);
  assert.equal(none.confidencePct, null);
  assert.equal(none.edgePct, null);
});

test("gradeFromComposite: threshold boundaries", () => {
  assert.equal(gradeFromComposite(null), null);
  assert.equal(gradeFromComposite(9.0), "A+");
  assert.equal(gradeFromComposite(7.0), "B");
  assert.equal(gradeFromComposite(5.5), "C");
  assert.equal(gradeFromComposite(4.0), "D");
  assert.equal(gradeFromComposite(3.9), "F");
});
