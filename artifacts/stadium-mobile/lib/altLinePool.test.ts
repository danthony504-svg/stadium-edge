import assert from "node:assert/strict";
import test from "node:test";
import { gameAltPoolForPick, poolMatchesPickFamily } from "./altLinePool.ts";
import type { RealOddsEntry } from "./api.ts";

const pick = {
  game: "New York Yankees @ Washington Nationals",
  market: "Alt Spread",
  pick: "Yankees -2",
};

const evalLines: RealOddsEntry[] = [
  { sport: "mlb", game: pick.game, market: "Spread", pick: "Yankees -1.5", odds: -110 },
  { sport: "mlb", game: pick.game, market: "Alt Spread", pick: "Yankees -2", odds: 105 },
  { sport: "mlb", game: pick.game, market: "Alt Spread", pick: "Yankees -3.5", odds: 180 },
  { sport: "mlb", game: pick.game, market: "F5 Run Line", pick: "Yankees -1.5", odds: 120 },
  { sport: "mlb", game: pick.game, market: "Alt Total", pick: "Over 9", odds: 110 },
];

test("poolMatchesPickFamily groups spread, alt spread, and period run lines", () => {
  assert.ok(poolMatchesPickFamily(evalLines[0]!, pick));
  assert.ok(poolMatchesPickFamily(evalLines[2]!, pick));
  assert.ok(poolMatchesPickFamily(evalLines[3]!, pick));
  assert.ok(!poolMatchesPickFamily(evalLines[4]!, pick));
});

test("gameAltPoolForPick returns every same-side spread-family rung", () => {
  const pool = gameAltPoolForPick(pick, evalLines);
  assert.equal(pool.length, 4);
});
