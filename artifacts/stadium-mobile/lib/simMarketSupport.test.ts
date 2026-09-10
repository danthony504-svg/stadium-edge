import test from "node:test";
import assert from "node:assert/strict";
import {
  marketSupportsSimulation,
  parseMarketPeriod,
  pickHasSimGrade,
  simMarketMappingIsValid,
  simModelForMarket,
} from "./simMarketSupport.ts";

test("parseMarketPeriod detects quarters and innings", () => {
  assert.equal(parseMarketPeriod("Q2 Spread"), "q2");
  assert.equal(parseMarketPeriod("F5 Total"), "f5");
  assert.equal(parseMarketPeriod("1st Inning Total"), "i1");
});

test("simModelForMarket maps market families to models", () => {
  assert.equal(simModelForMarket("Spread", { sport: "nba" }), "fullGame");
  assert.equal(simModelForMarket("Q1 Total", { sport: "nba" }), "period");
  assert.equal(simModelForMarket("Race To 20", { sport: "nba" }), "raceTo");
  assert.equal(simModelForMarket("Team Total", { sport: "nba" }), "teamTotal");
  assert.equal(simModelForMarket("Points", { isProp: true }), "playerProp");
});

test("pickHasSimGrade requires finite non-extreme sim hit for supported markets", () => {
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, 0.58), true);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, null), false);
  assert.equal(pickHasSimGrade({ market: "Mystery Market", sport: "nba" }, 0.6), false);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, 0.995), false);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, 0.005), false);
});

test("simMarketMappingIsValid rejects unsupported period×sport pairs", () => {
  assert.equal(simMarketMappingIsValid({ market: "Q1 Total", sport: "nba" }), true);
  assert.equal(simMarketMappingIsValid({ market: "Q1 Total", sport: "soccer" }), false);
  assert.equal(simMarketMappingIsValid({ market: "F5 Total", sport: "mlb" }), true);
  assert.equal(simMarketMappingIsValid({ market: "F5 Total", sport: "nba" }), false);
});

test("marketSupportsSimulation rejects unknown game markets", () => {
  assert.equal(marketSupportsSimulation("Both Teams To Score", { sport: "soccer" }), false);
});
