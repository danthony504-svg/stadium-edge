import assert from "node:assert/strict";
import test from "node:test";
import { filterSalvageOddsPool } from "./slate.ts";

const WC_ODDS = [
  {
    sport: "soccer",
    game: "Egypt @ Argentina",
    market: "Moneyline",
    pick: "Argentina ML",
    odds: -285,
    startsAt: "2026-07-07T16:00:00Z",
  },
  {
    sport: "soccer",
    game: "Colombia @ Switzerland",
    market: "Moneyline",
    pick: "Colombia ML",
    odds: 150,
    startsAt: "2026-07-07T20:00:00Z",
  },
];

test("filterSalvageOddsPool focuses World Cup asks on soccer", () => {
  const ask = "Build me a 2 leg World Cup parlay for today's matches";
  const pool = filterSalvageOddsPool(WC_ODDS, ask, "tonight");
  assert.equal(pool.length, 2);
  assert.ok(pool.every((e) => e.sport === "soccer"));
});

test("filterSalvageOddsPool ignores unrelated sports", () => {
  const mixed = [
    ...WC_ODDS,
    {
      sport: "mlb",
      game: "A @ B",
      market: "Moneyline",
      pick: "B ML",
      odds: -110,
      startsAt: "2026-07-07T22:00:00Z",
    },
  ];
  const pool = filterSalvageOddsPool(mixed, "2 leg World Cup parlay", null);
  assert.equal(pool.length, 2);
});
