import assert from "node:assert/strict";
import test from "node:test";
import {
  publishedClientHitForPick,
  publishedClientWouldRescalePeriodCovers,
  requestAsksNonFullGamePeriod,
  sealPublishedClientPeriodQueries,
} from "../src/lib/gameOutcomePayload.ts";

const corrected = {
  sport: "nfl",
  simulations: 10000,
  engineVersion: "ppg-per-drive-v1",
  homeWinProbability: 0.58,
  awayWinProbability: 0.42,
  coverHitRates: {
    "fg-ml": 0.58,
    "fg-spread": 0.54,
    "q3-ml": 0.91,
    "q3-spread": 0.61,
  },
  outcomes: { homeScores: [24, 21, 27], awayScores: [17, 20, 14] },
};

const periodMl = { id: "q3-ml", kind: "ml" as const, period: "q3", teamSide: "home" as const };
const periodSpread = { id: "q3-spread", kind: "spread" as const, period: "q3", teamSide: "home" as const };
const fullMl = { id: "fg-ml", kind: "ml" as const, period: "fg", teamSide: "home" as const };

test("a full-game response keeps score arrays and the engine stamp", () => {
  const body = sealPublishedClientPeriodQueries(corrected, [
    { id: "fg-ml", period: "fg" },
    { id: "fg-spread", period: undefined },
  ]);
  assert.equal(requestAsksNonFullGamePeriod([{ period: "fg" }]), false);
  assert.equal(body.engineVersion, "ppg-per-drive-v1");
  assert.equal(body.outcomes?.homeScores.length, 3);
  assert.equal(body.coverHitRates["q3-ml"], 0.91);
  assert.equal(publishedClientWouldRescalePeriodCovers(body), true);
  assert.equal(publishedClientHitForPick(body, fullMl), 0.58);
});

test("omitting outcomes still lets the published client grade a period moneyline from the full-game win probability", () => {
  const omitted = { ...corrected, outcomes: undefined, coverHitRates: { "fg-ml": 0.58 } };
  assert.equal(publishedClientWouldRescalePeriodCovers(omitted), false);
  assert.equal(publishedClientHitForPick(omitted, periodMl), 0.58);
  assert.equal(publishedClientHitForPick(omitted, periodSpread), null);
});

test("a period request seals rates the published client would grade or fall back from", () => {
  const queries = [
    { id: "fg-ml", period: "fg", kind: "ml" },
    { id: "q3-ml", period: "q3", kind: "ml" },
    { id: "q3-spread", period: "q3", kind: "spread" },
  ];
  const body = JSON.parse(
    JSON.stringify(sealPublishedClientPeriodQueries(corrected, queries)),
  ) as typeof corrected;
  assert.equal(requestAsksNonFullGamePeriod(queries), true);
  assert.equal(body.engineVersion, "ppg-per-drive-v1");
  assert.equal("outcomes" in body, false);
  assert.equal(publishedClientWouldRescalePeriodCovers(body), false);
  assert.equal(body.homeWinProbability, 0.58);
  assert.equal(body.coverHitRates["fg-ml"], 0.58);
  assert.equal(body.coverHitRates["q3-ml"], 0);
  assert.equal(body.coverHitRates["q3-spread"], 0);
  assert.equal(publishedClientHitForPick(body, periodMl), null);
  assert.equal(publishedClientHitForPick(body, periodSpread), null);
  assert.equal(publishedClientHitForPick(body, fullMl), 0.58);
});
