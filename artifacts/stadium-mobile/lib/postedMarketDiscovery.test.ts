import test from "node:test";
import assert from "node:assert/strict";
import { discoverAllPostedGameLines, mergeEvalLadderWithDiscovered } from "./postedMarketDiscovery.ts";

test("discoverAllPostedGameLines includes race-to and team total markets", () => {
  const g = {
    id: "ev1",
    sport: "nba",
    homeTeam: "Boston Celtics",
    awayTeam: "Los Angeles Lakers",
    commenceTime: "2026-01-01T00:00:00Z",
    markets: [
      {
        key: "race_to_20_points",
        outcomes: [
          { name: "Celtics", price: -130, point: null },
          { name: "Lakers", price: 110, point: null },
        ],
      },
      {
        key: "team_totals",
        outcomes: [
          { name: "Over", price: -110, point: 112.5 },
          { name: "Under", price: -110, point: 112.5 },
        ],
      },
      {
        key: "spreads_q2",
        outcomes: [{ name: "Boston Celtics", price: -105, point: -1.5 }],
      },
    ],
  };
  const lines = discoverAllPostedGameLines(g);
  assert.ok(lines.some((e) => /race to/i.test(e.market)));
  assert.ok(lines.some((e) => e.market === "Team Total"));
  assert.ok(lines.some((e) => e.market === "Q2 Spread"));
});

test("mergeEvalLadderWithDiscovered keeps ladder row on collision", () => {
  const ladder = [{ sport: "nba", game: "A @ B", market: "Spread", pick: "A +3", odds: -110, bookSpread: 2.1 }];
  const discovered = [{ sport: "nba", game: "A @ B", market: "Spread", pick: "A +3", odds: -108 }];
  const merged = mergeEvalLadderWithDiscovered(ladder, discovered);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.odds, -110);
  assert.equal(merged[0]!.bookSpread, 2.1);
});
