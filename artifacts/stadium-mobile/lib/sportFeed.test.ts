import assert from "node:assert/strict";
import test from "node:test";

import type { OddsGame } from "./api.ts";
import {
  isCurrentSportFeedReady,
  isRenderableOddsGame,
  oddsRowsFromQuery,
  oddsPayloadFromQuery,
  safeMarkets,
} from "./sportFeed.ts";

test("oddsRowsFromQuery reads Home generation-tagged payload", () => {
  const rows: OddsGame[] = [
    {
      id: "a",
      sport: "ufc",
      awayTeam: "Fighter A",
      homeTeam: "Fighter B",
      commenceTime: "2026-07-10T22:00:00Z",
      markets: [],
    },
  ];
  const payload = { gen: 2, league: "ufc", rows };
  assert.deepEqual(oddsRowsFromQuery(payload, "ufc"), rows);
  assert.deepEqual(oddsRowsFromQuery(payload, "mlb"), []);
});

test("oddsRowsFromQuery reads plain array cache", () => {
  const rows: OddsGame[] = [
    {
      id: "b",
      sport: "ufc",
      awayTeam: "X",
      homeTeam: "Y",
      commenceTime: "2026-07-10T23:00:00Z",
      markets: [],
    },
  ];
  assert.deepEqual(oddsRowsFromQuery(rows, "ufc"), rows);
});

test("oddsRowsFromQuery ignores malformed object without rows", () => {
  assert.deepEqual(oddsRowsFromQuery({ gen: 1, league: "ufc" }, "ufc"), []);
});

test("oddsRowsFromQuery reads MLB Home cache payload", () => {
  const rows: OddsGame[] = [
    {
      id: "mlb-1",
      sport: "mlb",
      awayTeam: "New York Yankees",
      homeTeam: "Boston Red Sox",
      commenceTime: "2026-07-10T23:00:00Z",
      markets: [{ key: "h2h", outcomes: [] }],
    },
  ];
  assert.deepEqual(oddsRowsFromQuery({ gen: 1, league: "mlb", rows }, "mlb"), rows);
  assert.deepEqual(oddsPayloadFromQuery({ gen: 1, league: "mlb", rows }, "mlb").rows.length, 1);
});

test("oddsRowsFromQuery reads WNBA Home cache payload", () => {
  const rows: OddsGame[] = [
    {
      id: "wnba-1",
      sport: "wnba",
      awayTeam: "Liberty",
      homeTeam: "Aces",
      commenceTime: "2026-07-10T23:00:00Z",
      markets: [],
    },
  ];
  assert.deepEqual(oddsRowsFromQuery({ gen: 3, league: "wnba", rows }, "wnba"), rows);
});

test("oddsRowsFromQuery returns empty for null/undefined cache", () => {
  assert.deepEqual(oddsRowsFromQuery(null, "wnba"), []);
  assert.deepEqual(oddsRowsFromQuery(undefined, "wnba"), []);
});

test("isCurrentSportFeedReady ignores in-flight refetch when success payload matches", () => {
  const payload = { gen: 1, league: "mlb", rows: [] as OddsGame[] };
  assert.equal(
    isCurrentSportFeedReady({
      data: payload,
      sport: "mlb",
      gen: 1,
      isSuccess: true,
      isPlaceholderData: false,
    }),
    true,
  );
  assert.equal(
    isCurrentSportFeedReady({
      data: payload,
      sport: "mlb",
      gen: 2,
      isSuccess: true,
    }),
    false,
    "stale sport-switch generation must not paint",
  );
  assert.equal(
    isCurrentSportFeedReady({
      data: payload,
      sport: "nfl",
      gen: 1,
      isSuccess: true,
    }),
    false,
  );
  assert.equal(
    isCurrentSportFeedReady({
      data: payload,
      sport: "mlb",
      gen: 1,
      isSuccess: false,
    }),
    false,
  );
});

test("oddsPayloadFromQuery normalizes legacy plain-array cache", () => {
  const rows: OddsGame[] = [
    {
      id: "wnba-2",
      sport: "wnba",
      awayTeam: "Storm",
      homeTeam: "Sun",
      commenceTime: "2026-07-10T24:00:00Z",
      markets: [{ key: "h2h", outcomes: [] }],
    },
  ];
  const p = oddsPayloadFromQuery(rows, "wnba");
  assert.equal(p.league, "wnba");
  assert.equal(p.rows.length, 1);
});

test("safeMarkets returns [] for corrupt markets", () => {
  assert.deepEqual(safeMarkets({ markets: undefined as unknown as OddsGame["markets"] }), []);
  assert.deepEqual(safeMarkets({ markets: {} as unknown as OddsGame["markets"] }), []);
  assert.deepEqual(
    safeMarkets({ markets: [{ key: "h2h", outcomes: [] }] }),
    [{ key: "h2h", outcomes: [] }],
  );
});

test("isRenderableOddsGame requires core fields", () => {
  assert.equal(
    isRenderableOddsGame({
      id: "1",
      sport: "ufc",
      awayTeam: "A",
      homeTeam: "B",
      commenceTime: "2026-07-10T22:00:00Z",
      markets: [],
    }),
    true,
  );
  assert.equal(
    isRenderableOddsGame({
      id: "",
      sport: "ufc",
      awayTeam: "A",
      homeTeam: "B",
      commenceTime: "2026-07-10T22:00:00Z",
      markets: [],
    }),
    false,
  );
});
