import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverAllPostedGameLines,
  humanizeOddsApiMarketKey,
  mergeEvalLadderWithDiscovered,
} from "./postedMarketDiscovery.ts";

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

test("humanizeOddsApiMarketKey: phone SPREADS / SPREADS_Q2 badges", () => {
  assert.equal(humanizeOddsApiMarketKey("spreads"), "Spread");
  assert.equal(humanizeOddsApiMarketKey("SPREADS"), "Spread");
  assert.equal(humanizeOddsApiMarketKey("spreads_q2"), "Q2 Spread");
  assert.equal(humanizeOddsApiMarketKey("SPREADS_Q2"), "Q2 Spread");
  assert.equal(humanizeOddsApiMarketKey("spreads_q1"), "Q1 Spread");
  assert.equal(humanizeOddsApiMarketKey("h2h"), "Moneyline");
  assert.equal(humanizeOddsApiMarketKey("totals_h1"), "1H Total");
  assert.equal(humanizeOddsApiMarketKey("alternate_spreads"), "Alt Spread");
  // Already-friendly labels pass through.
  assert.equal(humanizeOddsApiMarketKey("Q2 Spread"), "Q2 Spread");
  assert.equal(humanizeOddsApiMarketKey("Spread"), "Spread");
});

test("discoverAllPostedGameLines pick includes spread point (not bare team name)", () => {
  const g = {
    id: "ev2",
    sport: "ncaaf",
    homeTeam: "Kansas Jayhawks",
    awayTeam: "Middle Tennessee Blue Raiders",
    commenceTime: "2026-10-03T16:00:00Z",
    markets: [
      {
        key: "spreads",
        outcomes: [
          { name: "Kansas Jayhawks", price: -106, point: -24.5 },
          { name: "Middle Tennessee Blue Raiders", price: -114, point: 24.5 },
        ],
      },
    ],
  };
  const lines = discoverAllPostedGameLines(g);
  const ku = lines.find((e) => /Jayhawks/i.test(e.pick));
  assert.ok(ku);
  assert.equal(ku!.market, "Spread");
  assert.match(ku!.pick, /-24\.5/);
});
