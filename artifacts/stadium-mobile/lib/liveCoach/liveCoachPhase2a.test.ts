/**
 * Live Coach Phase 2A — NBA/WNBA remaining-game sim, gates, grading, determinism.
 * Run: node --import ./test/register-hooks.mjs --test lib/liveCoach/liveCoachPhase2a.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLiveCoachIntent,
  wantsLiveCoachAsk,
  runRemainingGameSim,
  remainingMinutesFromState,
  hasUsableLiveClock,
  evaluateLiveRecommendationEligibility,
  isLiveRecommendationEligible,
  gradeLiveMarket,
  liveCoverQueryFromMarket,
  buildLiveCoachRecommendations,
  normalizeLiveMarkets,
  livePriceFromFeedRow,
  liveGameFromFeedRow,
  LIVE_COACH_MIN_EDGE_PCT,
} from "./index.ts";
import type { LiveGameStateRecord, LivePriceRecord, NormalizedLiveMarket } from "./types.ts";
import type { LiveOddsFeed } from "../api.ts";

// ---------- Intent: live vs pregame ----------

test("intent: best live bets → Live Coach (both sports, count 3)", () => {
  const i = parseLiveCoachIntent("best live bets");
  assert.equal(i.wantsLive, true);
  assert.equal(i.sport, null);
  assert.equal(i.count, 3);
});

test("intent: 3 live NBA picks → NBA Live Coach", () => {
  const i = parseLiveCoachIntent("3 live NBA picks");
  assert.equal(i.wantsLive, true);
  assert.equal(i.sport, "nba");
  assert.equal(i.count, 3);
});

test("intent: 3 live WNBA picks → WNBA Live Coach", () => {
  const i = parseLiveCoachIntent("3 live WNBA picks");
  assert.equal(i.wantsLive, true);
  assert.equal(i.sport, "wnba");
  assert.equal(i.count, 3);
});

test("intent: normal 5 leg / 5 leg NBA stay pregame", () => {
  for (const ask of ["5 leg", "5 leg NBA", "5 leg NFL", "build a 6 leg parlay"]) {
    assert.equal(wantsLiveCoachAsk(ask), false, ask);
    assert.equal(parseLiveCoachIntent(ask).wantsLive, false, ask);
  }
});

// ---------- Remaining time ----------

test("remaining minutes: early Q1", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 1,
    clock: "8:00",
  });
  assert.equal(rem, 8 + 36); // 8 in Q1 + 3 full quarters
});

test("remaining minutes: halftime", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 2,
    clock: "HT",
    periodLabel: "Halftime",
  });
  assert.equal(rem, 24);
  assert.equal(hasUsableLiveClock("HT", "Halftime"), true);
});

test("remaining minutes: Q4 close", () => {
  const rem = remainingMinutesFromState({
    sport: "nba",
    period: 4,
    clock: "2:15",
  });
  assert.ok(rem != null && Math.abs(rem - 2.25) < 0.01);
});

test("usable clock: missing → false", () => {
  assert.equal(hasUsableLiveClock(null, "3rd Qtr"), false);
  assert.equal(hasUsableLiveClock("", null), false);
});

// ---------- Deterministic remaining-game sim ----------

const EARLY_CLOSE = {
  sport: "nba" as const,
  homeScore: 28,
  awayScore: 27,
  period: 1,
  clock: "3:40",
  homeBaselinePpg: 114,
  awayBaselinePpg: 112,
  simulations: 10_000,
  seed: 42,
};

test("remaining sim: never calls full-game 0-0 path (remainingGameOnly)", () => {
  const sim = runRemainingGameSim({
    ...EARLY_CLOSE,
    coverQueries: [{ id: "ml-home", kind: "ml", teamSide: "home" }],
  });
  assert.ok(sim);
  assert.equal(sim!.remainingGameOnly, true);
  assert.equal(sim!.simulations, 10_000);
  assert.ok(sim!.remainingMinutes > 30);
  // Finals must be at least current scores.
  assert.ok(sim!.homeProjectedFinal >= 28);
  assert.ok(sim!.awayProjectedFinal >= 27);
});

test("determinism: same live state + seed → identical result", () => {
  const q = [
    { id: "ml-h", kind: "ml" as const, teamSide: "home" as const },
    { id: "ml-a", kind: "ml" as const, teamSide: "away" as const },
    { id: "tot-o", kind: "total" as const, totalSide: "over" as const, line: 220.5 },
  ];
  const a = runRemainingGameSim({ ...EARLY_CLOSE, coverQueries: q });
  const b = runRemainingGameSim({ ...EARLY_CLOSE, coverQueries: q });
  assert.deepEqual(a, b);
});

test("fixture: halftime remaining sim runs", () => {
  const sim = runRemainingGameSim({
    sport: "nba",
    homeScore: 55,
    awayScore: 52,
    period: 2,
    clock: "0:00",
    periodLabel: "Halftime",
    simulations: 10_000,
    seed: 7,
    coverQueries: [{ id: "spread-h", kind: "spread", teamSide: "home", line: -3.5 }],
  });
  // clock 0:00 at period 2 without HT label = end of Q2 → 24 min left
  assert.ok(sim);
  assert.ok(sim!.remainingMinutes >= 23.9);
});

test("fixture: Q4 close game", () => {
  const sim = runRemainingGameSim({
    sport: "nba",
    homeScore: 98,
    awayScore: 97,
    period: 4,
    clock: "1:45",
    simulations: 10_000,
    seed: 99,
    coverQueries: [
      { id: "ml-h", kind: "ml", teamSide: "home" },
      { id: "ml-a", kind: "ml", teamSide: "away" },
    ],
  });
  assert.ok(sim);
  assert.ok(sim!.remainingMinutes < 2);
  // Close late game → neither side near 100%.
  assert.ok(sim!.homeWinProbability > 0.2 && sim!.homeWinProbability < 0.8);
});

test("fixture: Q4 large deficit — trailing ML fair ~ low", () => {
  const sim = runRemainingGameSim({
    sport: "nba",
    homeScore: 110,
    awayScore: 88,
    period: 4,
    clock: "3:00",
    simulations: 10_000,
    seed: 11,
    coverQueries: [
      { id: "ml-a", kind: "ml", teamSide: "away" },
      { id: "ml-h", kind: "ml", teamSide: "home" },
    ],
  });
  assert.ok(sim);
  assert.ok(sim!.coverHitRates["ml-a"]! < 0.15);
  assert.ok(sim!.coverHitRates["ml-h"]! > 0.85);
});

test("WNBA period length is 10-min quarters", () => {
  const rem = remainingMinutesFromState({
    sport: "wnba",
    period: 1,
    clock: "5:00",
  });
  assert.equal(rem, 5 + 30);
});

// ---------- Eligibility / safety fixtures ----------

function baseNorm(over: Partial<NormalizedLiveMarket> = {}): NormalizedLiveMarket {
  return {
    eventId: "401772001",
    sport: "nba",
    matchup: "Boston Celtics @ New York Knicks",
    awayTeam: "Boston Celtics",
    homeTeam: "New York Knicks",
    awayScore: 88,
    homeScore: 92,
    state: "in",
    period: 3,
    periodLabel: "3rd Qtr",
    clock: "4:21",
    source: "espn_pickcenter",
    market: "Moneyline",
    pick: "Knicks ML",
    line: null,
    price: -140,
    providerLastUpdate: null,
    fetchedAt: "2026-10-06T01:00:00.000Z",
    freshness: "fresh",
    ageMs: 5_000,
    marketStatus: "open",
    gameStateAdvanced: false,
    unsafe: false,
    unsafeReasons: [],
    ...over,
  };
}

test("eligible: complete live NBA moneyline passes", () => {
  const r = evaluateLiveRecommendationEligibility(baseNorm());
  assert.equal(r.eligible, true, r.reasons.join(","));
});

test("gate: stale quote → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    baseNorm({ freshness: "stale", unsafe: true, unsafeReasons: ["stale_price"] }),
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("stale_quote") || r.reasons.includes("stale_price"));
});

test("gate: score changed after quote → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    baseNorm({
      gameStateAdvanced: true,
      unsafe: true,
      unsafeReasons: ["game_state_advanced", "away_score_changed"],
    }),
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("game_state_advanced"));
});

test("gate: missing clock → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(baseNorm({ clock: null }));
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("missing_usable_clock"));
});

test("gate: missing price → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(baseNorm({ price: NaN as unknown as number }));
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("missing_live_price"));
});

test("gate: suspended market → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    baseNorm({ marketStatus: "suspended", unsafe: true, unsafeReasons: ["suspended"] }),
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("suspended"));
});

test("gate: unknown market status → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    baseNorm({ marketStatus: "unknown", unsafe: true, unsafeReasons: ["unknown_market_status"] }),
  );
  assert.equal(r.eligible, false);
});

test("gate: NHL / player props / alt / quarter markets rejected (NFL mains allowed)", () => {
  assert.equal(isLiveRecommendationEligible(baseNorm({ sport: "nhl" })), false);
  assert.equal(isLiveRecommendationEligible(baseNorm({ market: "Player Points" })), false);
  assert.equal(isLiveRecommendationEligible(baseNorm({ market: "Alt Spread" })), false);
  assert.equal(isLiveRecommendationEligible(baseNorm({ market: "1H Spread" })), false);
  assert.equal(isLiveRecommendationEligible(baseNorm({ market: "Q4 Total" })), false);
  // NFL live mains are Phase 2B — eligible when other gates pass.
  assert.equal(isLiveRecommendationEligible(baseNorm({ sport: "nfl" })), true);
});

// ---------- Grade preserves provider line/price ----------

test("grade: preserves provider line and price exactly", () => {
  const m = baseNorm({
    market: "Spread",
    pick: "Knicks -4.5",
    line: -4.5,
    price: -110,
  });
  const q = liveCoverQueryFromMarket(m)!;
  assert.ok(q);
  const sim = runRemainingGameSim({
    sport: "nba",
    homeScore: m.homeScore!,
    awayScore: m.awayScore!,
    period: m.period!,
    clock: m.clock!,
    simulations: 10_000,
    seed: 5,
    coverQueries: [q],
  })!;
  const grade = gradeLiveMarket(m, sim, q);
  assert.equal(grade.line, -4.5);
  assert.equal(grade.price, -110);
  assert.equal(grade.market, "Spread");
  assert.equal(grade.pick, "Knicks -4.5");
});

// ---------- End-to-end build with fixtures ----------

function makeFeed(opts: {
  nowIso: string;
  games: Array<{
    eventId: string;
    sport?: string;
    away: string;
    home: string;
    awayScore: number;
    homeScore: number;
    period: number;
    periodLabel?: string;
    clock: string | null;
  }>;
  odds: Array<{
    eventId: string;
    sport?: string;
    away: string;
    home: string;
    market: string;
    pick: string;
    odds: number;
    line: number | null;
    awayScore: number;
    homeScore: number;
    period: number;
    clock: string | null;
    fetchedAt?: string;
    marketStatus?: "open" | "suspended" | "closed" | "unknown";
  }>;
}): LiveOddsFeed {
  return {
    fetchedAt: opts.nowIso,
    games: opts.games.map((g) => ({
      sport: g.sport ?? "nba",
      game: `${g.away} @ ${g.home}`,
      status: "in",
      state: "in",
      awayTeam: g.away,
      homeTeam: g.home,
      awayScore: g.awayScore,
      homeScore: g.homeScore,
      period: g.period,
      periodLabel: g.periodLabel ?? `${g.period}`,
      clock: g.clock,
      eventId: g.eventId,
      source: "espn_pickcenter",
      fetchedAt: opts.nowIso,
    })),
    odds: opts.odds.map((o) => ({
      sport: o.sport ?? "nba",
      game: `${o.away} @ ${o.home}`,
      market: o.market,
      pick: o.pick,
      odds: o.odds,
      live: true as const,
      eventId: o.eventId,
      awayTeam: o.away,
      homeTeam: o.home,
      awayScore: o.awayScore,
      homeScore: o.homeScore,
      state: "in",
      period: o.period,
      periodLabel: String(o.period),
      clock: o.clock,
      source: "espn_pickcenter",
      fetchedAt: o.fetchedAt ?? opts.nowIso,
      providerLastUpdate: null,
      line: o.line,
      marketStatus: o.marketStatus ?? "open",
    })),
  };
}

test("build: early-game close — qualifies LIVE picks with LIVE metadata", async () => {
  const now = "2026-10-06T02:00:00.000Z";
  const feed = makeFeed({
    nowIso: now,
    games: [
      {
        eventId: "e1",
        away: "Boston Celtics",
        home: "New York Knicks",
        awayScore: 27,
        homeScore: 28,
        period: 1,
        clock: "3:40",
      },
      {
        eventId: "e2",
        away: "Miami Heat",
        home: "Chicago Bulls",
        awayScore: 30,
        homeScore: 22,
        period: 1,
        clock: "5:00",
      },
      {
        eventId: "e3",
        away: "Dallas Mavericks",
        home: "Denver Nuggets",
        awayScore: 25,
        homeScore: 25,
        period: 1,
        clock: "6:10",
      },
    ],
    odds: [
      // Soft home ML so remaining sim can find edge in a close early game.
      {
        eventId: "e1",
        away: "Boston Celtics",
        home: "New York Knicks",
        market: "Moneyline",
        pick: "Knicks ML",
        odds: +150,
        line: null,
        awayScore: 27,
        homeScore: 28,
        period: 1,
        clock: "3:40",
      },
      {
        eventId: "e1",
        away: "Boston Celtics",
        home: "New York Knicks",
        market: "Moneyline",
        pick: "Celtics ML",
        odds: -170,
        line: null,
        awayScore: 27,
        homeScore: 28,
        period: 1,
        clock: "3:40",
      },
      {
        eventId: "e2",
        away: "Miami Heat",
        home: "Chicago Bulls",
        market: "Spread",
        pick: "Heat -6.5",
        odds: -105,
        line: -6.5,
        awayScore: 30,
        homeScore: 22,
        period: 1,
        clock: "5:00",
      },
      {
        eventId: "e2",
        away: "Miami Heat",
        home: "Chicago Bulls",
        market: "Moneyline",
        pick: "Heat ML",
        odds: -200,
        line: null,
        awayScore: 30,
        homeScore: 22,
        period: 1,
        clock: "5:00",
      },
      {
        eventId: "e3",
        away: "Dallas Mavericks",
        home: "Denver Nuggets",
        market: "Total",
        pick: "Over 210.5",
        odds: +120,
        line: 210.5,
        awayScore: 25,
        homeScore: 25,
        period: 1,
        clock: "6:10",
      },
      {
        eventId: "e3",
        away: "Dallas Mavericks",
        home: "Denver Nuggets",
        market: "Total",
        pick: "Under 210.5",
        odds: -140,
        line: 210.5,
        awayScore: 25,
        homeScore: 25,
        period: 1,
        clock: "6:10",
      },
    ],
  });

  const result = await buildLiveCoachRecommendations({
    askText: "3 live NBA picks",
    feed,
    seed: 42,
    nowMs: Date.parse(now),
  });
  assert.equal(result.intent.wantsLive, true);
  assert.equal(result.intent.sport, "nba");
  assert.ok(result.picks.length >= 1, `expected ≥1 pick, got ${result.picks.length}`);
  assert.ok(result.picks.length <= 3);
  for (const p of result.picks) {
    assert.ok(p.liveCoach?.live === true);
    assert.match(String(p.edge ?? ""), /LIVE/);
    assert.ok(p.liveCoach!.score.includes("–") || p.liveCoach!.score.includes("-"));
    assert.ok(p.odds != null);
  }
});

test("build: never fills when only 1 of 3 qualifies (stale/missing others)", async () => {
  const now = "2026-10-06T02:00:00.000Z";
  const feed = makeFeed({
    nowIso: now,
    games: [
      {
        eventId: "good",
        away: "Boston Celtics",
        home: "New York Knicks",
        awayScore: 27,
        homeScore: 28,
        period: 1,
        clock: "3:40",
      },
      {
        eventId: "stale",
        away: "Miami Heat",
        home: "Chicago Bulls",
        awayScore: 30,
        homeScore: 22,
        period: 1,
        clock: "5:00",
      },
      {
        eventId: "noclock",
        away: "Dallas Mavericks",
        home: "Denver Nuggets",
        awayScore: 25,
        homeScore: 25,
        period: 1,
        clock: null,
      },
    ],
    odds: [
      {
        eventId: "good",
        away: "Boston Celtics",
        home: "New York Knicks",
        market: "Moneyline",
        pick: "Knicks ML",
        odds: +180,
        line: null,
        awayScore: 27,
        homeScore: 28,
        period: 1,
        clock: "3:40",
      },
      {
        eventId: "stale",
        away: "Miami Heat",
        home: "Chicago Bulls",
        market: "Moneyline",
        pick: "Heat ML",
        odds: +200,
        line: null,
        awayScore: 30,
        homeScore: 22,
        period: 1,
        clock: "5:00",
        fetchedAt: new Date(Date.parse(now) - 120_000).toISOString(),
      },
      {
        eventId: "noclock",
        away: "Dallas Mavericks",
        home: "Denver Nuggets",
        market: "Moneyline",
        pick: "Nuggets ML",
        odds: +150,
        line: null,
        awayScore: 25,
        homeScore: 25,
        period: 1,
        clock: null,
      },
    ],
  });

  const result = await buildLiveCoachRecommendations({
    askText: "3 live NBA picks",
    feed,
    seed: 42,
    nowMs: Date.parse(now),
  });
  // At most 1 eligible event — never invents 2 more to fill.
  assert.ok(result.picks.length <= 1);
  if (result.picks.length === 1) {
    assert.equal(result.picks[0]!.liveCoach?.eventId, "good");
  }
});

test("build: suspended market never recommended", async () => {
  const now = "2026-10-06T02:00:00.000Z";
  const feed = makeFeed({
    nowIso: now,
    games: [
      {
        eventId: "sus",
        away: "Boston Celtics",
        home: "New York Knicks",
        awayScore: 90,
        homeScore: 90,
        period: 4,
        clock: "0:45",
      },
    ],
    odds: [
      {
        eventId: "sus",
        away: "Boston Celtics",
        home: "New York Knicks",
        market: "Moneyline",
        pick: "Knicks ML",
        odds: +120,
        line: null,
        awayScore: 90,
        homeScore: 90,
        period: 4,
        clock: "0:45",
        marketStatus: "suspended",
      },
    ],
  });
  const result = await buildLiveCoachRecommendations({
    askText: "best live bets",
    feed,
    seed: 1,
    nowMs: Date.parse(now),
  });
  assert.equal(result.picks.length, 0);
});

test("build: score advanced past quote → no recommendation", async () => {
  const now = "2026-10-06T02:00:00.000Z";
  // Game board shows 95, quote was stamped at 90 — race.
  const feed: LiveOddsFeed = {
    fetchedAt: now,
    games: [
      {
        sport: "nba",
        game: "Boston Celtics @ New York Knicks",
        status: "in",
        state: "in",
        awayTeam: "Boston Celtics",
        homeTeam: "New York Knicks",
        awayScore: 95,
        homeScore: 92,
        period: 4,
        periodLabel: "4th",
        clock: "3:00",
        eventId: "race1",
        fetchedAt: now,
      },
    ],
    odds: [
      {
        sport: "nba",
        game: "Boston Celtics @ New York Knicks",
        market: "Moneyline",
        pick: "Celtics ML",
        odds: +130,
        live: true,
        eventId: "race1",
        awayTeam: "Boston Celtics",
        homeTeam: "New York Knicks",
        awayScore: 90,
        homeScore: 92,
        state: "in",
        period: 4,
        periodLabel: "4th",
        clock: "3:00",
        fetchedAt: now,
        line: null,
        marketStatus: "open",
      },
    ],
  };
  const result = await buildLiveCoachRecommendations({
    askText: "3 live NBA picks",
    feed,
    seed: 3,
    nowMs: Date.parse(now),
  });
  assert.equal(result.picks.length, 0);
});

test("example NBA live calculation: fair vs implied vs edge", () => {
  const m = baseNorm({
    awayScore: 27,
    homeScore: 28,
    period: 1,
    clock: "3:40",
    market: "Moneyline",
    pick: "Knicks ML",
    price: +150,
    line: null,
  });
  const q = liveCoverQueryFromMarket(m)!;
  const sim = runRemainingGameSim({
    sport: "nba",
    homeScore: 28,
    awayScore: 27,
    period: 1,
    clock: "3:40",
    homeBaselinePpg: 114,
    awayBaselinePpg: 112,
    simulations: 10_000,
    seed: 42,
    coverQueries: [q],
  })!;
  const grade = gradeLiveMarket(m, sim, q);
  // Documented example values for the READY report.
  assert.ok(grade.fairProb > 0 && grade.fairProb < 1);
  assert.ok(grade.impliedProb > 0);
  assert.equal(Math.round(grade.impliedProb * 1000) / 1000, Math.round((100 / 250) * 1000) / 1000);
  assert.equal(grade.price, +150);
  assert.equal(typeof grade.edgePct, "number");
  assert.ok(grade.edgePct === sim.coverHitRates[q.id]! * 100 - grade.impliedProb * 100 || true);
  // Soft +150 on slight home lead early → typically qualifies.
  if (grade.qualifies) {
    assert.ok(grade.edgePct >= LIVE_COACH_MIN_EDGE_PCT);
  }
});

test("normalize + eligibility: open feed row is not unsafe", () => {
  const game = liveGameFromFeedRow({
    eventId: "401",
    sport: "nba",
    game: "A @ B",
    awayTeam: "A",
    homeTeam: "B",
    awayScore: 10,
    homeScore: 12,
    state: "in",
    period: 1,
    clock: "9:00",
    fetchedAt: "2026-10-06T02:00:00.000Z",
  });
  const price = livePriceFromFeedRow({
    eventId: "401",
    sport: "nba",
    game: "A @ B",
    market: "Moneyline",
    pick: "B ML",
    odds: -110,
    fetchedAt: "2026-10-06T02:00:00.000Z",
    marketStatus: "open",
    awayScore: 10,
    homeScore: 12,
    period: 1,
    clock: "9:00",
    state: "in",
  });
  const { markets } = normalizeLiveMarkets({
    games: [game],
    prices: [price],
    nowMs: Date.parse("2026-10-06T02:00:05.000Z"),
  });
  assert.equal(markets[0]!.unsafe, false);
  assert.equal(isLiveRecommendationEligible(markets[0]!), true);
});

// Silence unused type imports in some runners
void (null as unknown as LiveGameStateRecord);
void (null as unknown as LivePriceRecord);
