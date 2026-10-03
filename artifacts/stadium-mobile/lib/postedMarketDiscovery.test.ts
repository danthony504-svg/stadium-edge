import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverAllPostedGameLines,
  gameLineTeamLabel,
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

test("discoverAllPostedGameLines labels UFC totals as Total Rounds", () => {
  const g = {
    id: "ufc1",
    sport: "ufc",
    homeTeam: "Lucas Armand",
    awayTeam: "Anthony Wint",
    commenceTime: "2026-10-04T00:00:00Z",
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "Lucas Armand", price: 423, point: null },
          { name: "Anthony Wint", price: -550, point: null },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: -115, point: 2.5 },
          { name: "Under", price: -105, point: 2.5 },
        ],
      },
    ],
  };
  const lines = discoverAllPostedGameLines(g);
  assert.ok(lines.some((e) => e.market === "Moneyline"));
  assert.ok(lines.some((e) => e.market === "Total Rounds" && /Over 2\.5/.test(e.pick)));
  assert.equal(
    lines.filter((e) => e.market === "Total").length,
    0,
    "UFC must not use bare Total label",
  );
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
  // College keeps the school name — bare "Jayhawks" collides across boards.
  assert.match(ku!.pick, /Kansas Jayhawks/i);
});

test("phone: college 49ers pick keeps Charlotte — not bare NFL-looking 49ers", () => {
  assert.equal(gameLineTeamLabel("Charlotte 49ers", "ncaaf"), "Charlotte 49ers");
  assert.equal(gameLineTeamLabel("San Francisco 49ers", "nfl"), "49ers");
  assert.equal(gameLineTeamLabel("Alabama Crimson Tide", "ncaaf"), "Alabama Crimson Tide");
  assert.equal(gameLineTeamLabel("Boston Celtics", "nba"), "Celtics");

  const g = {
    id: "ev-clt",
    sport: "ncaaf",
    homeTeam: "Charlotte 49ers",
    awayTeam: "Memphis Tigers",
    commenceTime: "2026-10-03T16:00:00Z",
    markets: [
      {
        key: "alternate_spreads",
        outcomes: [{ name: "Charlotte 49ers", price: -225, point: 27.5 }],
      },
    ],
  };
  const lines = discoverAllPostedGameLines(g);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.pick, "Charlotte 49ers +27.5");
  assert.equal(lines[0]!.market, "Alt Spread");
});

test("college team props: team totals + Q2 team totals humanize (not player yards)", () => {
  // FanDuel college boards post Team Yards (book-only) + spreads/team totals.
  // Odds API team_totals / period team totals are the feed's team-prop surface.
  assert.equal(humanizeOddsApiMarketKey("team_totals"), "Team Total");
  assert.equal(humanizeOddsApiMarketKey("alternate_team_totals"), "Alt Team Total");
  assert.equal(humanizeOddsApiMarketKey("team_totals_q2"), "Q2 Team Total");
  assert.equal(humanizeOddsApiMarketKey("alternate_team_totals_q1"), "Q1 Alt Team Total");

  const g = {
    id: "ev-pitt-vt",
    sport: "ncaaf",
    homeTeam: "Virginia Tech Hokies",
    awayTeam: "Pittsburgh Panthers",
    commenceTime: "2026-10-02T23:00:00Z",
    markets: [
      {
        key: "team_totals",
        outcomes: [
          { name: "Pittsburgh Panthers Over", price: -110, point: 24.5 },
          { name: "Virginia Tech Hokies Under", price: -115, point: 27.5 },
        ],
      },
      {
        key: "team_totals_q2",
        outcomes: [{ name: "Pittsburgh Panthers Over", price: -105, point: 6.5 }],
      },
      {
        key: "alternate_team_totals",
        outcomes: [{ name: "Virginia Tech Hokies Over", price: -120, point: 30.5 }],
      },
    ],
  };
  const lines = discoverAllPostedGameLines(g);
  assert.ok(lines.some((e) => e.market === "Team Total" && /Pittsburgh Panthers Over 24\.5/.test(e.pick)));
  assert.ok(lines.some((e) => e.market === "Q2 Team Total" && /Pittsburgh Panthers Over 6\.5/.test(e.pick)));
  assert.ok(lines.some((e) => e.market === "Alt Team Total" && /Virginia Tech Hokies Over 30\.5/.test(e.pick)));
});
