/**
 * Live Coach Phase 3A — NHL live mains (ML / puck line / total).
 * Run: node --import ./test/register-hooks.mjs --test lib/liveCoach/liveCoachPhase3aNhl.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLiveCoachIntent,
  wantsLiveCoachAsk,
  remainingMinutesFromState,
  periodLengthMinutes,
  regulationMinutes,
  regulationPeriodCount,
  overtimePeriodNumber,
  evaluateLiveRecommendationEligibility,
  buildLiveCoachRecommendations,
  runRemainingGameSim,
  isLiveCoachSport,
  isEndOfRegulationTransition,
  isExplicitOvertimeState,
  isExplicitShootoutState,
  isFinalState,
  resolveNhlLiveMarketSettlement,
  attachNhlSettlementToCoverQuery,
  liveCoverQueryFromMarket,
  LIVE_PHASE2A_SPORTS,
  LIVE_PHASE3A_SPORTS,
} from "./index.ts";
import type { LiveOddsFeed } from "../api.ts";
import type { NormalizedLiveMarket } from "./types.ts";

// ---------- Intent / routing ----------

test("intent: 3 live NHL picks → NHL Live Coach", () => {
  const i = parseLiveCoachIntent("3 live NHL picks");
  assert.equal(i.wantsLive, true);
  assert.equal(i.sport, "nhl");
  assert.equal(i.count, 3);
});

test("intent: 5 live may include NHL; 5 leg NHL stays pregame", () => {
  assert.equal(parseLiveCoachIntent("5 live").wantsLive, true);
  assert.equal(parseLiveCoachIntent("5 live").sport, null);
  assert.equal(parseLiveCoachIntent("5 live").count, 5);
  assert.equal(wantsLiveCoachAsk("5 leg NHL"), false);
  assert.equal(parseLiveCoachIntent("5 leg NHL").wantsLive, false);
});

test("intent: explicit counts 2–15 for N leg live NHL", () => {
  for (let n = 2; n <= 15; n++) {
    const i = parseLiveCoachIntent(`${n} leg live NHL`);
    assert.equal(i.wantsLive, true, String(n));
    assert.equal(i.sport, "nhl", String(n));
    assert.equal(i.count, n, String(n));
  }
});

test("Phase 2A sports unchanged; NHL is Phase 3A", () => {
  assert.ok(LIVE_PHASE2A_SPORTS.has("nba"));
  assert.ok(LIVE_PHASE2A_SPORTS.has("wnba"));
  assert.equal(LIVE_PHASE2A_SPORTS.has("nhl"), false);
  assert.ok(LIVE_PHASE3A_SPORTS.has("nhl"));
  assert.equal(isLiveCoachSport("nhl"), true);
});

// ---------- Period / clock math ----------

test("NHL periods are 20×3 = 60 regulation; OT period number 4", () => {
  assert.equal(periodLengthMinutes("nhl"), 20);
  assert.equal(regulationPeriodCount("nhl"), 3);
  assert.equal(regulationMinutes("nhl"), 60);
  assert.equal(overtimePeriodNumber("nhl"), 4);
});

test("NHL P1 20:00 legitimate start → 60 remaining", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 1,
    clock: "20:00",
    periodLabel: "1st Period",
  });
  assert.equal(rem, 60);
});

test("NHL P1 active 8:32 → 8.533… + 40", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 1,
    clock: "8:32",
    periodLabel: "1st Period",
  });
  assert.ok(rem != null && Math.abs(rem! - (8 + 32 / 60 + 40)) < 0.001);
});

test("NHL End P1 + reset 20:00 → 40 remaining (not 60)", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 1,
    clock: "20:00",
    periodLabel: "End of 1st",
  });
  assert.equal(rem, 40);
});

test("NHL P2 active", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 2,
    clock: "12:00",
    periodLabel: "2nd Period",
  });
  assert.equal(rem, 12 + 20);
});

test("NHL End P2 + reset 20:00 → 20 remaining (not 40)", () => {
  // Must not treat End of 2nd like basketball halftime (2 periods left).
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 2,
    clock: "20:00",
    periodLabel: "End of 2nd",
  });
  assert.equal(rem, 20);
});

test("NHL P3 close game", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 3,
    clock: "1:45",
    periodLabel: "3rd Period",
  });
  assert.ok(rem != null && Math.abs(rem! - (1 + 45 / 60)) < 0.001);
});

test("NHL End P3 + reset 20:00 → 0 (never invent another period)", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 3,
    clock: "20:00",
    periodLabel: "End of 3rd",
  });
  assert.equal(rem, 0);
  assert.equal(isEndOfRegulationTransition(3, "End of 3rd", "nhl"), true);
});

test("NHL End P3 tied awaiting OT → fail-closed transition", () => {
  assert.equal(isEndOfRegulationTransition(3, "End of 3rd", "nhl"), true);
  assert.equal(isExplicitOvertimeState(3, "End of 3rd", "nhl"), false);
});

test("NHL End P3 non-tied still end-of-regulation (reject live mains)", () => {
  assert.equal(isEndOfRegulationTransition(3, "End of 3rd", "nhl"), true);
});

test("NHL active OT", () => {
  assert.equal(isExplicitOvertimeState(4, "OT", "nhl"), true);
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 4,
    clock: "3:20",
    periodLabel: "OT",
  });
  assert.ok(rem != null && Math.abs(rem! - (3 + 20 / 60)) < 0.001);
});

test("NHL shootout + final markers", () => {
  assert.equal(isExplicitShootoutState(5, "Shootout"), true);
  assert.equal(isExplicitOvertimeState(5, "Shootout", "nhl"), false);
  assert.equal(isFinalState("Final"), true);
  assert.equal(isFinalState("Final/OT"), true);
});

// ---------- Settlement ----------

test("NHL settlement: ML through shootout; puck line/total through OT only", () => {
  const ml = resolveNhlLiveMarketSettlement({ market: "Moneyline", pick: "Bruins ML" });
  assert.equal(ml.ok, true);
  if (ml.ok) {
    assert.equal(ml.horizon, "through_shootout");
    assert.equal(ml.includesShootout, true);
  }
  const pl = resolveNhlLiveMarketSettlement({ market: "Spread", pick: "Bruins -1.5", });
  assert.equal(pl.ok, true);
  if (pl.ok) {
    assert.equal(pl.horizon, "through_ot");
    assert.equal(pl.includesShootout, false);
  }
  const tot = resolveNhlLiveMarketSettlement({ market: "Total", pick: "Over 5.5" });
  assert.equal(tot.ok, true);
  if (tot.ok) assert.equal(tot.horizon, "through_ot");
});

test("NHL settlement: regulation-only → reject", () => {
  const r = resolveNhlLiveMarketSettlement({
    market: "Moneyline",
    pick: "Bruins regulation ML",
  });
  assert.equal(r.ok, false);
});

// ---------- Eligibility fixtures ----------

function bruinsMarket(over: Partial<NormalizedLiveMarket> = {}): NormalizedLiveMarket {
  return {
    eventId: "nhl-live-1",
    sport: "nhl",
    matchup: "Toronto Maple Leafs @ Boston Bruins",
    awayTeam: "Toronto Maple Leafs",
    homeTeam: "Boston Bruins",
    awayScore: 2,
    homeScore: 3,
    state: "in",
    period: 2,
    periodLabel: "2nd Period",
    clock: "8:32",
    source: "espn_pickcenter",
    market: "Moneyline",
    pick: "Bruins ML",
    line: null,
    price: -135,
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

test("NHL live main eligible when gates pass", () => {
  const r = evaluateLiveRecommendationEligibility(bruinsMarket());
  assert.equal(r.eligible, true, r.reasons.join(","));
});

test("NHL End P3 tied awaiting OT → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({
      period: 3,
      periodLabel: "End of 3rd",
      clock: "20:00",
      awayScore: 3,
      homeScore: 3,
    }),
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("end_of_regulation_awaiting_ot"));
});

test("NHL End P3 non-tied → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({
      period: 3,
      periodLabel: "End of 3rd",
      clock: "20:00",
      awayScore: 2,
      homeScore: 4,
    }),
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("end_of_regulation_awaiting_ot"));
});

test("NHL active OT eligible for ML", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({
      period: 4,
      periodLabel: "OT",
      clock: "3:20",
      awayScore: 3,
      homeScore: 3,
      providerLastUpdate: "2026-10-06T03:00:00.000Z",
    }),
  );
  // End-of-period label absent; OT explicit. providerLastUpdate set to avoid
  // unrelated transition gate; OT itself has no End-of label.
  assert.equal(r.eligible, true, r.reasons.join(","));
});

test("NHL shootout: ML ok, total/spread rejected", () => {
  const ml = evaluateLiveRecommendationEligibility(
    bruinsMarket({
      period: 5,
      periodLabel: "Shootout",
      clock: "0:00",
      awayScore: 3,
      homeScore: 3,
    }),
  );
  assert.equal(ml.eligible, true, ml.reasons.join(","));

  const tot = evaluateLiveRecommendationEligibility(
    bruinsMarket({
      period: 5,
      periodLabel: "Shootout",
      clock: "0:00",
      awayScore: 3,
      homeScore: 3,
      market: "Total",
      pick: "Over 5.5",
      line: 5.5,
      price: -110,
    }),
  );
  assert.equal(tot.eligible, false);
  assert.ok(tot.reasons.includes("nhl_shootout_excludes_total_spread"));
});

test("NHL final → ineligible", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({
      state: "post",
      periodLabel: "Final",
      clock: "0:00",
    }),
  );
  assert.equal(r.eligible, false);
});

test("NHL stale quote → reject", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({ freshness: "stale", unsafe: true, unsafeReasons: ["stale_price"] }),
  );
  assert.equal(r.eligible, false);
});

test("NHL score/period advanced after quote → reject", () => {
  assert.equal(
    evaluateLiveRecommendationEligibility(
      bruinsMarket({ gameStateAdvanced: true, unsafe: true, unsafeReasons: ["score_advanced"] }),
    ).eligible,
    false,
  );
});

test("NHL missing clock → reject", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({ clock: null, periodLabel: "2nd Period" }),
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("missing_usable_clock"));
});

test("NHL unknown freshness → reject", () => {
  const r = evaluateLiveRecommendationEligibility(
    bruinsMarket({ freshness: "unknown", unsafe: true, unsafeReasons: ["unknown_freshness"] }),
  );
  assert.equal(r.eligible, false);
});

test("NHL props / alt / period markets rejected", () => {
  assert.equal(
    evaluateLiveRecommendationEligibility(bruinsMarket({ market: "Player Points" })).eligible,
    false,
  );
  assert.equal(
    evaluateLiveRecommendationEligibility(bruinsMarket({ market: "Alt Spread", line: -1.5 })).eligible,
    false,
  );
  assert.equal(
    evaluateLiveRecommendationEligibility(bruinsMarket({ market: "P1 Total", line: 1.5 })).eligible,
    false,
  );
});

// ---------- Remaining-game sim ----------

test("NHL remaining sim starts from current score (not 0-0) and runs 10k", () => {
  const baseQ = liveCoverQueryFromMarket(
    bruinsMarket({ market: "Moneyline", pick: "Bruins ML", price: -135 }),
  )!;
  const q = attachNhlSettlementToCoverQuery(baseQ, "Moneyline", "Bruins ML")!;
  const sim = runRemainingGameSim({
    sport: "nhl",
    homeScore: 3,
    awayScore: 2,
    period: 2,
    clock: "8:32",
    periodLabel: "2nd Period",
    homeBaselinePpg: 3.2,
    awayBaselinePpg: 3.0,
    simulations: 10_000,
    seed: 11,
    coverQueries: [q],
  });
  assert.ok(sim);
  assert.equal(sim!.remainingGameOnly, true);
  assert.equal(sim!.simulations, 10_000);
  assert.ok(sim!.homeProjectedFinal >= 3);
  assert.ok(sim!.awayProjectedFinal >= 2);
  assert.ok(sim!.remainingMinutes > 20 && sim!.remainingMinutes < 50);
  assert.ok(sim!.coverHitRates[q.id]! > 0.4);
});

test("NHL End of 1st + 20:00 does not invent 20 minutes in completed period", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 1,
    clock: "20:00",
    periodLabel: "End of 1st",
  });
  assert.equal(rem, 40);
  // Sim at End of 1st without provider sync is eligibility-rejected; math alone is 40.
});

test("example NHL real-state calculation: P2 8:32, Bruins lead 3-2", () => {
  const rem = remainingMinutesFromState({
    sport: "nhl",
    period: 2,
    clock: "8:32",
    periodLabel: "2nd Period",
  });
  // 8:32 left in P2 + full P3 (20) = 28:32 ≈ 28.533 min
  assert.ok(rem != null && Math.abs(rem! - (8 + 32 / 60 + 20)) < 0.001);

  const baseQ = liveCoverQueryFromMarket(
    bruinsMarket({ price: -135 }),
  )!;
  const q = attachNhlSettlementToCoverQuery(baseQ, "Moneyline", "Bruins ML")!;
  const sim = runRemainingGameSim({
    sport: "nhl",
    homeScore: 3,
    awayScore: 2,
    period: 2,
    clock: "8:32",
    periodLabel: "2nd Period",
    simulations: 10_000,
    seed: 42,
    coverQueries: [q],
  });
  assert.ok(sim);
  assert.equal(sim!.remainingGameOnly, true);
  // Leading home team should be favored in remaining-game ML.
  assert.ok(sim!.homeWinProbability > sim!.awayWinProbability);
  assert.ok(sim!.coverHitRates[q.id]! > 0.5);
});

// ---------- Build smoke ----------

test("build: 3 live NHL picks can return LIVE Bruins ticket", async () => {
  const now = "2026-10-06T03:00:00.000Z";
  const feed: LiveOddsFeed = {
    fetchedAt: now,
    games: [
      {
        sport: "nhl",
        game: "Toronto Maple Leafs @ Boston Bruins",
        status: "in",
        state: "in",
        awayTeam: "Toronto Maple Leafs",
        homeTeam: "Boston Bruins",
        awayScore: 2,
        homeScore: 3,
        period: 2,
        periodLabel: "2nd Period",
        clock: "8:32",
        eventId: "nhl-live-1",
        fetchedAt: now,
      },
    ],
    odds: [
      {
        sport: "nhl",
        game: "Toronto Maple Leafs @ Boston Bruins",
        market: "Moneyline",
        pick: "Bruins ML",
        odds: 150,
        live: true,
        eventId: "nhl-live-1",
        awayTeam: "Toronto Maple Leafs",
        homeTeam: "Boston Bruins",
        awayScore: 2,
        homeScore: 3,
        state: "in",
        period: 2,
        periodLabel: "2nd Period",
        clock: "8:32",
        fetchedAt: now,
        marketStatus: "open",
      },
      {
        sport: "nhl",
        game: "Toronto Maple Leafs @ Boston Bruins",
        market: "Spread",
        pick: "Bruins -1.5",
        odds: 140,
        line: -1.5,
        live: true,
        eventId: "nhl-live-1",
        awayTeam: "Toronto Maple Leafs",
        homeTeam: "Boston Bruins",
        awayScore: 2,
        homeScore: 3,
        state: "in",
        period: 2,
        periodLabel: "2nd Period",
        clock: "8:32",
        fetchedAt: now,
        marketStatus: "open",
      },
      {
        sport: "nhl",
        game: "Toronto Maple Leafs @ Boston Bruins",
        market: "Total",
        pick: "Under 9.5",
        odds: -110,
        line: 9.5,
        live: true,
        eventId: "nhl-live-1",
        awayTeam: "Toronto Maple Leafs",
        homeTeam: "Boston Bruins",
        awayScore: 2,
        homeScore: 3,
        state: "in",
        period: 2,
        periodLabel: "2nd Period",
        clock: "8:32",
        fetchedAt: now,
        marketStatus: "open",
      },
    ],
  };

  const result = await buildLiveCoachRecommendations({
    askText: "3 live NHL picks",
    feed,
    seed: 99,
    nowMs: Date.parse(now),
  });
  assert.equal(result.intent.sport, "nhl");
  assert.ok(result.picks.length >= 1, result.note);
  assert.ok(result.picks.every((p) => p.liveCoach?.live === true));
  assert.ok(result.picks.every((p) => p.sport === "nhl"));
});

// ---------- NBA/WNBA unchanged smoke ----------

test("NBA/WNBA remaining math unchanged (End of 4th / Q lengths)", () => {
  assert.equal(periodLengthMinutes("nba"), 12);
  assert.equal(regulationMinutes("nba"), 48);
  assert.equal(regulationPeriodCount("nba"), 4);
  assert.equal(
    remainingMinutesFromState({
      sport: "nba",
      period: 4,
      clock: "12:00",
      periodLabel: "End of 4th",
    }),
    0,
  );
  assert.equal(isEndOfRegulationTransition(4, "End of 4th", "nba"), true);
  assert.equal(periodLengthMinutes("wnba"), 10);
  assert.equal(regulationMinutes("wnba"), 40);
});
