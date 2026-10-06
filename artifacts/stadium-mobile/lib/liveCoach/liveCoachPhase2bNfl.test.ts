/**
 * Live Coach Phase 2B — NFL live mains.
 * Run: node --import ./test/register-hooks.mjs --test lib/liveCoach/liveCoachPhase2bNfl.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLiveCoachIntent,
  remainingMinutesFromState,
  periodLengthMinutes,
  regulationMinutes,
  evaluateLiveRecommendationEligibility,
  buildLiveCoachRecommendations,
  runRemainingGameSim,
  isLiveCoachSport,
} from "./index.ts";
import type { LiveOddsFeed } from "../api.ts";
import type { NormalizedLiveMarket } from "./types.ts";

test("intent: 3 live NFL picks → NFL Live Coach", () => {
  const i = parseLiveCoachIntent("3 live NFL picks");
  assert.equal(i.wantsLive, true);
  assert.equal(i.sport, "nfl");
  assert.equal(i.count, 3);
});

test("intent: NFL live / best live bets includes NFL path", () => {
  assert.equal(parseLiveCoachIntent("NFL live").sport, "nfl");
  assert.equal(parseLiveCoachIntent("best live bets").sport, null); // all sports
  assert.equal(parseLiveCoachIntent("5 leg NFL").wantsLive, false);
});

test("NFL period length is 15-min quarters / 60-min regulation", () => {
  assert.equal(periodLengthMinutes("nfl"), 15);
  assert.equal(regulationMinutes("nfl"), 60);
});

test("NFL Q1 1:15 remaining total = 1.25 + 45 = 46.25", () => {
  const rem = remainingMinutesFromState({
    sport: "nfl",
    period: 1,
    clock: "1:15",
    periodLabel: "1st Quarter",
  });
  assert.ok(rem != null && Math.abs(rem - 46.25) < 0.001);
});

test("NFL End of 4th + 15:00 → 0 regulation minutes", () => {
  // ESPN may reset displayClock to period length; must not invent 15 left.
  const rem = remainingMinutesFromState({
    sport: "nfl",
    period: 4,
    clock: "15:00",
    periodLabel: "End of 4th",
  });
  assert.equal(rem, 0);
});

test("NFL End of 1st + 15:00 → Q2-Q4 remain (45)", () => {
  const rem = remainingMinutesFromState({
    sport: "nfl",
    period: 1,
    clock: "15:00",
    periodLabel: "End of 1st",
  });
  assert.equal(rem, 45);
});

test("NFL active Q2 remaining sim runs 10k from current score", () => {
  const sim = runRemainingGameSim({
    sport: "nfl",
    homeScore: 14,
    awayScore: 10,
    period: 2,
    clock: "8:30",
    periodLabel: "2nd Quarter",
    homeBaselinePpg: 24,
    awayBaselinePpg: 22,
    simulations: 10_000,
    seed: 7,
    coverQueries: [
      { id: "ml-h", kind: "ml", teamSide: "home" },
      { id: "tot-o", kind: "total", totalSide: "over", line: 44.5 },
    ],
  });
  assert.ok(sim);
  assert.equal(sim!.remainingGameOnly, true);
  assert.equal(sim!.simulations, 10_000);
  assert.ok(sim!.homeProjectedFinal >= 14);
  assert.ok(sim!.awayProjectedFinal >= 10);
  assert.ok(sim!.remainingMinutes > 20 && sim!.remainingMinutes < 40);
});

function saintsMarket(over: Partial<NormalizedLiveMarket> = {}): NormalizedLiveMarket {
  return {
    eventId: "saints-live-1",
    sport: "nfl",
    matchup: "Atlanta Falcons @ New Orleans Saints",
    awayTeam: "Atlanta Falcons",
    homeTeam: "New Orleans Saints",
    awayScore: 10,
    homeScore: 14,
    state: "in",
    period: 2,
    periodLabel: "2nd Quarter",
    clock: "8:30",
    source: "espn_pickcenter",
    market: "Moneyline",
    pick: "Saints ML",
    line: null,
    price: -130,
    providerLastUpdate: null,
    fetchedAt: "2026-10-06T03:00:00.000Z",
    freshness: "fresh",
    ageMs: 5_000,
    marketStatus: "open",
    gameStateAdvanced: false,
    unsafe: false,
    unsafeReasons: [],
    ...over,
  };
}

test("NFL live main eligible when gates pass", () => {
  assert.equal(isLiveCoachSport("nfl"), true);
  const r = evaluateLiveRecommendationEligibility(saintsMarket());
  assert.equal(r.eligible, true, r.reasons.join(","));
});

test("NFL props / alt / period markets still rejected", () => {
  assert.equal(
    evaluateLiveRecommendationEligibility(saintsMarket({ market: "Player Pass Yards" })).eligible,
    false,
  );
  assert.equal(
    evaluateLiveRecommendationEligibility(saintsMarket({ market: "Alt Spread" })).eligible,
    false,
  );
  assert.equal(
    evaluateLiveRecommendationEligibility(saintsMarket({ market: "1H Spread", line: -3.5 })).eligible,
    false,
  );
});

test("build: 3 live NFL picks can return LIVE Saints ticket", async () => {
  const now = "2026-10-06T03:00:00.000Z";
  const feed: LiveOddsFeed = {
    fetchedAt: now,
    games: [
      {
        sport: "nfl",
        game: "Atlanta Falcons @ New Orleans Saints",
        status: "in",
        state: "in",
        awayTeam: "Atlanta Falcons",
        homeTeam: "New Orleans Saints",
        awayScore: 10,
        homeScore: 14,
        period: 2,
        periodLabel: "2nd Quarter",
        clock: "8:30",
        eventId: "saints-1",
        fetchedAt: now,
      },
      {
        sport: "nfl",
        game: "Kansas City Chiefs @ Buffalo Bills",
        status: "in",
        state: "in",
        awayTeam: "Kansas City Chiefs",
        homeTeam: "Buffalo Bills",
        awayScore: 7,
        homeScore: 7,
        period: 1,
        periodLabel: "1st Quarter",
        clock: "5:00",
        eventId: "buf-1",
        fetchedAt: now,
      },
      {
        sport: "nfl",
        game: "Dallas Cowboys @ Philadelphia Eagles",
        status: "in",
        state: "in",
        awayTeam: "Dallas Cowboys",
        homeTeam: "Philadelphia Eagles",
        awayScore: 3,
        homeScore: 17,
        period: 3,
        periodLabel: "3rd Quarter",
        clock: "10:00",
        eventId: "phi-1",
        fetchedAt: now,
      },
    ],
    odds: [
      {
        sport: "nfl",
        game: "Atlanta Falcons @ New Orleans Saints",
        market: "Moneyline",
        pick: "Saints ML",
        odds: +150,
        live: true,
        eventId: "saints-1",
        awayTeam: "Atlanta Falcons",
        homeTeam: "New Orleans Saints",
        awayScore: 10,
        homeScore: 14,
        state: "in",
        period: 2,
        clock: "8:30",
        fetchedAt: now,
        line: null,
        marketStatus: "open",
      },
      {
        sport: "nfl",
        game: "Kansas City Chiefs @ Buffalo Bills",
        market: "Total",
        pick: "Over 48.5",
        odds: +120,
        live: true,
        eventId: "buf-1",
        awayTeam: "Kansas City Chiefs",
        homeTeam: "Buffalo Bills",
        awayScore: 7,
        homeScore: 7,
        state: "in",
        period: 1,
        clock: "5:00",
        fetchedAt: now,
        line: 48.5,
        marketStatus: "open",
      },
      {
        sport: "nfl",
        game: "Dallas Cowboys @ Philadelphia Eagles",
        market: "Spread",
        pick: "Eagles -6.5",
        odds: -110,
        live: true,
        eventId: "phi-1",
        awayTeam: "Dallas Cowboys",
        homeTeam: "Philadelphia Eagles",
        awayScore: 3,
        homeScore: 17,
        state: "in",
        period: 3,
        clock: "10:00",
        fetchedAt: now,
        line: -6.5,
        marketStatus: "open",
      },
    ],
  };

  const result = await buildLiveCoachRecommendations({
    askText: "3 live NFL picks",
    feed,
    seed: 11,
    nowMs: Date.parse(now),
  });
  assert.equal(result.intent.sport, "nfl");
  assert.ok(result.picks.length >= 1, `expected ≥1 NFL pick, got ${result.picks.length}`);
  assert.ok(result.picks.length <= 3);
  for (const p of result.picks) {
    assert.equal(p.sport, "nfl");
    assert.equal(p.liveCoach?.live, true);
    assert.match(String(p.edge ?? ""), /LIVE/);
  }
});

test("determinism: same NFL state+seed → identical sim", () => {
  const input = {
    sport: "nfl" as const,
    homeScore: 14,
    awayScore: 10,
    period: 2,
    clock: "8:30",
    simulations: 10_000,
    seed: 99,
    coverQueries: [{ id: "ml-h", kind: "ml" as const, teamSide: "home" as const }],
  };
  const a = runRemainingGameSim(input);
  const b = runRemainingGameSim(input);
  assert.deepEqual(a, b);
});
