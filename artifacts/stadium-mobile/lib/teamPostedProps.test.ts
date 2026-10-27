import test from "node:test";
import assert from "node:assert/strict";
import type { OddsGame } from "./api.ts";
import {
  extractTeamPostedProps,
  findOddsGameForMatchup,
  gameHasTeamPostedProps,
  isTeamTotalMarketKey,
  parseTeamTotalOutcome,
  resolveOutcomeTeam,
  TEAM_PROP_PROVIDER_KEYS,
  teamPostedPropToRealOdds,
} from "./teamPostedProps.ts";

function game(partial: Partial<OddsGame> & Pick<OddsGame, "markets">): OddsGame {
  return {
    id: partial.id ?? "ev1",
    sport: partial.sport ?? "nba",
    homeTeam: partial.homeTeam ?? "Boston Celtics",
    awayTeam: partial.awayTeam ?? "Los Angeles Lakers",
    commenceTime: partial.commenceTime ?? "2026-10-28T00:00:00Z",
    markets: partial.markets,
  };
}

test("isTeamTotalMarketKey accepts team totals + period/alt only", () => {
  assert.equal(isTeamTotalMarketKey("team_totals"), true);
  assert.equal(isTeamTotalMarketKey("alternate_team_totals"), true);
  assert.equal(isTeamTotalMarketKey("team_totals_q2"), true);
  assert.equal(isTeamTotalMarketKey("alternate_team_totals_h1"), true);
  assert.equal(isTeamTotalMarketKey("totals"), false);
  assert.equal(isTeamTotalMarketKey("alternate_totals"), false);
  assert.equal(isTeamTotalMarketKey("h2h"), false);
  assert.equal(isTeamTotalMarketKey("spreads"), false);
  assert.equal(isTeamTotalMarketKey("team_total_yards"), false);
});

test("parseTeamTotalOutcome requires Over/Under + team token", () => {
  assert.deepEqual(parseTeamTotalOutcome("Boston Celtics Over"), {
    side: "Over",
    teamToken: "Boston Celtics",
  });
  assert.deepEqual(parseTeamTotalOutcome("Lakers Under"), {
    side: "Under",
    teamToken: "Lakers",
  });
  assert.equal(parseTeamTotalOutcome("Over"), null);
  assert.equal(parseTeamTotalOutcome("Under"), null);
  assert.equal(parseTeamTotalOutcome("Boston Celtics"), null);
});

test("resolveOutcomeTeam fails closed on ambiguous nicknames", () => {
  // Hypothetical same-nickname board — both sides would match "Tigers".
  assert.equal(
    resolveOutcomeTeam("Tigers", "Auburn Tigers", "Missouri Tigers"),
    null,
  );
  assert.equal(
    resolveOutcomeTeam("Celtics", "Boston Celtics", "Los Angeles Lakers"),
    "Boston Celtics",
  );
  assert.equal(
    resolveOutcomeTeam("Lakers", "Boston Celtics", "Los Angeles Lakers"),
    "Los Angeles Lakers",
  );
});

test("extractTeamPostedProps: both teams, Over/Under, alts, books; excludes ML/spread/game total", () => {
  const g = game({
    sport: "nfl",
    homeTeam: "Kansas City Chiefs",
    awayTeam: "Buffalo Bills",
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "Kansas City Chiefs", price: -140 },
          { name: "Buffalo Bills", price: 120 },
        ],
      },
      {
        key: "spreads",
        outcomes: [
          { name: "Kansas City Chiefs", price: -110, point: -3.5 },
          { name: "Buffalo Bills", price: -110, point: 3.5 },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: -110, point: 48.5 },
          { name: "Under", price: -110, point: 48.5 },
        ],
      },
      {
        key: "team_totals",
        outcomes: [
          {
            name: "Kansas City Chiefs Over",
            price: -115,
            point: 26.5,
            books: [
              { book: "DraftKings", price: -115 },
              { book: "FanDuel", price: -120 },
            ],
          },
          {
            name: "Kansas City Chiefs Under",
            price: -105,
            point: 26.5,
            books: [{ book: "DraftKings", price: -105 }],
          },
          {
            name: "Buffalo Bills Over",
            price: -110,
            point: 21.5,
            books: [{ book: "FanDuel", price: -110 }],
          },
          {
            name: "Buffalo Bills Under",
            price: -110,
            point: 21.5,
            books: [{ book: "FanDuel", price: -110 }],
          },
        ],
      },
      {
        key: "alternate_team_totals",
        outcomes: [
          {
            name: "Kansas City Chiefs Over",
            price: -130,
            point: 28.5,
            books: [{ book: "Caesars", price: -130 }],
          },
          {
            name: "Kansas City Chiefs Under",
            price: 100,
            point: 24.5,
            books: [{ book: "Caesars", price: 100 }],
          },
        ],
      },
    ],
  });

  const kc = extractTeamPostedProps(g, "Kansas City Chiefs");
  assert.equal(kc.length, 4);
  assert.ok(kc.every((r) => /team total/i.test(r.market)));
  assert.ok(kc.every((r) => r.team === "Kansas City Chiefs"));
  assert.ok(kc.some((r) => r.side === "Over" && r.line === 26.5 && r.odds === -115));
  assert.ok(kc.some((r) => r.side === "Under" && r.line === 26.5));
  assert.ok(kc.some((r) => r.market === "Alt Team Total" && r.line === 28.5));
  assert.equal(
    kc.find((r) => r.line === 26.5 && r.side === "Over")?.sportsbook,
    "DraftKings",
  );
  // Quote timestamps are not on the feed — stay null (never invent).
  assert.ok(kc.every((r) => r.quoteUpdatedAt === null));

  const buf = extractTeamPostedProps(g, "Buffalo Bills");
  assert.equal(buf.length, 2);
  assert.ok(buf.every((r) => r.team === "Buffalo Bills"));
  assert.ok(buf.every((r) => r.line === 21.5));

  // Game total / ML / spread never appear.
  assert.equal(kc.filter((r) => r.market === "Total" || r.market === "Moneyline").length, 0);
  assert.equal(gameHasTeamPostedProps(g), true);

  const slip = teamPostedPropToRealOdds(kc[0]!);
  assert.equal(slip.market, kc[0]!.market);
  assert.equal(slip.pick, kc[0]!.pick);
  assert.equal(slip.odds, kc[0]!.odds);
});

test("extractTeamPostedProps: bare Over/Under without team is dropped", () => {
  const g = game({
    markets: [
      {
        key: "team_totals",
        outcomes: [
          { name: "Over", price: -110, point: 112.5 },
          { name: "Under", price: -110, point: 112.5 },
        ],
      },
    ],
  });
  assert.deepEqual(extractTeamPostedProps(g, "Boston Celtics"), []);
  assert.equal(gameHasTeamPostedProps(g), false);
});

test("extractTeamPostedProps: period team totals (Q2) included when attributable", () => {
  const g = game({
    sport: "ncaaf",
    homeTeam: "Virginia Tech Hokies",
    awayTeam: "Pittsburgh Panthers",
    markets: [
      {
        key: "team_totals_q2",
        outcomes: [
          { name: "Pittsburgh Panthers Over", price: -105, point: 6.5 },
          { name: "Virginia Tech Hokies Under", price: -115, point: 7.5 },
        ],
      },
    ],
  });
  const pitt = extractTeamPostedProps(g, "Pittsburgh Panthers");
  assert.equal(pitt.length, 1);
  assert.equal(pitt[0]!.market, "Q2 Team Total");
  assert.match(pitt[0]!.pick, /Pittsburgh Panthers Over 6\.5/);
});

test("findOddsGameForMatchup requires both full names (order-independent)", () => {
  const rows = [
    game({
      id: "a",
      homeTeam: "Dallas Cowboys",
      awayTeam: "Philadelphia Eagles",
      markets: [],
    }),
    game({
      id: "b",
      homeTeam: "Boston Celtics",
      awayTeam: "Los Angeles Lakers",
      markets: [],
    }),
  ];
  assert.equal(
    findOddsGameForMatchup(rows, "Philadelphia Eagles", "Dallas Cowboys")?.id,
    "a",
  );
  assert.equal(
    findOddsGameForMatchup(rows, "Dallas Cowboys", "Philadelphia Eagles")?.id,
    "a",
  );
  // Nickname-only "Cowboys" + wrong opp must not bind.
  assert.equal(findOddsGameForMatchup(rows, "Cowboys", "Lakers"), null);
});

test("empty / missing team props surfaces honestly", () => {
  const g = game({
    markets: [
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: -110, point: 220.5 },
          { name: "Under", price: -110, point: 220.5 },
        ],
      },
    ],
  });
  assert.equal(gameHasTeamPostedProps(g), false);
  assert.deepEqual(extractTeamPostedProps(g, "Boston Celtics"), []);
});

test("provider key inventory documents supported vs unsupported team concepts", () => {
  assert.ok(TEAM_PROP_PROVIDER_KEYS.default.includes("team_totals"));
  assert.ok(TEAM_PROP_PROVIDER_KEYS.default.includes("alternate_team_totals_q4"));
  assert.deepEqual(TEAM_PROP_PROVIDER_KEYS.baseball, [
    "team_totals",
    "alternate_team_totals",
  ]);
  assert.ok(TEAM_PROP_PROVIDER_KEYS.unsupported.includes("Team Total Yards"));
});

test("ambiguous nickname match fails closed (no invented team prop)", () => {
  const g = game({
    sport: "ncaaf",
    homeTeam: "Auburn Tigers",
    awayTeam: "Missouri Tigers",
    markets: [
      {
        key: "team_totals",
        outcomes: [
          // Ambiguous short token — must not bind to either side.
          { name: "Tigers Over", price: -110, point: 24.5 },
          { name: "Tigers Under", price: -110, point: 24.5 },
        ],
      },
    ],
  });
  assert.deepEqual(extractTeamPostedProps(g, "Auburn Tigers"), []);
  assert.deepEqual(extractTeamPostedProps(g, "Missouri Tigers"), []);
  assert.equal(gameHasTeamPostedProps(g), false);
});

test("unsupported team-yard markets are ignored (never fabricated)", () => {
  const g = game({
    sport: "ncaaf",
    homeTeam: "Alabama Crimson Tide",
    awayTeam: "Georgia Bulldogs",
    markets: [
      {
        // Not a real Odds API key — must never surface as a team prop.
        key: "team_total_yards",
        outcomes: [
          { name: "Alabama Crimson Tide Over", price: -110, point: 380.5 },
        ],
      },
      {
        key: "team_totals",
        outcomes: [
          { name: "Alabama Crimson Tide Over", price: -110, point: 27.5 },
          { name: "Alabama Crimson Tide Under", price: -110, point: 27.5 },
        ],
      },
    ],
  });
  const rows = extractTeamPostedProps(g, "Alabama Crimson Tide");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.marketKey === "team_totals"));
  assert.ok(!rows.some((r) => /yard/i.test(r.market) || /yard/i.test(r.marketKey)));
});

test("team total stays distinct from combined game total", () => {
  const g = game({
    markets: [
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: -110, point: 220.5 },
          { name: "Under", price: -110, point: 220.5 },
        ],
      },
      {
        key: "team_totals",
        outcomes: [
          { name: "Boston Celtics Over", price: -110, point: 112.5 },
          { name: "Boston Celtics Under", price: -110, point: 112.5 },
        ],
      },
    ],
  });
  const rows = extractTeamPostedProps(g, "Boston Celtics");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.market === "Team Total"));
  assert.ok(rows.every((r) => r.line === 112.5));
  assert.ok(!rows.some((r) => r.line === 220.5));
});

test("games with team props but no player-prop markets still extract", () => {
  // Odds-only event: no player_* markets (player-prop feed would be empty).
  const g = game({
    id: "odds-only",
    sport: "nba",
    homeTeam: "Miami Heat",
    awayTeam: "Chicago Bulls",
    markets: [
      {
        key: "team_totals",
        outcomes: [
          {
            name: "Miami Heat Over",
            price: -115,
            point: 112.5,
            books: [
              { book: "DraftKings", price: -115 },
              { book: "BetMGM", price: -118 },
            ],
          },
          {
            name: "Chicago Bulls Under",
            price: -105,
            point: 107.5,
            books: [{ book: "FanDuel", price: -105 }],
          },
        ],
      },
    ],
  });
  assert.equal(gameHasTeamPostedProps(g), true);
  assert.equal(extractTeamPostedProps(g, "Miami Heat").length, 1);
  assert.equal(extractTeamPostedProps(g, "Chicago Bulls").length, 1);
  assert.equal(
    extractTeamPostedProps(g, "Miami Heat")[0]!.sportsbook,
    "DraftKings",
  );
});
