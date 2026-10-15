import assert from "node:assert/strict";
import test from "node:test";
import {
  omitScoreOutcomesForPeriodQueries,
  publishedClientWouldRescalePeriodCovers,
  requestAsksNonFullGamePeriod,
} from "../src/lib/gameOutcomePayload.ts";

const corrected = {
  sport: "nfl",
  engineVersion: "ppg-per-drive-v1",
  homeWinProbability: 0.58,
  awayWinProbability: 0.42,
  coverHitRates: {
    "fg-ml": 0.58,
    "q3-spread": 0.61,
  },
  outcomes: { homeScores: [24, 21, 27], awayScores: [17, 20, 14] },
};

test("a full-game response keeps score arrays and the engine stamp", () => {
  const body = omitScoreOutcomesForPeriodQueries(corrected, [
    { period: "fg" },
    { period: undefined },
  ]);
  assert.equal(requestAsksNonFullGamePeriod([{ period: "fg" }]), false);
  assert.equal(body.engineVersion, "ppg-per-drive-v1");
  assert.equal(body.outcomes?.homeScores.length, 3);
  assert.equal(publishedClientWouldRescalePeriodCovers(body), true);
});

test("a period request omits the arrays the published client rescales", () => {
  const queries = [{ period: "fg" }, { period: "q3" }];
  const body = JSON.parse(
    JSON.stringify(omitScoreOutcomesForPeriodQueries(corrected, queries)),
  ) as typeof corrected;
  assert.equal(requestAsksNonFullGamePeriod(queries), true);
  assert.equal(body.engineVersion, "ppg-per-drive-v1");
  assert.equal("outcomes" in body, false);
  assert.equal(body.coverHitRates["fg-ml"], 0.58);
  assert.equal(publishedClientWouldRescalePeriodCovers(body), false);
});
