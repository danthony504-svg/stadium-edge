import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OddsGame } from "./api.ts";
import {
  extractTeamPostedProps,
  findOddsGameForMatchup,
  fullTeamIdentityMatch,
  gameHasTeamPostedProps,
  isTeamPropsSport,
  isTeamTotalMarketKey,
  parseTeamTotalOutcome,
  resolveOutcomeTeam,
  TEAM_PROP_PROVIDER_KEYS,
  TEAM_PROPS_SPORTS,
  teamPostedPropToRealOdds,
} from "./teamPostedProps.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const slipKey = (game: string, market: string, pick: string) =>
  `${game}|${market}|${pick}`.toLowerCase();

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

test("missing / stale matchup identity fails closed", () => {
  const live = game({
    id: "live",
    homeTeam: "Dallas Cowboys",
    awayTeam: "New York Giants",
    markets: [
      {
        key: "team_totals",
        outcomes: [
          { name: "Dallas Cowboys Over", price: -110, point: 24.5 },
          { name: "Dallas Cowboys Under", price: -110, point: 24.5 },
        ],
      },
    ],
  });
  assert.equal(fullTeamIdentityMatch("Dallas Cowboys", "Dallas Cowboys"), true);
  assert.equal(fullTeamIdentityMatch("Cowboys", "Dallas Cowboys"), false);
  // Wrong opponent / nickname-only / empty feed → no matchup bind.
  assert.equal(findOddsGameForMatchup([live], "Dallas Cowboys", "Philadelphia Eagles"), null);
  assert.equal(findOddsGameForMatchup([live], "Cowboys", "Giants"), null);
  assert.equal(findOddsGameForMatchup([], "Dallas Cowboys", "New York Giants"), null);
  // Full verified names still bind — extract stays honest for that event.
  const hit = findOddsGameForMatchup([live], "Dallas Cowboys", "New York Giants");
  assert.equal(hit?.id, "live");
  assert.equal(extractTeamPostedProps(hit!, "Dallas Cowboys").length, 2);
});

test("missing price / missing sportsbook / missing quote stay honest", () => {
  const g = game({
    markets: [
      {
        key: "team_totals",
        outcomes: [
          // price null → dropped (never invent -110)
          { name: "Boston Celtics Over", price: Number.NaN, point: 112.5 },
          // valid price, no books[] → sportsbook null; quote always null today
          { name: "Boston Celtics Under", price: -108, point: 112.5 },
        ],
      },
    ],
  });
  const rows = extractTeamPostedProps(g, "Boston Celtics");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.side, "Under");
  assert.equal(rows[0]!.sportsbook, null);
  assert.equal(rows[0]!.quoteUpdatedAt, null);
});

test("slip keys: Team Total does not collide with game Total or player props", () => {
  const sports = ["nba", "nfl", "mlb", "nhl", "ncaaf", "ncaab", "wnba", "soccer"] as const;
  for (const sport of sports) {
    const g = game({
      sport,
      homeTeam: "Home Team Alpha",
      awayTeam: "Away Team Beta",
      markets: [
        {
          key: "totals",
          outcomes: [
            { name: "Over", price: -110, point: 45.5 },
            { name: "Under", price: -110, point: 45.5 },
          ],
        },
        {
          key: "team_totals",
          outcomes: [
            {
              name: "Home Team Alpha Over",
              price: -115,
              point: 22.5,
              books: [{ book: "DraftKings", price: -115 }],
            },
            {
              name: "Home Team Alpha Under",
              price: -105,
              point: 22.5,
              books: [{ book: "FanDuel", price: -105 }],
            },
            {
              name: "Away Team Beta Over",
              price: -110,
              point: 21.5,
              books: [{ book: "Caesars", price: -110 }],
            },
            {
              name: "Away Team Beta Under",
              price: -110,
              point: 21.5,
              books: [{ book: "Caesars", price: -110 }],
            },
          ],
        },
        {
          key: "alternate_team_totals",
          outcomes: [
            {
              name: "Home Team Alpha Over",
              price: -140,
              point: 25.5,
              books: [{ book: "BetMGM", price: -140 }],
            },
          ],
        },
      ],
    });
    const home = extractTeamPostedProps(g, "Home Team Alpha");
    const away = extractTeamPostedProps(g, "Away Team Beta");
    assert.equal(home.length, 3, sport);
    assert.equal(away.length, 2, sport);

    const keys = new Set<string>();
    for (const row of [...home, ...away]) {
      const e = teamPostedPropToRealOdds(row);
      assert.match(e.market, /Team Total/i, sport);
      assert.notEqual(e.market, "Total", sport);
      assert.notEqual(e.market, "Moneyline", sport);
      assert.notEqual(e.market, "Spread", sport);
      const k = slipKey(e.game, e.market, e.pick);
      assert.equal(keys.has(k), false, `duplicate slip key ${k}`);
      keys.add(k);
      // Player-prop style legs use a different market string — must not collide.
      const playerKey = slipKey(
        e.game,
        "Player Points",
        `Some Player Over 22.5 Points`,
      );
      assert.notEqual(k, playerKey);
      const gameTotalKey = slipKey(e.game, "Total", "Over 45.5");
      assert.notEqual(k, gameTotalKey);
    }
  }
});

test("Team Props sports align with PROPS_SPORTS; ncaaf/ncaab stay included", () => {
  // Avoid importing api.ts values (heavy ESM graph); assert against the source
  // constant and the Team Props allow-list instead.
  const apiSrc = readFileSync(join(root, "lib/api.ts"), "utf8");
  const m = apiSrc.match(/export const PROPS_SPORTS = \[([^\]]+)\]/);
  assert.ok(m, "PROPS_SPORTS export missing");
  const propsSports = m![1]!
    .split(",")
    .map((s) => s.replace(/["'\s]/g, ""))
    .filter(Boolean);
  assert.deepEqual([...TEAM_PROPS_SPORTS].sort(), [...propsSports].sort());
  assert.equal(isTeamPropsSport("ncaaf"), true);
  assert.equal(isTeamPropsSport("ncaab"), true);
  assert.equal(isTeamPropsSport("tennis"), false);
});

test("source regression: Props gate + Team mode odds-only; Coach untouched; no buildRealOdds in sheet", () => {
  const propsSrc = readFileSync(join(root, "app/(tabs)/props.tsx"), "utf8");
  const sheetSrc = readFileSync(join(root, "components/TeamPropsSheet.tsx"), "utf8");
  assert.ok(propsSrc.includes('featureId="props"'));
  assert.ok(propsSrc.includes('propsMode === "team"'));
  assert.ok(propsSrc.includes('queryKey: ["odds", sport]'));
  assert.ok(propsSrc.includes("extractTeamPostedProps") || propsSrc.includes("gameHasTeamPostedProps"));
  // Team matchup list must not depend on getProps / player-prop emptiness.
  assert.ok(propsSrc.includes("Upcoming matchups from the odds feed"));
  assert.ok(!sheetSrc.includes("buildRealOdds"));
  assert.ok(sheetSrc.includes("findOddsGameForMatchup"));
  assert.ok(sheetSrc.includes("sampleCaption") || sheetSrc.includes("n="));
  // Matchup Props layout: role filters, top-per-role ranking, opposing defense notes.
  assert.ok(sheetSrc.includes("matchupFilterChips"));
  assert.ok(sheetSrc.includes("rankConsiderPicksByRole"));
  assert.ok(sheetSrc.includes("oppDefenseNoteForMarket"));
  assert.ok(!sheetSrc.includes("Add to Slip"));
  for (const action of ["useBetSlip", "<SlipBar", "onAdd", "addLeg", "removeLeg", "hasLeg", "teamPostedPropToRealOdds"]) {
    assert.ok(!sheetSrc.includes(action), `Matchup sheet must be read-only: ${action}`);
  }
  assert.ok(sheetSrc.includes("Position-specific") || sheetSrc.includes("position-specific") || sheetSrc.includes("team-wide"));
  // This PR must not edit Coach selection / sim / quality floors.
  assert.equal(propsSrc.includes("buildParlay"), false);
});

test("Matchup Props sheet section order: header → defense → players with filters → form", () => {
  const sheetSrc = readFileSync(join(root, "components/TeamPropsSheet.tsx"), "utf8");
  const markers = [
    "SECTION_ORDER:1 compact matchup header",
    "SECTION_ORDER:3 both teams defensive matchup stats",
    "SECTION_ORDER:4 top players by role",
    "SECTION_ORDER:2 market/role filter chips",
    "SECTION_ORDER:5 detailed form + recent-game history",
  ];
  let prev = -1;
  for (const m of markers) {
    const idx = sheetSrc.indexOf(m);
    assert.ok(idx >= 0, `missing section marker: ${m}`);
    assert.ok(idx > prev, `section out of order: ${m}`);
    prev = idx;
  }
  // Players must appear before team totals and before detailed form.
  assert.ok(sheetSrc.indexOf("SECTION_ORDER:4") < sheetSrc.indexOf("SECTION_ORDER:5"));
  assert.ok(sheetSrc.indexOf("SECTION_ORDER:2") > sheetSrc.indexOf("SECTION_ORDER:4"));
});

test("Matchup Props omits Team Totals and preserves player loading and empty states", () => {
  const sheetSrc = readFileSync(join(root, "components/TeamPropsSheet.tsx"), "utf8");
  for (const removed of ['title="TEAM TOTALS"', "team-totals-toggle", "PostedTeamPropList", "extractTeamPostedProps", "setTeamTotalsExpanded"]) {
    assert.ok(!sheetSrc.includes(removed), removed);
  }
  for (const state of ["matchup-market-filters", "matchup-players-loading", "matchup-players-empty", "matchup-players-filter-empty"]) {
    assert.ok(sheetSrc.includes(`testID="${state}"`));
  }
  assert.ok(sheetSrc.includes("considerEmpty ||"));
  assert.ok(sheetSrc.includes("TOP PLAYERS BY ROLE"));
});


test("market filters live inside the player section above loading and cards", () => {
  const src = readFileSync(join(root, "components/TeamPropsSheet.tsx"), "utf8");
  const start = src.indexOf('<Section title="TOP PLAYERS BY ROLE">');
  const end = src.indexOf("</Section>", start);
  const filters = src.indexOf('testID="matchup-market-filters"');
  assert.ok(start < filters && filters < end);
  assert.ok(filters < src.indexOf('testID="matchup-players-loading"'));
  assert.ok(filters < src.indexOf("<ConsiderPickCard"));
});
