/**
 * Synthetic Coach board fixtures for offline pipeline / integrity / mapping audits.
 * No live provider calls — shapes mirror production odds/prop rows.
 */

export type FixtureOutcome = {
  name: string;
  price: number;
  point?: number;
  description?: string;
};

export type FixtureMarket = {
  key: string;
  outcomes: FixtureOutcome[];
};

export type FixtureGame = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeTeamId?: string;
  awayTeamId?: string;
  markets: FixtureMarket[];
};

export type FixtureProp = {
  id: string;
  sport: string;
  game: string;
  gameId: string;
  player: string;
  team?: string;
  opponent?: string;
  market: string;
  side: "Over" | "Under";
  line: number;
  odds: number;
  book: string;
  startsAt: string;
  /** Provenance — must survive to final pick. */
  providerEventId: string;
  providerMarketKey: string;
  providerOutcomeName: string;
};

export type BoardFixture = {
  id: string;
  oddsGames: FixtureGame[];
  espnGames: FixtureGame[];
  propPool: FixtureProp[];
};

function isoHoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

/** Minimal multi-sport board with traceable provider provenance. */
export function buildSyntheticBoardFixture(): BoardFixture {
  const start = isoHoursFromNow(6);
  const nhl: FixtureGame = {
    id: "evt-nhl-1",
    sport: "nhl",
    homeTeam: "New York Rangers",
    awayTeam: "Anaheim Ducks",
    commenceTime: start,
    homeTeamId: "nyr",
    awayTeamId: "ana",
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "New York Rangers", price: -130 },
          { name: "Anaheim Ducks", price: 110 },
        ],
      },
      {
        key: "spreads",
        outcomes: [
          { name: "New York Rangers", price: -110, point: -1.5 },
          { name: "Anaheim Ducks", price: -110, point: 1.5 },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: -115, point: 6.5 },
          { name: "Under", price: -105, point: 6.5 },
        ],
      },
    ],
  };

  const nfl: FixtureGame = {
    id: "evt-nfl-1",
    sport: "nfl",
    homeTeam: "Kansas City Chiefs",
    awayTeam: "Buffalo Bills",
    commenceTime: start,
    homeTeamId: "kc",
    awayTeamId: "buf",
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "Kansas City Chiefs", price: -150 },
          { name: "Buffalo Bills", price: 130 },
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
          { name: "Over", price: -110, point: 47.5 },
          { name: "Under", price: -110, point: 47.5 },
        ],
      },
      {
        key: "player_pass_yds",
        outcomes: [
          { name: "Over", price: -115, point: 275.5, description: "Patrick Mahomes" },
          { name: "Under", price: -105, point: 275.5, description: "Patrick Mahomes" },
        ],
      },
      {
        key: "player_anytime_td",
        outcomes: [
          { name: "Yes", price: 150, description: "Travis Kelce" },
        ],
      },
      {
        key: "player_sacks",
        outcomes: [
          { name: "Over", price: 100, point: 0.5, description: "Chris Jones" },
          { name: "Under", price: -130, point: 0.5, description: "Chris Jones" },
        ],
      },
    ],
  };

  const soccer: FixtureGame = {
    id: "evt-soc-1",
    sport: "soccer",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    commenceTime: start,
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "Arsenal", price: -120 },
          { name: "Chelsea", price: 220 },
          { name: "Draw", price: 240 },
        ],
      },
      {
        key: "player_goal_scorer_anytime",
        outcomes: [{ name: "Yes", price: 180, description: "Bukayo Saka" }],
      },
    ],
  };

  const props: FixtureProp[] = [
    {
      id: "prop-1",
      sport: "nfl",
      game: "Buffalo Bills @ Kansas City Chiefs",
      gameId: "evt-nfl-1",
      player: "Patrick Mahomes",
      team: "Kansas City Chiefs",
      opponent: "Buffalo Bills",
      market: "player_pass_yds",
      side: "Over",
      line: 275.5,
      odds: -115,
      book: "draftkings",
      startsAt: start,
      providerEventId: "evt-nfl-1",
      providerMarketKey: "player_pass_yds",
      providerOutcomeName: "Over",
    },
    {
      id: "prop-2",
      sport: "nfl",
      game: "Buffalo Bills @ Kansas City Chiefs",
      gameId: "evt-nfl-1",
      player: "Travis Kelce",
      team: "Kansas City Chiefs",
      opponent: "Buffalo Bills",
      market: "player_anytime_td",
      side: "Over",
      line: 0.5,
      odds: 150,
      book: "draftkings",
      startsAt: start,
      providerEventId: "evt-nfl-1",
      providerMarketKey: "player_anytime_td",
      providerOutcomeName: "Yes",
    },
    {
      id: "prop-3",
      sport: "nfl",
      game: "Buffalo Bills @ Kansas City Chiefs",
      gameId: "evt-nfl-1",
      player: "Chris Jones",
      team: "Kansas City Chiefs",
      opponent: "Buffalo Bills",
      market: "player_sacks",
      side: "Over",
      line: 0.5,
      odds: 100,
      book: "fanduel",
      startsAt: start,
      providerEventId: "evt-nfl-1",
      providerMarketKey: "player_sacks",
      providerOutcomeName: "Over",
    },
    {
      id: "prop-bad-map",
      sport: "nfl",
      game: "Buffalo Bills @ Kansas City Chiefs",
      gameId: "evt-nfl-1",
      player: "Wrong Player",
      team: "Anaheim Ducks", // intentional mapping bug fixture
      opponent: "Buffalo Bills",
      market: "player_pass_yds",
      side: "Over",
      line: 199.5,
      odds: -110,
      book: "draftkings",
      startsAt: start,
      providerEventId: "evt-nfl-1",
      providerMarketKey: "player_pass_yds",
      providerOutcomeName: "Over",
    },
    {
      id: "prop-fabricated",
      sport: "nfl",
      game: "Buffalo Bills @ Kansas City Chiefs",
      gameId: "evt-nfl-1",
      player: "Ghost Runner",
      team: "Kansas City Chiefs",
      opponent: "Buffalo Bills",
      market: "player_rush_yds",
      side: "Over",
      line: 999.5, // not on provider board
      odds: -110,
      book: "invented",
      startsAt: start,
      providerEventId: "evt-missing",
      providerMarketKey: "player_rush_yds",
      providerOutcomeName: "Over",
    },
  ];

  return {
    id: "synthetic-v1",
    oddsGames: [nhl, nfl, soccer],
    espnGames: [nhl, nfl, soccer],
    propPool: props,
  };
}
