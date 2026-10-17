import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  availablePropCategories,
  collectBoardMarkets,
  isCurrentPropsBoardReady,
  propCategoriesForSport,
} from "./propCategories.ts";

test("propCategoriesForSport never falls back to MLB for other sports", () => {
  const mlb = propCategoriesForSport("mlb").map((c) => c.id);
  assert.ok(mlb.includes("hits"));
  assert.ok(mlb.includes("k"));

  const nba = propCategoriesForSport("nba");
  assert.ok(nba.some((c) => c.markets.includes("player_points")));
  assert.ok(!nba.some((c) => c.markets.some((m) => m.startsWith("batter_"))));

  const nfl = propCategoriesForSport("nfl");
  assert.ok(nfl.some((c) => c.markets.includes("player_pass_yds")));
  assert.ok(!nfl.some((c) => c.id === "hits"));

  const nhl = propCategoriesForSport("nhl");
  assert.ok(nhl.some((c) => c.markets.includes("player_goals")));

  const soccer = propCategoriesForSport("soccer");
  assert.ok(soccer.some((c) => c.markets.includes("player_goal_scorer_anytime")));

  // Browse-only / unknown — empty, never MLB defaults.
  assert.deepEqual(propCategoriesForSport("tennis"), []);
  assert.deepEqual(propCategoriesForSport("tabletennis"), []);
  assert.deepEqual(propCategoriesForSport("ufc"), []);
  assert.deepEqual(propCategoriesForSport("not-a-sport"), []);
});

test("availablePropCategories intersects catalog with board markets", () => {
  const nbaBoard = availablePropCategories("nba", ["player_points", "player_assists"]);
  assert.deepEqual(
    nbaBoard.map((c) => c.id).sort(),
    ["assists", "points"],
  );

  // Empty board → no categories (caller hides the list).
  assert.deepEqual(availablePropCategories("nba", []), []);
  assert.deepEqual(availablePropCategories("mlb", new Set()), []);

  // Tennis never invents MLB categories from stray markets.
  assert.deepEqual(availablePropCategories("tennis", ["batter_hits"]), []);
});

test("collectBoardMarkets gathers unique market keys", () => {
  const markets = collectBoardMarkets([
    {
      props: [
        { market: "player_points" },
        { market: "player_points" },
        { market: "player_rebounds" },
      ],
    },
    { props: [{ market: "player_assists" }] },
  ]);
  assert.deepEqual([...markets].sort(), ["player_assists", "player_points", "player_rebounds"]);
});

test("isCurrentPropsBoardReady blocks cross-sport and stale unordered payloads", () => {
  const nbaGames = [{ sport: "nba" }, { sport: "nba" }];

  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 2,
      dataGen: 2,
      dataSport: "nba",
      games: nbaGames,
      isBrowseSport: false,
    }),
    true,
  );

  // Browse-only pill must never paint a props board.
  assert.equal(
    isCurrentPropsBoardReady({
      sport: "tennis",
      gen: 1,
      dataGen: 1,
      dataSport: "mlb",
      games: [{ sport: "mlb" }],
      isBrowseSport: true,
    }),
    false,
  );

  // Wrong league stamp.
  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 2,
      dataGen: 2,
      dataSport: "mlb",
      games: [{ sport: "mlb" }],
      isBrowseSport: false,
    }),
    false,
  );

  // Game rows from another sport.
  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 2,
      dataGen: 2,
      dataSport: "nba",
      games: [{ sport: "nba" }, { sport: "mlb" }],
      isBrowseSport: false,
    }),
    false,
  );

  // Late response: old generation + no confirming league → reject.
  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 3,
      dataGen: 1,
      dataSport: null,
      games: nbaGames,
      isBrowseSport: false,
    }),
    false,
  );

  // Same-sport cache after a gen bump is still paint-safe.
  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 3,
      dataGen: 1,
      dataSport: "nba",
      games: nbaGames,
      isBrowseSport: false,
    }),
    true,
  );

  // Empty board (honest no props) is ready — UI shows empty copy, not loading.
  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 1,
      dataGen: 1,
      dataSport: "nba",
      games: [],
      isBrowseSport: false,
    }),
    true,
  );

  assert.equal(
    isCurrentPropsBoardReady({
      sport: "nba",
      gen: 1,
      dataGen: 1,
      dataSport: "nba",
      games: null,
      isBrowseSport: false,
    }),
    false,
  );
});

test("props tab wires sport-derived categories, race guard, empty copy, fixed header", () => {
  const src = readFileSync(join(process.cwd(), "app/(tabs)/props.tsx"), "utf8");

  assert.match(src, /from\s+"@\/lib\/propCategories"/);
  assert.match(src, /availablePropCategories/);
  assert.match(src, /isCurrentPropsBoardReady/);
  assert.match(src, /selectSport/);
  assert.match(src, /sportFetchGenRef/);
  assert.match(src, /setActiveCategoryId\(null\)/);

  // No hardcoded MLB-only PROP_CATEGORIES constant and no sticky overlay header.
  assert.doesNotMatch(src, /const\s+PROP_CATEGORIES\s*=/);
  assert.doesNotMatch(src, /stickyHeaderIndices/);

  // Empty board copy must not claim the sport never has props.
  assert.match(src, /No player props available right now\./);
  assert.doesNotMatch(src, /No props in the window/);
  assert.doesNotMatch(src, /No player props are posted for/);

  // Browse-only selIdx must not Math.max-fallback to MLB (index 0).
  assert.doesNotMatch(src, /Math\.max\(\s*0\s*,\s*propsSports\.findIndex/);
  assert.match(src, /selIdx\s*>=\s*0\s*\?\s*sportQueries\[selIdx\]/);

  // Category open must use the active sport board + generation guard.
  assert.match(src, /openCategory\s*=\s*\(\s*cat:\s*PropCategory\s*\)/);
  assert.match(src, /sportFetchGenRef\.current\s*!==\s*gen/);
});
