import test from "node:test";
import assert from "node:assert/strict";
import {
  assessSimMarketIntegrity,
  isExtremeSimHit,
  marketSupportsSimulation,
  normalizeMarketKey,
  parseMarketPeriod,
  pickHasSimGrade,
  sanitizeSimHitForGrade,
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

test("pickHasSimGrade allows extreme hits when mapping is valid", () => {
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, 0.58), true);
  assert.equal(pickHasSimGrade({ market: "Spread", sport: "nba" }, null), false);
  assert.equal(pickHasSimGrade({ market: "Mystery Market", sport: "nba" }, 0.6), false);
  // Extreme alone is not a rejection — mapping must be invalid or mismatched.
  assert.equal(
    pickHasSimGrade({ market: "Passing Yards", sport: "nfl", isProp: true }, 0.995),
    true,
  );
  assert.equal(
    pickHasSimGrade({ market: "Passing Yards", sport: "nfl", isProp: true }, 0.005),
    true,
  );
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

test("assessSimMarketIntegrity rejects period→full-game fallback", () => {
  const d = assessSimMarketIntegrity(0.995, {
    market: "2H Total",
    sport: "nfl",
    period: "h2",
    periodUsed: "fg",
    line: 23.5,
    simulationStatKey: "fg:game_total:over",
    mappingFallbackUsed: true,
    mappingFallbackChangesMeaning: true,
  });
  assert.equal(d.accept, false);
  assert.match(d.reason, /period_mapped_to_full_game|mapping_fallback/);
});

test("assessSimMarketIntegrity rejects NFL game total outside plausible band", () => {
  const d = assessSimMarketIntegrity(0.999, {
    market: "Total",
    sport: "nfl",
    period: "fg",
    periodUsed: "fg",
    line: 23.5,
    simulationStatKey: "fg:game_total:over",
    expectedStatKey: "fg:game_total:over",
    simulatedMean: 52,
    simulatedMedian: 52,
    simulatedStdev: 6,
  });
  assert.equal(d.accept, false);
  assert.match(d.reason, /line_outside_reasonable_range_for_game_total/);
});

test("assessSimMarketIntegrity accepts legitimate extreme prop", () => {
  const d = assessSimMarketIntegrity(0.992, {
    market: "Passing Yards",
    sport: "nfl",
    isProp: true,
    period: "fg",
    periodUsed: "fg",
    line: 150.5,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
    simulatedMean: 275,
    simulatedMedian: 274,
    simulatedStdev: 42,
  });
  assert.equal(d.accept, true);
  assert.equal(d.reason, "extreme_sim_hit_mapping_valid");
  assert.equal(
    sanitizeSimHitForGrade(0.992, {
      market: "Passing Yards",
      sport: "nfl",
      isProp: true,
      line: 150.5,
      simulationStatKey: "player_prop",
      expectedStatKey: "player_prop",
      simulatedMean: 275,
      simulatedStdev: 42,
    }),
    0.992,
  );
});

test("assessSimMarketIntegrity accepts legitimate extreme Under when mapping valid", () => {
  const d = assessSimMarketIntegrity(0.008, {
    market: "Receiving Yards",
    sport: "ncaaf",
    isProp: true,
    period: "fg",
    line: 120.5,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
    simulatedMean: 48,
    simulatedMedian: 47,
    simulatedStdev: 18,
  });
  assert.equal(d.accept, true);
  assert.equal(isExtremeSimHit(0.008), true);
  assert.equal(
    sanitizeSimHitForGrade(0.008, {
      market: "Receiving Yards",
      sport: "ncaaf",
      isProp: true,
      line: 120.5,
      simulationStatKey: "player_prop",
      expectedStatKey: "player_prop",
      simulatedMean: 48,
      simulatedStdev: 18,
    }),
    0.008,
  );
});

test("normalizeMarketKey is stable for integrity logs", () => {
  assert.equal(
    normalizeMarketKey("Team Total", { sport: "nfl" }),
    "teamTotal|fg|team total",
  );
});
