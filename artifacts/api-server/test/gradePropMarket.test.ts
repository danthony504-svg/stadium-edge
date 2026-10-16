import assert from "node:assert/strict";
import test from "node:test";

import {
  gradeStatWordForMarket,
  isUnsupportedComboGradeMarket,
  resolveGradeMarketKey,
  settleNumericOu,
  settlePropMarketAgainstStats,
} from "../src/lib/gradePropMarket.ts";

test("resolveGradeMarketKey: Tackles + Assists → player_tackles_assists", () => {
  assert.equal(resolveGradeMarketKey("Tackles + Assists"), "player_tackles_assists");
  assert.equal(resolveGradeMarketKey("tackles+assists"), "player_tackles_assists");
  assert.equal(resolveGradeMarketKey("player_tackles_assists"), "player_tackles_assists");
  assert.equal(
    resolveGradeMarketKey("player_tackles_assists_alternate"),
    "player_tackles_assists",
  );
});

test("isUnsupportedComboGradeMarket: Tackles + Assists is gradeable; PRA is not", () => {
  assert.equal(isUnsupportedComboGradeMarket("Tackles + Assists"), false);
  assert.equal(isUnsupportedComboGradeMarket("player_tackles_assists"), false);
  assert.equal(isUnsupportedComboGradeMarket("Pts+Reb+Ast"), true);
  assert.equal(isUnsupportedComboGradeMarket("player_points_rebounds_assists"), true);
  assert.equal(isUnsupportedComboGradeMarket("player_blocks_steals"), true);
  assert.equal(isUnsupportedComboGradeMarket("batter_hits_runs_rbis"), true);
  assert.equal(isUnsupportedComboGradeMarket("player_anytime_td"), true);
});

test("gradeStatWordForMarket maps Tackles + Assists to total tackles", () => {
  assert.equal(
    gradeStatWordForMarket("player_tackles_assists", "Tackles + Assists"),
    "total tackles",
  );
  assert.equal(gradeStatWordForMarket(null, "Sacks"), "Sacks");
});

test("settlePropMarketAgainstStats: totalTackles win / loss / push / missing", () => {
  const win = settlePropMarketAgainstStats(
    "player_tackles_assists",
    { totalTackles: "9" },
    "over",
    6.5,
  );
  assert.equal(win.result, "win");
  assert.equal(win.value, 9);

  const loss = settlePropMarketAgainstStats(
    "player_tackles_assists",
    { totalTackles: "4" },
    "over",
    6.5,
  );
  assert.equal(loss.result, "loss");
  assert.equal(loss.value, 4);

  const push = settlePropMarketAgainstStats(
    "player_tackles_assists",
    { totalTackles: "7" },
    "over",
    7,
  );
  assert.equal(push.result, "push");
  assert.equal(push.value, 7);

  const missing = settlePropMarketAgainstStats(
    "player_tackles_assists",
    {},
    "over",
    6.5,
  );
  assert.equal(missing.result, "ungraded");
  assert.equal(missing.value, null);
  assert.match(missing.detail, /no stat value/i);

  const underWin = settlePropMarketAgainstStats(
    "player_tackles_assists",
    { totalTackles: "3" },
    "under",
    6.5,
  );
  assert.equal(underWin.result, "win");
});

test("settleNumericOu covers edge cases", () => {
  assert.equal(settleNumericOu(null, "over", 5).result, "ungraded");
  assert.equal(settleNumericOu(5, "over", 5).result, "push");
  assert.equal(settleNumericOu(6, "over", 5).result, "win");
  assert.equal(settleNumericOu(4, "over", 5).result, "loss");
});
