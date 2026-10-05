/**
 * Phase 2 Coach context cache — TTL, coalescing, game-sim fingerprint.
 * Does not change qualification / grading / odds authority.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCoachContextPath,
  clearCoachContextCache,
  fingerprintCoachGameSim,
  getCoachCacheStats,
  peekCoachContextCache,
  resetCoachCacheStats,
  withCoachContextCache,
  withCoachGameSimCache,
  COACH_CONTEXT_TTL_MS,
} from "./coachContextCache.ts";

test("classifies stable context paths and excludes live odds/props/simulate", () => {
  assert.equal(classifyCoachContextPath("/sports/player-history?athleteId=1"), "playerHistory");
  assert.equal(classifyCoachContextPath("/sports/injuries?sport=nfl"), "injuries");
  assert.equal(classifyCoachContextPath("/sports/team-defense?sport=nfl&teamId=1"), "teamDefense");
  assert.equal(
    classifyCoachContextPath("/sports/matchup-history?sport=nfl&homeTeamId=1&awayTeamId=2"),
    "matchupHistory",
  );
  assert.equal(
    classifyCoachContextPath("/sports/team-period-stats?sport=nfl&teamId=1"),
    "teamPeriodStats",
  );
  assert.equal(classifyCoachContextPath("/sports/odds?sport=nfl"), null);
  assert.equal(classifyCoachContextPath("/sports/live-odds?sport=nfl"), null);
  assert.equal(classifyCoachContextPath("/sports/props?sport=nfl"), null);
  assert.equal(classifyCoachContextPath("/sports/simulate/props"), null);
  assert.equal(classifyCoachContextPath("/sports/simulate/game-outcome"), null);
});

test("TTLs mirror server policies for key stages", () => {
  assert.equal(COACH_CONTEXT_TTL_MS.playerHistory, 30 * 60_000);
  assert.equal(COACH_CONTEXT_TTL_MS.injuries, 10 * 60_000);
  assert.equal(COACH_CONTEXT_TTL_MS.teamDefense, 60 * 60_000);
  assert.equal(COACH_CONTEXT_TTL_MS.matchupHistory, 15 * 60_000);
  assert.equal(COACH_CONTEXT_TTL_MS.teamPeriodStats, 2 * 60 * 60_000);
  assert.equal(COACH_CONTEXT_TTL_MS.gameSimulation, 20 * 60_000);
});

test("TTL hit returns same value without re-fetch", async () => {
  clearCoachContextCache();
  resetCoachCacheStats();
  let fetches = 0;
  const path = "/sports/injuries?sport=nfl";
  const a = await withCoachContextCache(path, "injuries", async () => {
    fetches += 1;
    return { teams: ["a"] };
  });
  const b = await withCoachContextCache(path, "injuries", async () => {
    fetches += 1;
    return { teams: ["b"] };
  });
  assert.equal(fetches, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(peekCoachContextCache(path), { teams: ["a"] });
  const stats = getCoachCacheStats().find((s) => s.stage === "injuries");
  assert.ok(stats);
  assert.equal(stats!.cacheHit, 1);
  assert.equal(stats!.cacheMiss, 1);
});

test("in-flight coalescing shares one Promise", async () => {
  clearCoachContextCache();
  resetCoachCacheStats();
  let fetches = 0;
  const path = "/sports/team-defense?sport=nfl&teamId=12";
  const slow = () =>
    withCoachContextCache(path, "teamDefense", async () => {
      fetches += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { teamId: "12", ok: true };
    });
  const [a, b, c] = await Promise.all([slow(), slow(), slow()]);
  assert.equal(fetches, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  const stats = getCoachCacheStats().find((s) => s.stage === "teamDefense");
  assert.ok(stats);
  assert.ok(stats!.coalesced >= 2);
  assert.equal(stats!.cacheMiss, 1);
});

test("game-sim fingerprint ignores American odds / price", () => {
  const base = {
    sport: "nfl",
    homeTeamId: "1",
    awayTeamId: "2",
    homeTeam: "Home",
    awayTeam: "Away",
    simulations: 10_000,
    coverQueries: [
      { id: "ml:home", kind: "ml", teamSide: "home" },
      { id: "spread:home:-3.5", kind: "spread", teamSide: "home", line: -3.5 },
    ],
  };
  const a = fingerprintCoachGameSim(base);
  const b = fingerprintCoachGameSim(base);
  assert.equal(a, b);
  // Line change IS material (cover structure) — must differ
  const c = fingerprintCoachGameSim({
    ...base,
    coverQueries: [
      { id: "ml:home", kind: "ml", teamSide: "home" },
      { id: "spread:home:-7", kind: "spread", teamSide: "home", line: -7 },
    ],
  });
  assert.notEqual(a, c);
});

test("game-sim cache reuses identical fingerprint", async () => {
  clearCoachContextCache();
  resetCoachCacheStats();
  let fetches = 0;
  const fp = fingerprintCoachGameSim({
    sport: "mlb",
    homeTeamId: "10",
    awayTeamId: "11",
    simulations: 10_000,
    coverQueries: [{ id: "total:over:8.5", kind: "total", line: 8.5, totalSide: "over" }],
  });
  const a = await withCoachGameSimCache(fp, async () => {
    fetches += 1;
    return { simulations: 10_000, hit: 0.55 };
  });
  const b = await withCoachGameSimCache(fp, async () => {
    fetches += 1;
    return { simulations: 10_000, hit: 0.99 };
  });
  assert.equal(fetches, 1);
  assert.deepEqual(a, b);
  const stats = getCoachCacheStats().find((s) => s.stage === "gameSimulation");
  assert.ok(stats);
  assert.equal(stats!.cacheHit, 1);
  assert.equal(stats!.cacheMiss, 1);
});
