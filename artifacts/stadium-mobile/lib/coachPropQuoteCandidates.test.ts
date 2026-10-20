import test from "node:test";
import assert from "node:assert/strict";
import { bestPostedPropQuoteCandidates } from "./coachPropQuoteCandidates.ts";
import type { PropPoolEntry } from "./api";
const row: PropPoolEntry = {
  sport: "nfl",
  eventId: "e",
  athleteId: "p",
  game: "A @ B",
  player: "Player",
  marketKey: "player_rush_yds",
  marketLabel: "Rush Yds",
  side: "Over",
  line: 45.5,
  odds: -120,
  sportsbook: "Book A",
};
test("best posted price is scored once while every original quote remains accounted for", () => {
  const pool = [
    row,
    { ...row, odds: -110, sportsbook: "Book B" },
    { ...row, odds: 105, sportsbook: "Book C" },
  ];
  const result = bestPostedPropQuoteCandidates(pool);
  assert.deepEqual(result.selected, [pool[2]]);
  assert.deepEqual(result.discarded, pool.slice(0, 2));
  assert.equal(result.selected.length + result.discarded.length, pool.length);
  assert.equal(pool[0], row);
});
test("each distinct event, player, market, threshold, side and team identity is preserved", () => {
  const pool = [
    row,
    ...[
      { eventId: "other" },
      { athleteId: "other" },
      { marketKey: "player_reception_yds" },
      { line: 55.5 },
      { side: "Under" as const },
      { sport: "ncaaf" },
      { playerTeamId: "other" },
      { teamAbbr: "other" },
    ].map((patch) => ({ ...row, ...patch })),
  ];
  assert.equal(
    bestPostedPropQuoteCandidates(pool).selected.length,
    pool.length,
  );
});
test("missing identity and invalid prices cannot swallow other candidates", () => {
  for (const patch of [
    { line: null },
    { eventId: null },
    { athleteId: null },
    { marketKey: undefined },
    { sport: undefined },
    { odds: 0 },
    { odds: NaN },
  ]) {
    const pool = [
      { ...row, ...patch },
      { ...row, ...patch, sportsbook: "Other" },
    ];
    assert.equal(bestPostedPropQuoteCandidates(pool).selected.length, 2);
  }
});
