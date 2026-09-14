import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalPropMarketKey,
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
