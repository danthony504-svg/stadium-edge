import assert from "node:assert/strict";
import test from "node:test";

import { buildHomeSports, HOME_SPORT_IDS } from "./homeSports.ts";

const CATALOG_ORDER = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
] as const;

test("Home sports row uses fixed MLB→NFL→NCAAF… order", () => {
  assert.deepEqual([...HOME_SPORT_IDS], [
    "mlb",
    "nfl",
    "ncaaf",
    "wnba",
    "nba",
    "nhl",
    "soccer",
    "tennis",
    "ufc",
  ]);
});

test("buildHomeSports follows HOME_SPORT_IDS, not catalog order", () => {
  const catalog = CATALOG_ORDER.map((id) => ({ id }));
  assert.deepEqual(
    buildHomeSports(catalog).map((s) => s.id),
    [...HOME_SPORT_IDS],
  );

  // Precondition matching lib/sports.ts: football appended after tennis.
  assert.ok(CATALOG_ORDER.indexOf("nfl") > CATALOG_ORDER.indexOf("wnba"));
  assert.ok(HOME_SPORT_IDS.indexOf("nfl") < HOME_SPORT_IDS.indexOf("wnba"));
});

test("Home sports order ignores catalog reshuffles and availability", () => {
  const reshuffled = [...CATALOG_ORDER].reverse().map((id) => ({ id }));
  assert.deepEqual(
    buildHomeSports(reshuffled).map((s) => s.id),
    [...HOME_SPORT_IDS],
  );
});
