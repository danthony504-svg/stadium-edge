import test from "node:test";
import assert from "node:assert/strict";
import { pickWinChanceInputs, attachPickScores } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import type { PropPoolEntry } from "./api";
const row: PropPoolEntry = {
  sport: "nfl",
  eventId: "event",
  athleteId: "player",
  game: "Chiefs @ Bills",
  player: "Fixture",
  marketKey: "player_reception_yds",
  marketLabel: "Rec Yds",
  side: "Over",
  line: 25.5,
  odds: -110,
  sportsbook: "Book A",
  edge: 3,
};
test("scoring never borrows another market, rematch, price or sportsbook's edge", () => {
  const pool = [
    { ...row, marketKey: "player_rush_yds", edge: 90 },
    { ...row, eventId: "rematch", edge: 80 },
    { ...row, sportsbook: "Book B", edge: 70 },
    row,
  ];
  const pick = parsedPickFromPoolEntry(row);
  assert.equal(pickWinChanceInputs(pick, [], pool).edge, 3);
  assert.equal(
    pickWinChanceInputs({ ...pick, odds: 105 }, [], pool).edge,
    null,
  );
  assert.equal(
    pickWinChanceInputs({ ...pick, propMarketKey: "unknown_market" }, [], pool)
      .edge,
    null,
  );
  assert.equal(
    attachPickScores([pick], { propPool: pool })[0]?.scores?.edgePct,
    3,
  );
});
