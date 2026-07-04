import assert from "node:assert/strict";
import { test } from "node:test";
import { backfillProps } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";

const GAME = "New York Yankees @ Boston Red Sox";
const REAL_TODAY = [
  {
    game: GAME,
    market: "Moneyline",
    pick: "Red Sox ML",
    odds: -105,
    sport: "mlb",
    startsAt: "2026-06-28T22:00:00.000Z",
  },
];

function prop(
  player: string,
  marketLabel: string,
  odds: number,
): PropPoolEntry {
  return {
    sport: "mlb",
    game: GAME,
    marketLabel,
    player,
    line: 0.5,
    side: "Over",
    odds,
    marketKey: "test",
    headshot: null,
    teamAbbr: "BOS",
    athleteId: "1",
    startsAt: "2026-06-28T22:00:00.000Z",
  };
}

test("backfillProps diversifies across markets instead of stacking one stat", () => {
  const pool: PropPoolEntry[] = [];
  for (let i = 0; i < 8; i++) {
    pool.push(prop(`SB Player ${i}`, "Stolen Bases", 300 + i * 20));
  }
  for (let i = 0; i < 8; i++) {
    pool.push(prop(`Hit Player ${i}`, "Hits", -110));
  }
  for (let i = 0; i < 4; i++) {
    pool.push(prop(`HR Player ${i}`, "Home Runs", 350));
  }
  const out = backfillProps([], pool, REAL_TODAY, [], {
    target: 9,
    diversify: true,
    maxPerMarket: 3,
    plusMoneyBias: true,
  });
  assert.equal(out.length, 9);
  const markets = new Set(out.map((p) => p.market));
  assert.ok(markets.size >= 3, `expected mixed markets, got: ${[...markets].join(", ")}`);
  const sb = out.filter((p) => p.market === "Stolen Bases").length;
  assert.ok(sb <= 3, `too many stolen-base legs: ${sb}`);
});
