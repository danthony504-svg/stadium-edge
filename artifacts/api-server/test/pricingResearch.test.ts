import assert from "node:assert/strict";
import test from "node:test";
import { americanToProb } from "../src/lib/oddsAltDevig.ts";
import {
  devig, fairConsensus, interpolateLadder, marketKey, reconstructOneSided, repairLadder,
  type BookQuote, type DevigMethod, type MarketIdentity,
} from "../src/lib/pricingResearch/fairOdds.ts";
import { receptionPosterior } from "../src/lib/pricingResearch/receptions.ts";
import { replayPricing } from "../src/lib/pricingResearch/replay.ts";
import { simulateNflGameScript, priceNflGameScript } from "../src/lib/pricingResearch/nflGameScript.ts";
import { receivingYardsPosterior } from "../src/lib/pricingResearch/receivingYards.ts";
import { fitTetrachoric, sameGameCopula, shrinkCorrelation } from "../src/lib/pricingResearch/sameGame.ts";

const methods: DevigMethod[] = ["multiplicative", "additive", "power", "shin", "odds_ratio"];
const market: MarketIdentity = {
  sport: "nfl", eventId: "upcoming", entityId: "player", market: "player_receptions", period: "full_game", line: 4.5,
};
const asOf = 1_000_000;
const modelPrior = { version: "wr-v1", trainedThrough: 100, targetsShape: 15, targetsRate: 3, catchAlpha: 12, catchBeta: 8 };
const pair = (book: string, over: number, under: number, time = asOf - 1_000): BookQuote[] => [
  { market, book, side: "over", american: over, quotedAt: time, receivedAt: time + 500 },
  { market, book, side: "under", american: under, quotedAt: time, receivedAt: time + 500 },
];
function close(actual: number, expected: number, tolerance: number) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`);
}

test("all de-vig methods return nonnegative normalized markets", () => {
  for (const q of [[-140, 110], [400, -650], [140, 205, 260]].map(odds => odds.map(americanToProb))) {
    for (const method of methods) {
      const result = devig(q, method);
      assert.ok(result.probabilities.every(p => p > 0 && p < 1));
      close(result.probabilities.reduce((sum, p) => sum + p, 0), 1, 1e-10);
    }
  }
  const q = [-140, 110].map(americanToProb);
  close(devig(q).probabilities[0]!, 0.5538, 0.0001);
  assert.deepEqual(devig(q, "shin").probabilities, devig(q, "additive").probabilities);
  assert.equal(devig([0.02, 0.98, 0.98], "additive").method, "power");
  assert.equal(devig([0.45, 0.45]).method, "multiplicative");
});

test("exact-identity consensus drops stale, future and cross-line or cross-period quotes", () => {
  const otherThreshold = pair("wrong threshold", -400, 300).map(q => ({ ...q, market: { ...market, line: 5.5 } }));
  const wrongPeriod = pair("wrong period", -400, 300).map(q => ({ ...q, market: { ...market, period: "first_half" } }));
  const result = fairConsensus(market, [
    ...pair("a", -125, 105), ...pair("b", -130, 110), ...pair("stale", 120, -150, asOf - 950_000),
    ...pair("future", -300, 225, asOf - 500), ...otherThreshold, ...wrongPeriod,
    ...pair("one-sided", -110, -110).slice(0, 1),
  ], { asOf });
  assert.deepEqual(result?.booksUsed, ["a", "b"]);
  assert.equal(result?.probabilityBasis, "conditional_on_no_push");
  assert.ok(result?.ci80 && result.effectiveBooks > 1 && result.effectiveBooks <= 2);
  assert.notEqual(marketKey(market, "over"), marketKey(market, "under"));
  assert.equal(marketKey(market), marketKey({ ...market, market: "player_receptions_alternate" }));
});

test("one-sided reconstruction recovers the paired answer given its true margin", () => {
  const implied = [250, -330].map(americanToProb);
  const margin = implied[0]! + implied[1]! - 1;
  close(reconstructOneSided(250, margin)!.probability, devig(implied).probabilities[0]!, 1e-12);
  assert.equal(reconstructOneSided(250, 0.7), null);
});

test("ladder repair pools violations and interpolates inside known rungs", () => {
  const repaired = repairLadder([
    {line: 39.5, probability: 0.71, weight: 1}, {line: 49.5, probability: 0.57, weight: 2},
    {line: 59.5, probability: 0.585, weight: 1}, {line: 69.5, probability: 0.33, weight: 1},
  ]);
  close(repaired[1]!.probability, 0.575, 1e-12);
  close(interpolateLadder(repaired, 54.5)!, 0.575, 1e-12);
  assert.equal(interpolateLadder(repaired, 35), null);
  assert.equal(interpolateLadder(repaired, 75), null);
});

const sgpLegs = [0.55, 0.52, 0.60].map((probability, i) => ({
  market: { ...market, entityId: `athlete-${i}` }, side: "over" as const, pushFree: true, probability,
}));
const sgp = { asOf, correlationVersion: "matrix-v1", trainedThrough: 100 };

test("SGP copula reproduces independence, published examples and directional under correlation", () => {
  const identity = sameGameCopula({ ...sgp, legs: sgpLegs, correlations: [[1,0,0],[0,1,0],[0,0,1]] });
  close(identity.joint, 0.1716, 1e-12);
  const pairLegs = sgpLegs.slice(0, 2);
  for (const [rho, expected] of [[0.3, 0.3341], [0.5, 0.3687]] as const) {
    const result = sameGameCopula({ ...sgp, legs: pairLegs, correlations: [[1, rho], [rho, 1]] });
    close(result.joint, expected, 0.0012);
    close(fitTetrachoric(0.55, 0.52, result.joint), rho, 1e-6);
  }
  const result = sameGameCopula({ ...sgp, legs: sgpLegs, correlations: [[1,.45,.30],[.45,1,-.10],[.30,-.10,1]] });
  close(result.joint, 0.2315, 0.0015);
  assert.ok(result.joint >= result.bounds[0] && result.joint <= result.bounds[1]);
  const mixed = sameGameCopula({ ...sgp, legs: [sgpLegs[0]!, { ...sgpLegs[1]!, side: "under" }], correlations: [[1,.45],[.45,1]] });
  assert.ok(mixed.joint < mixed.independent);
});

test("SGP rejects invalid matrices and unsupported settlement; thin estimates shrink toward a prior", () => {
  assert.throws(() => sameGameCopula({ ...sgp, legs: sgpLegs, correlations: [[1,.9,.9],[.9,1,-.9],[.9,-.9,1]] }), /positive definite/);
  assert.throws(() => sameGameCopula({ ...sgp, legs: [sgpLegs[0]!, { ...sgpLegs[1]!, pushFree: false }], correlations: [[1,0],[0,1]] }), /unsupported/);
  close(shrinkCorrelation(0.7, 0.2, 0), 0.2, 1e-12);
  assert.ok(shrinkCorrelation(0.7, 0.2, 10) < shrinkCorrelation(0.7, 0.2, 100));
});

const games = Array.from({ length: 6 }, (_, i) => ({
  eventId: `past-${i}`, finishedAt: i + 100, availableAt: i + 110, targets: 7, catches: i % 2 === 0 ? 5 : 3, exposure: 1,
}));

test("receptions shrink opportunity and efficiency with a reproducible interval and push handling", () => {
  const input = { asOf, games, prior: modelPrior, nextExposure: 1, line: 4, offeredAmerican: -110 };
  const over = receptionPosterior({ ...input, side: "over" });
  const under = receptionPosterior({ ...input, side: "under" });
  assert.ok(over.targetsMean > 5 && over.targetsMean < 7);
  assert.ok(over.catchRateMean > 4 / 7 && over.catchRateMean < 0.6);
  assert.ok(over.essGames > 5 && over.essGames <= 6);
  assert.ok(over.ci80[0]! < over.probability && over.ci80[1]! > over.probability);
  close(over.probability + under.probability + over.pushProbability, 1, 1e-12);
  assert.deepEqual(receptionPosterior({ ...input, games: [...games, { ...games[0]!, availableAt: asOf + 1 }], side: "over" }), over);
  assert.throws(() => receptionPosterior({ ...input, side: "over", prior: { ...modelPrior, trainedThrough: asOf } }), /as-of/);
});

test("replay scores paired benchmarks, excludes pushes, and rejects late baselines or priors", () => {
  const row = {
    id: "fair-1", kind: "fair" as const, side: "over" as const, asOf, eventStartsAt: asOf + 1,
    settledAt: asOf + 2, market, quotes: pair("a", -140, 110), result: "win" as const,
    baselineProbability: 0.5, baselineAvailableAt: asOf - 1,
  };
  const outcome = replayPricing([row, { ...row, id: "fair-2", result: "push" }]);
  assert.equal(outcome.summaries[0]?.skipped, 1);
  assert.equal(outcome.summaries[0]?.pairedBaseline.brier, 0.25);
  assert.ok(outcome.summaries[0]!.pairedProposed.brier! < 0.25);
  assert.throws(() => replayPricing([{ ...row, baselineAvailableAt: asOf }]), /non-pregame/);
  assert.throws(() => replayPricing([row, row]), /duplicate/);
});

const team = (name: string) => ({
  quarterbackId: `${name}-qb`, expectedPlays: 63, basePassRate: 0.58,
  receivers: [0.27, 0.19, 0.16, 0.38].map((targetShare, i) => ({
    id: `${name}-receiver-${i}`, targetShare, catchRate: 0.66, yardsPerCatch: [8.6, 7.9, 7.2, 6][i]! / 0.66,
  })),
});
const script = {
  version: "test-script", eventId: market.eventId, asOf, inputsAvailableAt: asOf - 100,
  home: team("home"), away: team("away"), expectedHomeMargin: 0, paceSd: 6, marginSd: 10,
  passRatePerPoint: 0.005, targetConcentration: 60, yardsShape: 2.2, seed: 713,
};

test("NFL structural pricing shares targets and yards, and calibrates supplied leg marginals", () => {
  const model = simulateNflGameScript(script);
  const passing = model.stats.get(JSON.stringify(["home-qb", "player_pass_yds"]))!;
  const receivers = script.home.receivers.map(r => model.stats.get(JSON.stringify([r.id, "player_reception_yds"]))!);
  for (let i = 0; i < model.draws; i++) {
    assert.equal(passing[i], receivers.reduce((sum, yards) => sum + yards[i]!, 0));
  }
  const legs = [
    { market: { ...market, entityId: "home-qb", market: "player_pass_yds", line: 249.5 }, side: "over", probability: 0.5, pushFree: true },
    { market: { ...market, entityId: "home-receiver-0", market: "player_reception_yds", line: 59.5 }, side: "over", probability: 0.5, pushFree: true },
  ] as const;
  const price = priceNflGameScript(model, legs, 250);
  assert.deepEqual(price.marginalProbabilities, [0.5, 0.5]);
  close(price.joint, 0.348, 0.032);
  assert.ok(price.joint > price.independent);
  assert.throws(() => priceNflGameScript(model, [legs[0], { ...legs[1], market: { ...legs[1].market, line: 59 } }]), /Unsupported/);

  const replay = replayPricing([{
    id: "structural", kind: "sgp_script", script, legs, asOf, marginalsAvailableAt: asOf - 100,
    eventStartsAt: asOf + 10, settledAt: asOf + 20, result: "win",
  }]);
  close(replay.forecasts[0]!.probability!, price.joint, 1e-12);
});

const receivingProjection = {
  prior: {
    version: "receiving-prior", trainedThrough: 100, targetsShape: 15, targetsRate: 15 / 4.5,
    yardsPerTarget: 8.3, betweenPlayerSd: 1.2, withinTargetSd: 10,
  },
  games: [7, 5, 9, 4, 8, 6].map((targets, i) => ({
    eventId: `past-receiving-${i}`, finishedAt: 200 + i, availableAt: 300 + i,
    exposure: 1, targets, yards: Math.round(targets * 9.6),
  })),
  nextExposure: 1, line: 49.5, side: "over" as const, seed: 713,
  matchup: { multiplier: 1.04, logSd: 0.05, availableAt: asOf - 100 },
};

test("receiving yards matches the supplied reference within simulation tolerance", () => {
  const forecast = receivingYardsPosterior({ ...receivingProjection, asOf });
  close(forecast.targetsMean, 5.68445, 1e-4);
  close(forecast.essGames, 5.87210, 1e-4);
  close(forecast.probability, 0.45375, 0.025);
  assert.ok(forecast.ci80[0]! < forecast.probability && forecast.ci80[1]! > forecast.probability);
  assert.equal(forecast.pushProbability, 0);
  assert.throws(() => receivingYardsPosterior({
    ...receivingProjection, asOf, matchup: { ...receivingProjection.matchup, availableAt: asOf },
  }), /late/);
  const integer = receivingYardsPosterior({ ...receivingProjection, asOf, line: 49 });
  const under = receivingYardsPosterior({ ...receivingProjection, asOf, line: 49, side: "under" });
  assert.ok(integer.pushProbability > 0);
  close(integer.probability + under.probability + integer.pushProbability, 1, 1e-12);
});

test("receiving yards replay rejects forecast inputs recorded at or after the forecast", () => {
  const row = {
    id: "receiving", kind: "receiving_yards" as const, projection: receivingProjection, asOf,
    market: { ...market, line: receivingProjection.line, market: "player_reception_yds" },
    exposureAvailableAt: asOf - 100, eventStartsAt: asOf + 10, settledAt: asOf + 20, result: "win" as const,
  };
  assert.equal(replayPricing([row]).summaries[0]?.proposed.count, 1);
  assert.throws(() => replayPricing([{ ...row, exposureAvailableAt: asOf }]), /unavailable/);
});
