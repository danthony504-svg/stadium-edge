import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recommendationIdentity,
  utcDayStart,
} from "../src/lib/appPerformance.ts";

const base = {
  source: "coach" as const,
  sport: "nfl",
  providerEventId: "401547378",
  game: "Away @ Home",
  market: "Spread",
  selection: "Away +3.5",
  line: "+3.5",
  odds: -110,
};

test("recommendation identity deduplicates a repeated delivered pick", () => {
  assert.equal(recommendationIdentity(base), recommendationIdentity({ ...base, game: " Away  @  Home " }));
});

test("recommendation identity retains event and source distinctions", () => {
  assert.notEqual(recommendationIdentity(base), recommendationIdentity({ ...base, providerEventId: "other" }));
  assert.notEqual(recommendationIdentity(base), recommendationIdentity({ ...base, source: "hot_picks" }));
});

test("UTC daily boundary is stable across local timezones", () => {
  assert.equal(utcDayStart(new Date("2026-09-07T23:59:59-11:00")).toISOString(), "2026-09-08T00:00:00.000Z");
});
