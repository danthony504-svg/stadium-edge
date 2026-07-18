import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInjuryContextPack,
  COACH_INJURY_FEED_UNAVAILABLE_MESSAGE,
  isInjuryIntelAsk,
} from "./injuryFeed.ts";

test("isInjuryIntelAsk detects injury and lineup questions", () => {
  assert.equal(isInjuryIntelAsk("Who is questionable tonight?"), true);
  assert.equal(isInjuryIntelAsk("Any injury impact on props for Lakers?"), true);
  assert.equal(isInjuryIntelAsk("Build me a 5 leg parlay"), false);
});

test("buildInjuryContextPack marks feed unavailable when a sport fetch fails", () => {
  const pack = buildInjuryContextPack(
    ["nba"],
    new Map([["nba", null]]),
    [{ sport: "nba", game: "A @ B", away: "A", home: "B" }],
  );
  assert.equal(pack.injuryFeed.connected, false);
  assert.deepEqual(pack.injuryFeed.sportsUnavailable, ["nba"]);
  assert.equal(Object.keys(pack.matchupInjuries).length, 0);
  assert.equal(pack.injuryClearedGames.length, 0);
});

test("buildInjuryContextPack records confirmed-clear games", () => {
  const pack = buildInjuryContextPack(
    ["nba"],
    new Map([
      [
        "nba",
        [
          { team: "Boston Celtics", teamAbbr: "BOS", entries: [] },
          { team: "Los Angeles Lakers", teamAbbr: "LAL", entries: [] },
        ],
      ],
    ]),
    [{ sport: "nba", game: "Lakers @ Celtics", away: "Los Angeles Lakers", home: "Boston Celtics" }],
  );
  assert.equal(pack.injuryFeed.connected, true);
  assert.deepEqual(pack.injuryClearedGames, ["Lakers @ Celtics"]);
});

test("coach unavailable injury message is stable", () => {
  assert.match(COACH_INJURY_FEED_UNAVAILABLE_MESSAGE, /won't guess or invent/i);
});
