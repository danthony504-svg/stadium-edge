/**
 * Live Coach — end-of-period normalization + Minnesota regression fixtures.
 * Run: node --import ./test/register-hooks.mjs --test lib/liveCoach/liveCoachEndOfPeriod.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  remainingMinutesFromState,
  parseEndOfPeriodLabel,
  isEndOfRegulationTransition,
  isExplicitOvertimeState,
  evaluateLiveRecommendationEligibility,
  buildLiveCoachRecommendations,
  runRemainingGameSim,
  normalizeLiveMarkets,
  liveGameFromFeedRow,
  livePriceFromFeedRow,
} from "./index.ts";
import type { LiveOddsFeed } from "../api.ts";
import type { NormalizedLiveMarket } from "./types.ts";

// ---------- remainingMinutes fixtures ----------

test("Q1 12:00 normal start → 12 min left in Q1 + 36 future = 48", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 1,
    clock: "12:00",
    periodLabel: "1st Qtr",
  });
  assert.equal(rem, 48);
  assert.equal(parseEndOfPeriodLabel("1st Qtr"), null);
});

test("End of 1st + 12:00 → 0 in Q1; Q2-Q4 remain (36)", () => {
  assert.deepEqual(parseEndOfPeriodLabel("End of 1st"), {
    kind: "end_of_quarter",
    completedPeriod: 1,
  });
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 1,
    clock: "12:00",
    periodLabel: "End of 1st",
  });
  assert.equal(rem, 36);
});

test("halftime + 12:00 → Q2 complete; Q3+Q4 remain (24)", () => {
  const a = remainingMinutesFromState({
    sport: "nba",
    period: 2,
    clock: "12:00",
    periodLabel: "Halftime",
  });
  const b = remainingMinutesFromState({
    sport: "nba",
    period: 2,
    clock: "12:00",
    periodLabel: "End of 2nd",
  });
  assert.equal(a, 24);
  assert.equal(b, 24);
});

test("End of 3rd + 12:00 → only Q4 remains (12)", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 3,
    clock: "12:00",
    periodLabel: "End of 3rd",
  });
  assert.equal(rem, 12);
});

test("Q4 active 1:15 → 1.25 regulation minutes", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 4,
    clock: "1:15",
    periodLabel: "4th Qtr",
  });
  assert.ok(rem != null && Math.abs(rem - 1.25) < 0.001);
});

test("End of 4th + 12:00 → 0 regulation minutes", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 4,
    clock: "12:00",
    periodLabel: "End of 4th",
  });
  assert.equal(rem, 0);
  assert.equal(isEndOfRegulationTransition(4, "End of 4th"), true);
});

test("OT explicitly active → OT clock only", () => {
  assert.equal(isExplicitOvertimeState(5, "OT"), true);
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 5,
    clock: "4:00",
    periodLabel: "OT",
  });
  assert.equal(rem, 4);
});

test("End of 4th awaiting OT → reject (not explicit OT)", () => {
  assert.equal(isEndOfRegulationTransition(4, "End of 4th"), true);
  assert.equal(isExplicitOvertimeState(4, "End of 4th"), false);
});

test("Lakers/Kings: Q1 1:15 → 37.25 regulation minutes", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 1,
    clock: "1:15",
    periodLabel: "1st Qtr",
  });
  assert.ok(rem != null && Math.abs(rem - 37.25) < 0.001);
});

// ---------- Minnesota fixture ----------

function minnesotaMarket(
  over: Partial<NormalizedLiveMarket> = {},
): NormalizedLiveMarket {
  return {
    eventId: "min-mil-end-q4",
    sport: "nba",
    matchup: "Minnesota Timberwolves @ Milwaukee Bucks",
    awayTeam: "Minnesota Timberwolves",
    homeTeam: "Milwaukee Bucks",
    awayScore: 116,
    homeScore: 97,
    state: "in",
    period: 4,
    periodLabel: "End of 4th",
    clock: "12:00",
    source: "espn_pickcenter",
    market: "Total",
    pick: "Over 231.5",
    line: 231.5,
    price: -112,
    providerLastUpdate: null,
    fetchedAt: new Date().toISOString(),
    freshness: "fresh",
    ageMs: 0,
    marketStatus: "open",
    gameStateAdvanced: false,
    unsafe: false,
    unsafeReasons: [],
    ...over,
  };
}

test("Minnesota: remainingMinutes is 0 (was 12 before fix)", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 4,
    clock: "12:00",
    periodLabel: "End of 4th",
  });
  assert.equal(rem, 0);
  const sim = runRemainingGameSim({
    sport: "nba",
    homeScore: 97,
    awayScore: 116,
    period: 4,
    clock: "12:00",
    periodLabel: "End of 4th",
    simulations: 10_000,
    seed: 1,
    coverQueries: [
      { id: "tot-o", kind: "total", totalSide: "over", line: 231.5 },
      { id: "sp-a", kind: "spread", teamSide: "away", line: -5.5 },
    ],
  });
  // No meaningful remaining time → sim returns null.
  assert.equal(sim, null);
});

test("Minnesota: End of 4th ineligible (awaiting OT + unsync)", () => {
  const r = evaluateLiveRecommendationEligibility(minnesotaMarket());
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("end_of_regulation_awaiting_ot"));
  assert.ok(r.reasons.includes("transition_unsynchronized_quote"));
});

test("Minnesota: Over 231.5 and MIN -5.5 do not render", async () => {
  const now = "2026-10-06T02:00:00.000Z";
  const feed: LiveOddsFeed = {
    fetchedAt: now,
    games: [
      {
        sport: "nba",
        game: "Minnesota Timberwolves @ Milwaukee Bucks",
        status: "in",
        state: "in",
        awayTeam: "Minnesota Timberwolves",
        homeTeam: "Milwaukee Bucks",
        awayScore: 116,
        homeScore: 97,
        period: 4,
        periodLabel: "End of 4th",
        clock: "12:00",
        eventId: "min-mil",
        fetchedAt: now,
      },
    ],
    odds: [
      {
        sport: "nba",
        game: "Minnesota Timberwolves @ Milwaukee Bucks",
        market: "Total",
        pick: "Over 231.5",
        odds: -112,
        live: true,
        eventId: "min-mil",
        awayTeam: "Minnesota Timberwolves",
        homeTeam: "Milwaukee Bucks",
        awayScore: 116,
        homeScore: 97,
        state: "in",
        period: 4,
        periodLabel: "End of 4th",
        clock: "12:00",
        fetchedAt: now,
        line: 231.5,
        marketStatus: "open",
      },
      {
        sport: "nba",
        game: "Minnesota Timberwolves @ Milwaukee Bucks",
        market: "Spread",
        pick: "Timberwolves -5.5",
        odds: -110,
        live: true,
        eventId: "min-mil",
        awayTeam: "Minnesota Timberwolves",
        homeTeam: "Milwaukee Bucks",
        awayScore: 116,
        homeScore: 97,
        state: "in",
        period: 4,
        periodLabel: "End of 4th",
        clock: "12:00",
        fetchedAt: now,
        line: -5.5,
        marketStatus: "open",
      },
    ],
  };
  const result = await buildLiveCoachRecommendations({
    askText: "3 live NBA picks",
    feed,
    seed: 42,
    nowMs: Date.parse(now),
  });
  assert.equal(result.picks.length, 0);
  assert.ok(!result.picks.some((p) => /231\.5/.test(p.pick)));
  assert.ok(!result.picks.some((p) => /Timberwolves/i.test(p.pick)));
});

test("transition freshness: fetchedAt-only at End of 4th → unknown, not fresh", () => {
  const game = liveGameFromFeedRow({
    eventId: "min-mil",
    sport: "nba",
    game: "Minnesota Timberwolves @ Milwaukee Bucks",
    awayTeam: "Minnesota Timberwolves",
    homeTeam: "Milwaukee Bucks",
    awayScore: 116,
    homeScore: 97,
    state: "in",
    period: 4,
    periodLabel: "End of 4th",
    clock: "12:00",
    fetchedAt: "2026-10-06T02:00:00.000Z",
  });
  const price = livePriceFromFeedRow({
    eventId: "min-mil",
    sport: "nba",
    game: "Minnesota Timberwolves @ Milwaukee Bucks",
    market: "Total",
    pick: "Over 231.5",
    odds: -112,
    line: 231.5,
    fetchedAt: "2026-10-06T02:00:00.000Z",
    providerLastUpdate: null,
    marketStatus: "open",
    awayScore: 116,
    homeScore: 97,
    period: 4,
    periodLabel: "End of 4th",
    clock: "12:00",
    state: "in",
  });
  const { markets } = normalizeLiveMarkets({
    games: [game],
    prices: [price],
    nowMs: Date.parse("2026-10-06T02:00:00.000Z"),
  });
  assert.equal(markets[0]!.freshness, "unknown");
  assert.ok(markets[0]!.unsafeReasons.includes("transition_unsynchronized_quote"));
  assert.ok(markets[0]!.unsafe);
  // ageMs may still reflect fetchedAt (0s) — but freshness is not "fresh".
  assert.notEqual(markets[0]!.freshness, "fresh");
});

test("Lakers active Q1 remains eligible path (no end-of-period)", async () => {
  const now = "2026-10-06T02:00:00.000Z";
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 1,
    clock: "1:15",
    periodLabel: "1st Qtr",
  });
  assert.ok(rem != null && Math.abs(rem - 37.25) < 0.001);

  const r = evaluateLiveRecommendationEligibility({
    eventId: "lal-sac",
    sport: "nba",
    matchup: "Los Angeles Lakers @ Sacramento Kings",
    awayTeam: "Los Angeles Lakers",
    homeTeam: "Sacramento Kings",
    awayScore: 33,
    homeScore: 27,
    state: "in",
    period: 1,
    periodLabel: "1st Qtr",
    clock: "1:15",
    source: "espn_pickcenter",
    market: "Total",
    pick: "Over 228.5",
    line: 228.5,
    price: -105,
    providerLastUpdate: null,
    fetchedAt: now,
    freshness: "fresh",
    ageMs: 0,
    marketStatus: "open",
    gameStateAdvanced: false,
    unsafe: false,
    unsafeReasons: [],
  });
  assert.equal(r.eligible, true, r.reasons.join(","));
  assert.equal(parseEndOfPeriodLabel("1st Qtr"), null);
});
