import assert from "node:assert/strict";
import test from "node:test";

import type { GameSimulationResult } from "./api.ts";
import {
  buildSimInputFingerprint,
  fingerprintKey,
  fingerprintInjuries,
  fingerprintLineups,
  fingerprintOddsLines,
  fingerprintWeather,
  getCachedGameSim,
  isSimCacheFresh,
  rememberGameSim,
  SIM_RESULT_TTL_MS,
} from "./simulatorResultCache.ts";

const sampleResult = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.52,
  awayWinProbability: 0.47,
  tieProbability: 0.01,
  homeProjectedScore: 5,
  awayProjectedScore: 4.2,
  mostLikelyWinner: "home" as const,
  mostLikelyWinnerPct: 0.52,
  confidenceScore: 55,
};

test("cache returns hit when fresh and fingerprint matches", () => {
  const fp = buildSimInputFingerprint({
    odds: "ml|-150",
    injuries: "Player:Out",
    weather: "72|Clear",
    lineups: "p1|p2",
  });
  rememberGameSim("mlb", "g1", {
    gameResult: sampleResult as GameSimulationResult,
    ranAt: Date.now(),
    fingerprint: fp,
  });
  const hit = getCachedGameSim("mlb", "g1", fp);
  assert.ok(hit);
  assert.equal(hit.gameResult.homeProjectedScore, 5);
});

test("cache misses when fingerprint changes", () => {
  const fp = buildSimInputFingerprint({
    odds: "ml|-150",
    injuries: "",
    weather: "",
    lineups: "",
  });
  rememberGameSim("mlb", "g2", {
    gameResult: sampleResult as GameSimulationResult,
    ranAt: Date.now(),
    fingerprint: fp,
  });
  const changed = buildSimInputFingerprint({
    ...fp,
    odds: "ml|-160",
  });
  assert.equal(getCachedGameSim("mlb", "g2", changed), null);
});

test("cache misses when TTL expired", () => {
  const fp = buildSimInputFingerprint({
    odds: "x",
    injuries: "",
    weather: "",
    lineups: "",
  });
  rememberGameSim("mlb", "g3", {
    gameResult: sampleResult as GameSimulationResult,
    ranAt: Date.now() - SIM_RESULT_TTL_MS - 1,
    fingerprint: fp,
  });
  assert.equal(getCachedGameSim("mlb", "g3", fp), null);
});

test("fingerprint helpers are stable", () => {
  const odds = fingerprintOddsLines([
    {
      entry: { game: "A @ B", market: "Moneyline", pick: "B ML", odds: -120 },
      pick: {} as never,
      finalAiScore: {} as never,
      winProb: null,
      edgePct: null,
    },
  ]);
  assert.match(odds, /Moneyline\|B ML\|-120/);

  const inj = fingerprintInjuries({
    edge: "even",
    sides: [
      {
        team: "Braves",
        keyPlayers: [{ player: "Acuña", position: "OF", status: "Out", impact: "high" }],
        groups: [],
      },
      { team: "Mets", keyPlayers: [], groups: [] },
    ],
  });
  assert.equal(inj, "Acuña:Out");

  const wx = fingerprintWeather(
    { tempF: 72, condition: "Clear", climateControlled: false, impactRating: "neutral" },
    0,
  );
  assert.match(wx, /outdoor\|72\|Clear/);

  assert.equal(
    fingerprintLineups({ homeStarterId: "1", awayStarterId: "2" }),
    "1|2",
  );
  assert.notEqual(
    fingerprintKey(buildSimInputFingerprint({ odds: "a", injuries: "", weather: "", lineups: "" })),
    fingerprintKey(buildSimInputFingerprint({ odds: "b", injuries: "", weather: "", lineups: "" })),
  );
  assert.ok(isSimCacheFresh(Date.now()));
  assert.ok(!isSimCacheFresh(Date.now() - SIM_RESULT_TTL_MS - 5));
});
