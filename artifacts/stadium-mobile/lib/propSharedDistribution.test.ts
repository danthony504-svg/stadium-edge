import assert from "node:assert/strict";
import { test } from "node:test";

import {
  propMarketsShareDistribution,
  propSharedDistributionMarketKey,
} from "../lib/propSharedDistribution.ts";

test("client market key strips _alternate only", () => {
  assert.equal(propSharedDistributionMarketKey("player_points_alternate"), "player_points");
  assert.equal(propSharedDistributionMarketKey("player_points_h1"), "player_points_h1");
  assert.equal(
    propMarketsShareDistribution("player_pass_yds", "player_pass_yds_alternate"),
    true,
  );
  assert.equal(
    propMarketsShareDistribution("player_pass_yds", "player_pass_yds_q1"),
    false,
  );
});
