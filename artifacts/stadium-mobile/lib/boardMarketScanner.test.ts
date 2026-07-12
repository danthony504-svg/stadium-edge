import test from "node:test";
import assert from "node:assert/strict";
import { augmentEvalLinesWithPostedOdds } from "./postedGameLineMerge.ts";
import { FULL_BOARD_MARKET_FAMILIES } from "./fullBoardMarketCopy.ts";
import { reachBoardScanEligible, shouldUseFullBoardScan, maxBoardPropSimForTarget } from "./boardMarketScanner.ts";

test("FULL_BOARD_MARKET_FAMILIES lists every period and combo market", () => {
  assert.match(FULL_BOARD_MARKET_FAMILIES, /live markets/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /race-to/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /second half/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /second quarter/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /third quarter/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /second period/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /third period/i);
  assert.match(FULL_BOARD_MARKET_FAMILIES, /combo props/i);
});

test("augmentEvalLinesWithPostedOdds merges posted game lines missing from eval ladder", () => {
  const evalLines = new Map([
    [
      "Lakers @ Suns",
      [{ sport: "nba", game: "Lakers @ Suns", market: "Spread", pick: "Lakers +3.5", odds: -110 }],
    ],
  ]);
  const realOdds = [
    { sport: "nba", game: "Lakers @ Suns", market: "2H Spread", pick: "Lakers +1.5", odds: -105 },
    { sport: "nba", game: "Lakers @ Suns", market: "Points", pick: "LeBron James Over 24.5", odds: -115 },
  ];
  const merged = augmentEvalLinesWithPostedOdds(evalLines, realOdds);
  const lines = merged.get("Lakers @ Suns") ?? [];
  assert.equal(lines.length, 2);
  assert.ok(lines.some((e) => e.market === "2H Spread"));
  assert.ok(!lines.some((e) => e.market === "Points"));
});

test("maxBoardPropSimForTarget scales prop sim depth with leg target", () => {
  assert.equal(maxBoardPropSimForTarget(6, 500), 168);
  assert.equal(maxBoardPropSimForTarget(15, 500), 420);
  assert.equal(maxBoardPropSimForTarget(15, 200), 200);
});

test("reachBoardScanEligible requires 6+ legs and no locks", () => {
  assert.equal(reachBoardScanEligible({ requestedLegs: 15 }), true);
  assert.equal(reachBoardScanEligible({ requestedLegs: 9 }), true);
  assert.equal(reachBoardScanEligible({ requestedLegs: 5 }), false);
  assert.equal(reachBoardScanEligible({ requestedLegs: 15, propsOnly: true }), false);
  assert.equal(shouldUseFullBoardScan(15, { requestedLegs: 15 }), true);
});
