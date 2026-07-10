import assert from "node:assert/strict";
import test from "node:test";

import type { OddsGame } from "./api.ts";
import { isRenderableOddsGame, oddsRowsFromQuery } from "./sportFeed.ts";

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
