import assert from "node:assert/strict";
import test from "node:test";
import { discoverAllPostedGameLines, mergeEvalLadderWithDiscovered } from "./postedMarketDiscovery.ts";

test("discovers every posted alternate run-line rung regardless of price", () => {
  const lines = discoverAllPostedGameLines({
    id: "mlb-alt-rungs",
    sport: "mlb",
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    commenceTime: "2030-07-01T19:00:00.000Z",
    markets: [
      {
        key: "spreads",
        outcomes: [
          { name: "New York Yankees", point: 1.5, price: -110 },
          { name: "Boston Red Sox", point: -1.5, price: -110 },
        ],
      },
      {
        key: "alternate_spreads",
        outcomes: [
          { name: "New York Yankees", point: 2.5, price: -1200 },
          { name: "New York Yankees", point: -1.5, price: 220 },
        ],
      },
    ],
  });

  assert.ok(lines.some((line) => line.market === "Spread" && line.pick === "Yankees +1.5"));
  assert.ok(lines.some((line) => line.market === "Alt Spread" && line.pick === "Yankees +2.5"));
  assert.ok(lines.some((line) => line.market === "Alt Spread" && line.pick === "Yankees -1.5"));
});

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
