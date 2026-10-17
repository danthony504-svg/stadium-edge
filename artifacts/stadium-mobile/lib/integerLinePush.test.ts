/**
 * Integer-line push handling — land-on-number is a stake refund, not a loss.
 * Half-point lines remain push-free.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import {
  buildGameCoverQuery,
  coverPushRateForQuery,
  coverQueryHits,
  coverQueryPushes,
  deriveCoverHitRatesFromOutcomes,
  deriveCoverPushRatesFromOutcomes,
  gameSimHitForPick,
  lineAllowsPush,
} from "./gameSimScoring.ts";

test("lineAllowsPush: integer yes, half-point no", () => {
  assert.equal(lineAllowsPush(7), true);
  assert.equal(lineAllowsPush(7.0), true);
  assert.equal(lineAllowsPush(3), true);
  assert.equal(lineAllowsPush(7.5), false);
  assert.equal(lineAllowsPush(6.5), false);
  assert.equal(lineAllowsPush(null), false);
});

test("coverQueryPushes: total lands on integer line; half-point never pushes", () => {
  const under7 = buildGameCoverQuery({
    game: "A @ B",
    market: "Total",
    pick: "Under 7",
    odds: -110,
    isProp: false,
    sport: "mlb",
  })!;
  const under75 = buildGameCoverQuery({
    game: "A @ B",
    market: "Total",
    pick: "Under 7.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
  })!;
  // Scores 3+4 = 7 → push on Under 7, win on Under 7.5, neither is a cover win for Over 7.
  assert.equal(coverQueryPushes(under7, 3, 4, "mlb"), true);
  assert.equal(coverQueryHits(under7, 3, 4, "mlb"), false);
  assert.equal(coverQueryPushes(under75, 3, 4, "mlb"), false);
  assert.equal(coverQueryHits(under75, 3, 4, "mlb"), true);
});

test("coverQueryPushes: spread lands exactly on integer handicap", () => {
  const awayPlus3 = buildGameCoverQuery({
    game: "Away @ Home",
    market: "Spread",
    pick: "Away +3",
    odds: -110,
    isProp: false,
    sport: "nfl",
  })!;
  const awayPlus35 = buildGameCoverQuery({
    game: "Away @ Home",
    market: "Spread",
    pick: "Away +3.5",
    odds: -110,
    isProp: false,
    sport: "nfl",
  })!;
  // Home 20, Away 17 — Away loses by exactly 3.
  assert.equal(coverQueryPushes(awayPlus3, 20, 17, "nfl"), true);
  assert.equal(coverQueryHits(awayPlus3, 20, 17, "nfl"), false);
  assert.equal(coverQueryPushes(awayPlus35, 20, 17, "nfl"), false);
  assert.equal(coverQueryHits(awayPlus35, 20, 17, "nfl"), true);
});

test("deriveCoverPushRatesFromOutcomes: Over+Under = 1 − P(push) on integer line", () => {
  // 40% over (8), 30% push (7), 30% under (6)
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  for (let i = 0; i < 40; i++) {
    homeScores.push(5);
    awayScores.push(3); // 8
  }
  for (let i = 0; i < 30; i++) {
    homeScores.push(4);
    awayScores.push(3); // 7
  }
  for (let i = 0; i < 30; i++) {
    homeScores.push(3);
    awayScores.push(3); // 6
  }
  const over = buildGameCoverQuery({
    game: "A @ B",
    market: "Total",
    pick: "Over 7",
    odds: -110,
    isProp: false,
    sport: "mlb",
  })!;
  const under = buildGameCoverQuery({
    game: "A @ B",
    market: "Total",
    pick: "Under 7",
    odds: -110,
    isProp: false,
    sport: "mlb",
  })!;
  const hits = deriveCoverHitRatesFromOutcomes({ homeScores, awayScores }, [over, under], "mlb");
  const pushes = deriveCoverPushRatesFromOutcomes({ homeScores, awayScores }, [over, under], "mlb");
  assert.equal(hits[over.id], 0.4);
  assert.equal(hits[under.id], 0.3);
  assert.equal(pushes[over.id], 0.3);
  assert.equal(pushes[under.id], 0.3);
  assert.ok(Math.abs((hits[over.id]! + hits[under.id]!) - (1 - 0.3)) < 1e-9);
});

test("simEvPct / simEdgeFromHit: push refund lifts EV vs treating push as loss", () => {
  // P(win)=0.40, P(push)=0.30 @ −110
  const noPushEv = simEvPct(0.4, -110, 0)!;
  const withPushEv = simEvPct(0.4, -110, 0.3)!;
  assert.ok(withPushEv > noPushEv, `push EV ${withPushEv} should beat no-push ${noPushEv}`);
  // EV = 0.4 * (100/110+1) - 1 + 0.3 ≈ 0.4*1.909 - 1 + 0.3 ≈ 0.0636 → +6.4%
  assert.ok(Math.abs(withPushEv - 6.4) < 0.2, `withPushEv=${withPushEv}`);
  const noPushEdge = simEdgeFromHit(0.4, -110, 0)!;
  const withPushEdge = simEdgeFromHit(0.4, -110, 0.3)!;
  assert.ok(withPushEdge > noPushEdge);
  // Half-point path unchanged when pushRate omitted.
  assert.equal(simEvPct(0.55, -110), 5);
});

test("gameSimHitForPick + coverPushRateForQuery: integer Under 7 vs half Under 7.5", () => {
  const homeScores = Array.from({ length: 100 }, () => 3);
  const awayScores = Array.from({ length: 100 }, () => 4); // total 7 always
  const under7 = {
    game: "Rays @ Guardians",
    market: "Total",
    pick: "Under 7",
    odds: -110,
    isProp: false,
    sport: "mlb",
  };
  const under75 = {
    game: "Rays @ Guardians",
    market: "Total",
    pick: "Under 7.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
  };
  const q7 = buildGameCoverQuery(under7)!;
  const q75 = buildGameCoverQuery(under75)!;
  const hits = deriveCoverHitRatesFromOutcomes({ homeScores, awayScores }, [q7, q75], "mlb");
  const pushes = deriveCoverPushRatesFromOutcomes({ homeScores, awayScores }, [q7, q75], "mlb");
  const sim = {
    sport: "mlb",
    simulations: 100,
    homeWinProbability: 0.5,
    awayWinProbability: 0.5,
    tieProbability: 0,
    homeProjectedScore: 3,
    awayProjectedScore: 4,
    mostLikelyWinner: "home" as const,
    mostLikelyWinnerPct: 0.5,
    confidenceScore: 50,
    engineVersion: "sport-sim-v1",
    outcomes: { homeScores, awayScores },
    coverHitRates: hits,
    coverPushRates: pushes,
  };
  // Raw cover rates: Under 7 never wins (all pushes); Under 7.5 always wins.
  assert.equal(hits[q7.id], 0);
  assert.equal(hits[q75.id], 1);
  assert.equal(coverPushRateForQuery(q7, sim), 1);
  assert.equal(coverPushRateForQuery(q75, sim), 0);
  // Graded path withholds 0/1 extremes — push mass still available for EV.
  assert.equal(gameSimHitForPick(under7, sim), null);
  // Mix in some under-cover draws so Under 7.5 stays gradeable mid-range.
  const mixedHome = [...homeScores.slice(0, 70), ...Array.from({ length: 30 }, () => 5)];
  const mixedAway = [...awayScores.slice(0, 70), ...Array.from({ length: 30 }, () => 5)]; // 10 total → over 7.5
  const mixedHits = deriveCoverHitRatesFromOutcomes(
    { homeScores: mixedHome, awayScores: mixedAway },
    [q75],
    "mlb",
  );
  const mixedSim = {
    ...sim,
    simulations: 100,
    outcomes: { homeScores: mixedHome, awayScores: mixedAway },
    coverHitRates: mixedHits,
    coverPushRates: { [q75.id]: 0 },
  };
  const graded75 = gameSimHitForPick(under75, mixedSim);
  assert.ok(graded75 != null && graded75 > 0.5 && graded75 < 1, `graded75=${graded75}`);
});
