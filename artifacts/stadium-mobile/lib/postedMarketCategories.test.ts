import { test } from "node:test";
import assert from "node:assert/strict";
import { postedMarketKeys } from "./postedMarketCategories";

test("NBA categories never inject MLB market keys", () => {
  assert.deepEqual(postedMarketKeys([{props:[{market:"player_points"},{market:"player_rebounds"},{market:"player_points"}]}]), ["player_points","player_rebounds"]);
});
test("NHL categories reflect only actually supplied goals, shots, and assists", () => {
  assert.deepEqual(postedMarketKeys([{props:[{market:"player_shots_on_goal"},{market:"player_goals"}]},{props:[{market:"player_goals"}]}]), ["player_goals","player_shots_on_goal"]);
});
test("NFL, CFB and other sports have no fabricated categories on an empty feed", () => {
  assert.deepEqual(postedMarketKeys([]), []);
  assert.deepEqual(postedMarketKeys([{props:[]}]), []);
});
test("duplicates, blank keys and multiple games do not create extra categories", () => {
  assert.deepEqual(postedMarketKeys([{props:[{market:""},{market:"player_pass_yds"}]},{props:[{market:"player_pass_yds"},{market:"player_rush_yds"}]}]), ["player_pass_yds","player_rush_yds"]);
});
