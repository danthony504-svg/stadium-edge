import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gameValueForMarket, isScoringOrderMarket } from "../src/lib/propStatValue.ts";
import { gameValueForMarket as clientValue } from "../../stadium-mobile/lib/propStats.ts";
import { diagnosePropSimNullReason } from "../src/lib/monteCarloBuild.ts";

const stats = Object.fromEntries([
  "PTS", "REB", "AST", "STL", "BLK", "TO", "P", "A", "H", "R", "RBI", "HR", "SB", "2B", "3B", "K", "SO", "G", "S", "SH", "SOT", "SOG", "3PM", "SACK", "totalTackles", "soloTackles", "interceptions", "kickingPoints", "passingYards", "rushingYards", "receivingYards", "passingAttempts", "completions", "passingTouchdowns", "longPassing", "rushingAttempts", "longRushing", "receptions", "longReception", "rushingTouchdowns", "receivingTouchdowns", "fieldGoalsMade",
].map(k => [k, "12"]));
stats.IP = "6.2";
const source = readFileSync(new URL("../src/routes/props.ts", import.meta.url), "utf8");
const fullKeys = new Set<string>();
for (const name of ["MARKETS_BY_SPORT", "MARKETS_EXTENDED_BY_SPORT", "MARKETS_DST_BY_SPORT", "ALT_MARKETS_BY_SPORT", "ALT_MARKETS_EXTENDED_BY_SPORT"]) {
  const block = source.match(new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`))?.[1];
  assert.ok(block, name);
  for (const m of block.matchAll(/"((?:player|batter|pitcher)_[a-z0-9_]+)"/g)) {
    fullKeys.add(m[1].replace(/_alternate$/, "").replace("batter_runs_scored", "batter_runs").replace("player_1st_td", "player_first_td"));
  }
}

test("every advertised full-game prop has matching client/server stat semantics or explicit scoring-order rejection", () => {
  assert.ok(fullKeys.size > 40);
  for (const market of fullKeys) {
    const server = gameValueForMarket(market, stats, new Set());
    const client = clientValue(market, stats, new Set());
    if (isScoringOrderMarket(market)) {
      assert.equal(server, null, market);
      assert.equal(client, null, market);
    } else {
      assert.notEqual(server, null, `server mapping missing for ${market}`);
      assert.equal(server, client, market);
    }
    assert.equal(gameValueForMarket(`${market}_alternate`, stats, new Set()), server, `${market} alt`);
  }
});

test("first goal is not inferred from goal totals; pitcher innings are not decimal innings", () => {
  assert.equal(gameValueForMarket("player_first_goal_scorer", { G: "2" }, new Set()), null);
  assert.equal(diagnosePropSimNullReason({ athleteId: "a", market: "player_first_goal_scorer" } as never, { recent: [{ stats: { G: "2" } }] } as never), "missing_scoring_order");
  assert.equal(gameValueForMarket("pitcher_outs", { IP: "6.2" }, new Set()), 20);
  assert.equal(gameValueForMarket("pitcher_outs", { IP: "6.3" }, new Set()), null);
  assert.equal(gameValueForMarket("player_double_double", { PTS: "22", REB: "11" }, new Set()), null);
  assert.equal(gameValueForMarket("player_pass_rush_yds", { passingYards: "250" }, new Set()), null);
});
