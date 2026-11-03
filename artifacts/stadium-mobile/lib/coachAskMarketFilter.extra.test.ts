import {satisfiesExplicitGamePropMix} from "./slate.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalPropMarketKey,
  filterPicksByAskMarketConstraint,
  parseCoachAskMarketConstraint,
} from "./coachAskMarketFilter.ts";

test("canonicalPropMarketKey aliases first TD and runs scored", () => {
  assert.equal(canonicalPropMarketKey("player_1st_td"), "player_first_td");
  assert.equal(canonicalPropMarketKey("batter_runs_scored"), "batter_runs");
  assert.equal(canonicalPropMarketKey("player_pass_yds_alternate"), "player_pass_yds");
});

test("parseCoachAskMarketConstraint scopes first TD / FG / soccer specials", () => {
  const firstTd = parseCoachAskMarketConstraint("6 leg first TD scorers");
  assert.equal(firstTd.propsOnly, true);
  assert.ok(firstTd.allowedMarketKeys?.includes("player_first_td"));

  const fg = parseCoachAskMarketConstraint("4 leg field goal props");
  assert.equal(fg.propsOnly, true);
  assert.ok(fg.allowedMarketKeys?.includes("player_field_goals"));

  const soccer = parseCoachAskMarketConstraint("both teams to score parlay");
  assert.equal(soccer.propsOnly, false);
  assert.ok(soccer.allowedMarketKeys?.includes("btts"));
});

for (const sport of ["NBA", "NFL", "WNBA", "NHL", "MLB", "NCAAF"]) {
  test(`${sport}: explicit game-line/player-prop mix avoids props-only routing`, () => {
    const result = parseCoachAskMarketConstraint(`Build a 2-leg ${sport} parlay mixing a game line and a player prop`);
    assert.equal(result.propsOnly, false);
    assert.equal(result.gameLinesOnly, false);
    assert.equal(parseCoachAskMarketConstraint(`Build a 2-leg ${sport} player props parlay`).propsOnly, true);
  });
}
test("mixing only player props does not permit game lines", () => {
  assert.equal(parseCoachAskMarketConstraint("mix player props from NBA and NFL").propsOnly, true);
});

test("explicit mix needs both categories; ordinary prop tickets remain valid", () => {
 const ask = "2 leg NBA mixing a game line and a player prop";
 assert.equal(satisfiesExplicitGamePropMix(ask, [{isProp:true},{isProp:true}]), false);
 assert.equal(satisfiesExplicitGamePropMix(ask, [{isProp:false},{isProp:false}]), false);
 assert.equal(satisfiesExplicitGamePropMix(ask, [{isProp:false},{isProp:true}]), true);
 assert.equal(satisfiesExplicitGamePropMix("2 NBA player props", [{isProp:true},{isProp:true}]), true);
});

test("football period picks cannot survive final delivery; NBA periods unaffected", () => {
 const picks = [{sport:"nfl",market:"Q1 Alt Spread"},{sport:"ncaaf",market:"spreads_h1"},{sport:"nfl",market:"Alt Spread"},{sport:"nba",market:"Q1 Spread"}];
 assert.deepEqual(filterPicksByAskMarketConstraint(picks,parseCoachAskMarketConstraint("2 leg")), picks.slice(2));
});

test("football aliases reject halves and quarters", () => {
 const constraint = parseCoachAskMarketConstraint("2 leg");
 for (const sport of ["cfb","college-football","americanfootball_nfl","americanfootball_ncaaf"]) {
   assert.deepEqual(filterPicksByAskMarketConstraint([{sport,market:"Q1 Spread"}], constraint), []);
 }
});
test("a day refinement with an explicit mix clears prior props-only", () => {
 assert.equal(parseCoachAskMarketConstraint("tonight mixing a game line and a player prop", ["2 NBA player props"]).propsOnly,false);
});
