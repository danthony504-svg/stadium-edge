import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerProp } from "./api.ts";
import { simulatorNbaProjectionQuotes } from "./simulatorProjectionQuotes.ts";

test("alternate assists retain the exact posted side, price, book and timestamp", () => {
  const quote: PlayerProp = {
    player: "Fixture Guard", athleteId: "10", playerTeamId: "20", headshot: null,
    market: "player_assists_alternate", alt: true, line: 4.5,
    overPrice: 125, overBook: "Fixture A", overSourceUpdatedAt: "2026-11-26T13:30:00Z",
    underPrice: -145, underBook: "Fixture B", underSourceUpdatedAt: "2026-11-26T13:31:00Z",
  };
  const result = simulatorNbaProjectionQuotes([quote, quote, { ...quote, alt: false }], "game");
  assert.deepEqual(result.map(({ side, price, book, updatedAt }) => [side, price, book, updatedAt]), [
    ["Over", 125, "Fixture A", "2026-11-26T13:30:00Z"],
    ["Under", -145, "Fixture B", "2026-11-26T13:31:00Z"],
  ]);
  assert.notEqual(result[0]?.key, simulatorNbaProjectionQuotes([{ ...quote, overPrice: 130 }], "game")[0]?.key);
  assert.notEqual(result[0]?.key, simulatorNbaProjectionQuotes([quote], "other-game")[0]?.key);
  assert.deepEqual(simulatorNbaProjectionQuotes([{ ...quote, overBook: null, underSourceUpdatedAt: null }], "game"), []);
});


test("main rebounds offer each verified quote side for the same exact line", () => {
  const prop: PlayerProp = {
    player: "Fixture Center", athleteId: "11", playerTeamId: "20", headshot: null,
    market: "player_rebounds", alt: false, line: 12.5, overPrice: -105, underPrice: -115,
    overBook: "Fixture A", underBook: "Fixture A",
    overSourceUpdatedAt: "2026-11-26T13:30:00Z", underSourceUpdatedAt: "2026-11-26T13:30:00Z",
  };
  const result = simulatorNbaProjectionQuotes([prop], "game");
  assert.deepEqual(result.map(({side, prop, price}) => [side, prop.line, price]), [
    ["Over", 12.5, -105], ["Under", 12.5, -115],
  ]);
});
