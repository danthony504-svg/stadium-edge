import test from "node:test";
import assert from "node:assert/strict";
import {
  marketSupportsSimulation,
  parseMarketPeriod,
  pickHasSimGrade,
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

test("pickHasSimGrade requires finite sim hit for supported markets", () => {
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, 0.58), true);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, null), false);
  assert.equal(pickHasSimGrade({ market: "Mystery Market", sport: "nba" }, 0.6), false);
});

test("marketSupportsSimulation rejects unknown game markets", () => {
  assert.equal(marketSupportsSimulation("Both Teams To Score", { sport: "soccer" }), false);
});
