import assert from "node:assert/strict";
import test from "node:test";
import {
  alternateOverallValueScore,
  isBuriedChalk,
  metricsForAlternate,
  payoutProfitPerDollar,
} from "./coachAltValueScore.ts";

test("isBuriedChalk rejects -850 alt spread juice", () => {
  assert.equal(isBuriedChalk(-850), true);
  assert.equal(isBuriedChalk(-500), true);
});

test("isBuriedChalk allows standard -110 and plus-money lines", () => {
  assert.equal(isBuriedChalk(-110), false);
  assert.equal(isBuriedChalk(+150), false);
  assert.equal(isBuriedChalk(-350), false);
});

test("payoutProfitPerDollar rewards plus money over heavy chalk", () => {
  assert.ok(payoutProfitPerDollar(+150) > payoutProfitPerDollar(-110));
  assert.ok(payoutProfitPerDollar(-110) > payoutProfitPerDollar(-850));
});

test("alternateOverallValueScore prefers higher EV/payout over safer hit rate", () => {
  const safeChalk = {
    odds: -850,
    isProp: false,
    pick: "Angels +4.5",
    finalAiScore: {
      edgePct: 0.8,
      grade: "C+",
      confidencePct: 55,
      simHit: 0.92,
    },
  };
  const valueLine = {
    odds: +140,
    isProp: false,
    pick: "Angels ML",
    finalAiScore: {
      edgePct: 3.2,
      grade: "B",
      confidencePct: 58,
      simHit: 0.48,
    },
  };

  const chalkScore = alternateOverallValueScore(safeChalk as never, null, null);
  const valueScore = alternateOverallValueScore(valueLine as never, null, null);

  assert.equal(chalkScore, null, "buried chalk excluded even with high hit");
  assert.ok(valueScore != null && valueScore > 0);
});

test("metricsForAlternate requires positive EV not just edge", () => {
  const thinEdge = {
    odds: -200,
    isProp: false,
    pick: "Team ML",
    finalAiScore: {
      edgePct: 0.5,
      grade: "C+",
      confidencePct: 52,
      simHit: 0.66,
    },
  };
  const m = metricsForAlternate(thinEdge as never, null, null);
  assert.equal(m, null, "positive edge with non-positive EV should not qualify");
});
