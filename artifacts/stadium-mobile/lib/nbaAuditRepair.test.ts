import assert from "node:assert/strict";
import test from "node:test";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { marketLadderKey, dedupePicksByMarketLadder } from "./marketLadderKey.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

test("prop card edge uses its final probability and posted price, not an earlier edge", () => {
  for (const sport of ["nba", "wnba", "ncaab", "nfl", "mlb", "nhl", "soccer"]) {
    const pick = {sport, game:"Away @ Home", market:"Points", pick:"Player Over 3.5 Points", player:"Player", isProp:true, propMarketKey:"player_points", propLine:3.5, propSide:"Over", odds:-480} as ParsedPick;
    const result = buildFinalAiScore({pick, odds:-110, propSimHit:0.98, edgePct:16.7,
      rubricScores:{matchup:8,trend:8,lineValue:9.9,injury:8,lineShopping:null,simulation:9.8}});
    assert.equal(result.edgePct, 15.2);
    assert.equal(result.rubric.edgePct, 15.2);
    assert.equal(result.simHit, 0.98);
    assert.equal(result.factors.find(f => f.key === "lineValue")?.display, "+15.2%");
    assert.equal(pick.odds, -480);
  }
});

test("safety-clipped binary probability cannot retain the unclipped positive edge", () => {
  const pick = {sport:"nba", game:"Away @ Home", market:"3-Pointers", pick:"Player Over 0.5 3-Pointers", player:"Player", isProp:true, propMarketKey:"player_threes", propLine:0.5, propSide:"Over", odds:-9900} as ParsedPick;
  const result = buildFinalAiScore({pick, odds:-9900, propSimHit:1, edgePct:1,
    rubricScores:{matchup:9,trend:9,lineValue:9,injury:9,lineShopping:9,simulation:10}});
  assert.equal(result.simHit, 0.98);
  assert.equal(result.edgePct, -1);
  assert.equal(result.recommends, false);
});

test("provider identity collapses two display labels for the same prop ladder without merging periods or stats", () => {
  const first = {sport:"nba", game:"Away @ Home", market:"Points", pick:"Player Over 3.5 Points", player:"Player", isProp:true, propMarketKey:"player_points", propLine:3.5, propSide:"Over", odds:-480} as ParsedPick;
  const alt = {...first, market:"Player Points (Alternate)", propMarketKey:"player_points_alternate", propLine:9.5, odds:179};
  assert.equal(marketLadderKey(first), marketLadderKey(alt));
  assert.equal(dedupePicksByMarketLadder([first, alt]).length, 1);
  for (const key of ["player_points_q1", "player_points_h1", "player_rebounds"]) {
    assert.notEqual(marketLadderKey(first), marketLadderKey({...alt, propMarketKey:key}));
  }
});
