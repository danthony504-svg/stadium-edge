import assert from "node:assert/strict";
import test from "node:test";

import {
  FOOTBALL_DST_PROP_MARKET_KEYS,
  FOOTBALL_DST_PROP_SIM_CAP,
  isFootballDstPropMarket,
} from "./footballDstProps.ts";

test("D/ST market keys cover DraftKings D/ST O/U family", () => {
  assert.deepEqual([...FOOTBALL_DST_PROP_MARKET_KEYS].sort(), [
    "player_defensive_interceptions",
    "player_kicking_points",
    "player_solo_tackles",
    "player_tackles_assists",
  ]);
  assert.equal(FOOTBALL_DST_PROP_SIM_CAP, 8);
  assert.equal(isFootballDstPropMarket("player_tackles_assists_alternate"), true);
  assert.equal(isFootballDstPropMarket("player_sacks"), false);
  assert.equal(isFootballDstPropMarket("player_pass_yds"), false);
});
