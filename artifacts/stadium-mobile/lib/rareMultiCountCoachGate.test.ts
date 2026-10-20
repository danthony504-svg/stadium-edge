/**
 * Rare multi-count fail-closed: lottery EV cannot seat O1.5 HR on normal Coach.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COACH_PIPELINE_VERSION,
  coachCandidateIsQualified,
  withCoachQualification,
} from "./coach/qualifyCoachCandidate.ts";
import { propBelongsToGameTeams } from "./propGameTeamGate.ts";
import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";
import {
  gradeFootballPropFromHistory,
  type PropsOnlyHistorySlice,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  isRareMultiCountOver,
  rareCountHitFromValues,
  rareCountHitReliability,
} from "./rareCountPropModel.ts";
import {
  assertUnifiedQualityPipeline,
  askAllowsRareMultiCountProps,
  preferAnytimeOverRareMultiCount,
  rareHrHardContextOk,
  rareMultiCountBoundedEdgePct,
  rareMultiCountLotteryPathOpen,
  rareMultiCountNormalSeatAllowed,
  rareMultiCountSportsbookValueScore,
  RARE_IMPLIED_PROB_THRESHOLD,
  RARE_EV_GRADE_EDGE_CAP,
  RARE_MULTI_COUNT_MIN_RELIABILITY,
} from "./rareMultiCountCoachGate.ts";
import { boardLegPoolRole, type BoardScoredLeg } from "./ticketStaging.ts";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  exactMarket10kProvenance,
  withExactMarket10kProvenance,
} from "./coachPropProbabilityProvenance.ts";

test("pipeline attestation: COACH_PIPELINE_VERSION is unified-quality-v1", () => {
  const a = assertUnifiedQualityPipeline();
  assert.equal(a.ok, true);
  assert.equal(a.version, "unified-quality-v1");
  assert.equal(COACH_PIPELINE_VERSION, "unified-quality-v1");
});

test("isRareMultiCountOver: HR/SB/goals ≥1.5 only — not receptions/assists", () => {
  assert.equal(
    isRareMultiCountOver({ market: "batter_home_runs", side: "Over", line: 1.5 }),
    true,
  );
  assert.equal(
    isRareMultiCountOver({ market: "batter_home_runs", side: "Over", line: 0.5 }),
    false,
  );
  assert.equal(
    isRareMultiCountOver({ market: "batter_stolen_bases", side: "Over", line: 1.5 }),
    true,
  );
  assert.equal(
    isRareMultiCountOver({ market: "player_goals", side: "Over", line: 1.5 }),
    true,
  );
  assert.equal(
    isRareMultiCountOver({ market: "player_receptions", side: "Over", line: 1.5 }),
    false,
  );
  assert.equal(
    isRareMultiCountOver({ market: "player_assists", side: "Over", line: 1.5 }),
    false,
  );
  assert.equal(
    isRareMultiCountOver({ market: "player_rush_attempts", side: "Over", line: 1.5 }),
    false,
  );
});

test("askAllowsRareMultiCountProps: lottery / longshot / 2+ HR", () => {
  assert.equal(askAllowsRareMultiCountProps("8 leg lottery"), true);
  assert.equal(askAllowsRareMultiCountProps("longshot parlays"), true);
  assert.equal(askAllowsRareMultiCountProps("5 leg 2+ HR"), true);
  assert.equal(askAllowsRareMultiCountProps("multi-HR props"), true);
  assert.equal(askAllowsRareMultiCountProps("2 home runs tonight"), true);
  assert.equal(askAllowsRareMultiCountProps("8 leg for today"), false);
  assert.equal(askAllowsRareMultiCountProps("5 home run picks"), false);
  assert.equal(askAllowsRareMultiCountProps("2 leg home runs"), false);
});

test("EV cap: +110000 / +45000 / +22500 cannot manufacture C+ from EV alone", () => {
  for (const odds of [22500, 45000, 110000]) {
    const simHit = 0.1;
    const edge = simEdgeFromHit(simHit, odds)!;
    assert.ok(edge > 9, `raw edge ${edge} @ ${odds}`);
    const bounded = rareMultiCountBoundedEdgePct(edge, odds, {
      market: "batter_home_runs",
      side: "Over",
      line: 1.5,
    })!;
    assert.ok(
      bounded <= RARE_EV_GRADE_EDGE_CAP * (impliedProb(odds) / RARE_IMPLIED_PROB_THRESHOLD) + 1e-9,
      `bounded ${bounded} @ ${odds}`,
    );
    const value = rareMultiCountSportsbookValueScore(edge, odds, {
      market: "batter_home_runs",
      side: "Over",
      line: 1.5,
    })!;
    // Holistic with only EV + weak sim must stay below C+ (composite 6.0).
    const h = buildPropHolisticScore({
      sport: "mlb",
      marketKey: "batter_home_runs",
      propSide: "Over",
      propLine: 1.5,
      odds,
      edgePct: edge,
      simHit,
      rubricScores: {
        trend: null,
        matchup: null,
        lineValue: null,
        injury: null,
        lineShopping: null,
        simulation: null,
      },
    });
    assert.ok(h.grade != null);
    assert.ok(
      ["F", "D", "C-", "C"].includes(h.grade!),
      `odds=${odds} grade=${h.grade} value=${value} composite=${h.composite}`,
    );
    assert.notEqual(h.grade, "C+");
    assert.ok((h.factors.find((f) => f.key === "sportsbookValue")?.score ?? 10) < 7.5);
  }
});

test("ordinary markets keep uncapped EV behavior", () => {
  const edge = 8;
  const bounded = rareMultiCountBoundedEdgePct(edge, 150, {
    market: "player_reception_yds",
    side: "Over",
    line: 69.5,
  });
  assert.equal(bounded, 8);
});

test("0/10 rare history does not become 2%", () => {
  const zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(rareCountHitFromValues(zeros, 1.5, "Over"), null);
  const graded = gradeFootballPropFromHistory(
    {
      isProp: true,
      sport: "mlb",
      player: "Dustin Harris",
      athleteId: "1",
      propMarketKey: "batter_home_runs",
      market: "Home Runs",
      propLine: 1.5,
      propSide: "Over",
      odds: 25000,
      game: "Padres @ Brewers",
      pick: "Dustin Harris Over 1.5 Home Runs",
    } as ParsedPick,
    { recent: zeros.map((hr) => ({ stats: { HR: String(hr) } })) } as PropsOnlyHistorySlice,
    { marketKey: "batter_home_runs", line: 1.5 },
  );
  assert.equal(graded.hitProbability, null);
});

test("1/10 2-HR history does not blindly become 10% without shrink", () => {
  const vals = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0];
  const p15 = rareCountHitFromValues(vals, 1.5, "Over")!;
  assert.ok(p15 < 0.05, `poisson p=${p15}`);
  const rel = rareCountHitReliability(vals, 1.5, "Over");
  assert.ok(rel < RARE_MULTI_COUNT_MIN_RELIABILITY, `rel=${rel}`);
  assert.equal(
    rareMultiCountNormalSeatAllowed(
      {
        isProp: true,
        propMarketKey: "batter_home_runs",
        propSide: "Over",
        propLine: 1.5,
      },
      { askText: "8 leg for today", hitReliability: rel },
    ),
    false,
  );
});

test("O1.5 HR +22500 cannot seat in normal Coach with thin evidence", () => {
  const pick = {
    isProp: true,
    sport: "mlb",
    player: "Luis Campusano",
    propMarketKey: "batter_home_runs",
    market: "Home Runs",
    propSide: "Over",
    propLine: 1.5,
    odds: 22500,
    game: "Padres @ Brewers",
    pick: "Luis Campusano Over 1.5 Home Runs",
    finalAiScore: {
      grade: "C+",
      confidencePct: 52,
      edgePct: 1.6,
      simHit: 0.02,
      simAligned: true,
      recommends: true,
      composite: 6.1,
      highRiskValuePlay: false,
      factors: [],
      rubric: { composite: 6.1, grade: "C+", confidencePct: 52, edgePct: 1.6, scores: {} as never },
    },
  } as ParsedPick;

  assert.equal(
    boardLegPoolRole(pick, pick.finalAiScore, {
      askText: "8 leg for today",
      ticketStyle: "balanced",
      hitReliability: 0.2,
    }),
    null,
  );
  assert.equal(
    rareMultiCountNormalSeatAllowed(pick, {
      askText: "8 leg lottery",
      hitReliability: 0.2,
    }),
    true,
  );
});

test("prefer anytime 0.5 over 1.5 when both exist for normal request", () => {
  const anytime = {
    isProp: true as const,
    player: "Judge",
    athleteId: "1",
    propMarketKey: "batter_home_runs",
    propSide: "Over",
    propLine: 0.5,
  };
  const multi = {
    isProp: true as const,
    player: "Judge",
    athleteId: "1",
    propMarketKey: "batter_home_runs",
    propSide: "Over",
    propLine: 1.5,
  };
  const other = {
    isProp: true as const,
    player: "Ohtani",
    athleteId: "2",
    propMarketKey: "batter_home_runs",
    propSide: "Over",
    propLine: 1.5,
  };
  const filtered = preferAnytimeOverRareMultiCount(
    [anytime, multi, other],
    { askText: "5 home run picks" },
  );
  assert.ok(filtered.includes(anytime));
  assert.ok(!filtered.includes(multi), "Judge 1.5 dropped when 0.5 exists");
  assert.ok(filtered.includes(other), "Ohtani 1.5 kept — no anytime twin");

  const lotteryKeep = preferAnytimeOverRareMultiCount(
    [anytime, multi],
    { askText: "2+ HR lottery" },
  );
  assert.equal(lotteryKeep.length, 2);
});

test("explicit 2+ HR / lottery path stays open", () => {
  assert.equal(rareMultiCountLotteryPathOpen({ askText: "2+ home runs" }), true);
  assert.equal(rareMultiCountLotteryPathOpen({ ticketStyle: "longshot" }), true);
  assert.equal(
    rareMultiCountNormalSeatAllowed(
      {
        isProp: true,
        propMarketKey: "batter_home_runs",
        propSide: "Over",
        propLine: 1.5,
      },
      { askText: "multi-HR longshots", hitReliability: 0.1 },
    ),
    true,
  );
});

test("2+ HR stamp survives later boardLegPoolRole without askText", () => {
  // Defect guard: "2+ HR" is balanced style (not longshot). Qualify with
  // allowRareMultiCount, then a bare boardLegPoolRole() must still allow.
  const pick = withExactMarket10kProvenance({
    athleteId: "ath-hr",
    eventId: "evt-hr",
    isProp: true,
    sport: "mlb",
    player: "Judge",
    propMarketKey: "batter_home_runs",
    market: "Home Runs",
    propSide: "Over",
    propLine: 1.5,
    odds: 30000,
    game: "A @ B",
    pick: "Judge Over 1.5 Home Runs",
    allowRareMultiCount: true,
    hitReliability: 0.2,
    simHit: 0.03,
    finalAiScore: {
      grade: "C+",
      confidencePct: 55,
      edgePct: 2,
      simHit: 0.03,
      simAligned: true,
      recommends: true,
      composite: 6.1,
      highRiskValuePlay: false,
      factors: [],
      rubric: {
        composite: 6.1,
        grade: "C+",
        confidencePct: 55,
        edgePct: 2,
        scores: {} as never,
      },
      propProbabilityProvenance: exactMarket10kProvenance({
        hitProbability: 0.03,
        simulations: 10_000,
        sport: "mlb",
        marketKey: "batter_home_runs",
      
      athleteId: "ath-hr",
      eventId: "evt-hr",
      side: "Over",
      line: 1.5,
    }),
    },
  }) as ParsedPick & { allowRareMultiCount: boolean; hitReliability: number };
  assert.notEqual(boardLegPoolRole(pick, pick.finalAiScore), null);
  assert.equal(
    boardLegPoolRole(
      Object.assign({}, pick, { allowRareMultiCount: false }),
      pick.finalAiScore,
    ),
    null,
  );
});

test("combinator path: 2+ HR ask seats rare multi-count (balanced style)", () => {
  // Main N≥3 path is buildIndependentCoachTicket — must honor askText /
  // allowRareMultiCount, not only longshot ticketStyle.
  const score = {
    grade: "B",
    confidencePct: 56,
    edgePct: 4,
    simHit: 0.04,
    simAligned: true,
    recommends: true,
    composite: 7.2,
    highRiskValuePlay: false,
    factors: [],
    rubric: {
      composite: 7.2,
      grade: "B",
      confidencePct: 56,
      edgePct: 4,
      scores: {} as never,
    },
  };
  const mkHr = (player: string, game: string, rank: number): BoardScoredLeg => ({
    pick: withExactMarket10kProvenance({
    athleteId: "ath-hr",
    eventId: "evt-hr",
      isProp: true,
      sport: "mlb",
      player,
      propMarketKey: "batter_home_runs",
      market: "Home Runs",
      propSide: "Over",
      propLine: 1.5,
      odds: 25000,
      game,
      pick: `${player} Over 1.5 Home Runs`,
      simHit: 0.04,
      finalAiScore: {
        ...score,
        composite: rank,
        propProbabilityProvenance: exactMarket10kProvenance({
          hitProbability: 0.04,
          simulations: 10_000,
          sport: "mlb",
          marketKey: "batter_home_runs",
        
      athleteId: "ath-hr",
      eventId: "evt-hr",
      side: "Over",
      line: 1.5,
    }),
      },
    }) as ParsedPick,
    evPct: 4,
    edgePct: 4,
    confidencePct: 56,
    impliedProbPct: 4,
    lineShoppingScore: null,
    grade: "B",
    simHit: 0.04,
    composite: rank,
    rankScore: rank,
    hitReliability: 0.2,
  });
  const scored = [
    mkHr("Judge", "NYY @ BOS", 90),
    mkHr("Ohtani", "LAD @ SF", 88),
    mkHr("Soto", "NYM @ PHI", 86),
    mkHr("Harper", "PHI @ WSH", 84),
    mkHr("Trout", "LAA @ SEA", 82),
  ];
  const blocked = buildIndependentCoachTicket(scored, 3, {
    varietySeed: "rare-2plus-blocked",
    ticketStyle: "balanced",
  });
  assert.equal(
    blocked.picks.filter((p) => Number(p.propLine) >= 1.5).length,
    0,
    "without 2+ ask, combinator must not seat rare multi-count",
  );
  const allowed = buildIndependentCoachTicket(scored, 3, {
    varietySeed: "rare-2plus-open",
    ticketStyle: "balanced",
    askText: "2+ home runs",
    allowRareMultiCount: true,
  });
  assert.ok(
    allowed.picks.some((p) => Number(p.propLine) >= 1.5),
    "2+ ask must seat rare multi-count on combinator path",
  );
  assert.ok(
    allowed.picks.every(
      (p) => (p as { allowRareMultiCount?: boolean }).allowRareMultiCount === true,
    ),
    "seated picks must carry allowRareMultiCount stamp",
  );
});

test("F/D/C- remain blocked by #711 even when rare path open", () => {
  for (const grade of ["F", "D", "C-"] as const) {
    const q = withCoachQualification(
      {
        isProp: true,
        market: "Home Runs",
        sport: "mlb",
        odds: 30000,
        propsOnlyTicket: true,
        grade,
        confidencePct: 52,
        edgePct: 9,
        simHit: 0.1,
        finalAiScore: {
          grade,
          confidencePct: 52,
          edgePct: 9,
          simHit: 0.1,
        },
      },
      { requestStyle: "longshot", isProp: true },
    );
    assert.equal(q.qualificationStatus, "rejected");
    assert.equal(
      coachCandidateIsQualified(q, { requestStyle: "longshot", isProp: true }),
      false,
    );
  }
});

test("player/event grounding remains fail-closed", () => {
  assert.equal(propBelongsToGameTeams(null, "1", "2"), false);
  assert.equal(propBelongsToGameTeams("9", "1", "2"), false);
  assert.equal(propBelongsToGameTeams("1", "1", "2"), true);
  const ctx = rareHrHardContextOk({
    playerTeamId: null,
    homeTeamId: "10",
    awayTeamId: "20",
    gameEnv: {
      park: { hrIndex: 110 },
      homePitcher: { name: "A", tendency: { hrPer9: 1.2 } },
    },
    hrHistoryValues: [0, 1, 0, 0, 1],
    playerTeamIsHome: true,
  });
  assert.equal(ctx.ok, false);
  assert.ok(ctx.missing.includes("player_event_team_grounding"));
  assert.ok(ctx.required.includes("opposing_pitcher_context"));
  assert.ok(ctx.required.includes("venue_park_context"));
  assert.ok(ctx.required.includes("historical_hr_evidence"));
});

test("before/after numeric: lottery odds Edge stays huge raw but grade EV is bounded", () => {
  const cases = [
    { odds: 22500, hit: 0.02 },
    { odds: 45000, hit: 0.1 },
    { odds: 110000, hit: 0.1 },
  ];
  for (const c of cases) {
    const rawEdge = simEdgeFromHit(c.hit, c.odds)!;
    const rawEv = simEvPct(c.hit, c.odds)!;
    const bounded = rareMultiCountBoundedEdgePct(rawEdge, c.odds, {
      market: "batter_home_runs",
      side: "Over",
      line: 1.5,
    })!;
    assert.ok(rawEv > 300, `raw EV ${rawEv}`);
    assert.ok(bounded < 1.0, `bounded edge ${bounded} @ ${c.odds}`);
    assert.ok(bounded < rawEdge);
  }
});
