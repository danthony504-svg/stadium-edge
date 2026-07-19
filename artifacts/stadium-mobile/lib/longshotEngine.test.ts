import assert from "node:assert/strict";
import test from "node:test";
import { quickPropPrescore } from "./boardPropPrescore.ts";
import { isLongshotScan, longshotMarketBonus } from "./longshotEngine.ts";

test("quickPropPrescore returns positive total for edged prop", () => {
  const signals = quickPropPrescore({
    game: "A @ B",
    market: "Points",
    pick: "Over 24.5",
    odds: 150,
    isProp: true,
    sport: "nba",
    scores: {
      composite: 72,
      edgePct: 8,
      confidencePct: 60,
      grade: "B+",
      scores: { matchup: 7, lineShopping: 6 },
    },
  });
  assert.ok(signals.total > 0);
  assert.equal(signals.evEstimate, 8);
});

test("longshotMarketBonus favors alt props and plus-money", () => {
  const altHr = longshotMarketBonus({
    game: "A @ B",
    market: "Home Runs",
    pick: "Over 0.5",
    odds: 650,
    isProp: true,
    propIsAlt: true,
    sport: "mlb",
  });
  const chalkMl = longshotMarketBonus({
    game: "A @ B",
    market: "Moneyline",
    pick: "Team ML",
    odds: -180,
    isProp: false,
    sport: "mlb",
  });
  assert.ok(altHr > 30);
  assert.ok(chalkMl < 0);
});

test("isLongshotScan detects longshot ask and 15-leg builds", () => {
  assert.equal(isLongshotScan({ longshotAsk: true }), true);
  assert.equal(isLongshotScan({ ticketStyle: "longshot" }), true);
  assert.equal(isLongshotScan({ targetLegs: 15 }), true);
  assert.equal(isLongshotScan({ targetLegs: 5, ticketStyle: "balanced" }), false);
});
