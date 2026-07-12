import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_AI_RECOMMENDED,
  filterAiRecommendedPicks,
  filterTicketPicks,
  filterTicketPicksPreservingTicket,
  pickGradeDisplayCaption,
  pickGradeDisplayLabel,
  pickIsAiRecommended,
  qualifiesAltPick,
  sanitizeCoachTicketPicks,
} from "./pickRecommendation.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { NOT_YET_AI_GRADED } from "./simMarketSupport.ts";

test("qualifiesAltPick accepts alt ladder legs at the main confidence bar", () => {
  const score = {
    composite: 6,
    grade: "C+",
    confidencePct: 52,
    edgePct: 1.2,
    simHit: 0.52,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.2, scores: {} as never },
  };
  assert.equal(
    qualifiesAltPick({ market: "Alt Spread", sport: "mlb", odds: 110 }, score),
    true,
  );
  assert.equal(
    qualifiesAltPick(
      { market: "Alt Spread", sport: "mlb", odds: 110 },
      { ...score, confidencePct: 51 },
    ),
    false,
    "confidence below 52% must not qualify",
  );
  assert.equal(
    qualifiesAltPick(
      { market: "Alt Spread", sport: "mlb", odds: 110 },
      { ...score, edgePct: -0.5 },
    ),
    false,
  );
});

test("filterTicketPicksPreservingTicket keeps qualifying alts when strict filter zeros ticket", () => {
  const weakMain = {
    game: "A @ B",
    market: "Spread",
    pick: "B -3.5",
    odds: -110,
    ticketRole: "main" as const,
    finalAiScore: {
      composite: 5,
      grade: "C",
      confidencePct: 45,
      edgePct: -1,
      simHit: 0.47,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 5, grade: "C", confidencePct: 45, edgePct: -1, scores: {} as never },
    },
  };
  const altLeg = {
    game: "C @ D",
    market: "Alt Spread",
    pick: "C +2.5",
    odds: 115,
    ticketRole: "alt" as const,
    finalAiScore: {
      composite: 6,
      grade: "C+",
      confidencePct: 52,
      edgePct: 1.1,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.1, scores: {} as never },
    },
  };
  const out = filterTicketPicksPreservingTicket([weakMain, altLeg]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.ticketRole, "alt");
});

test("pickIsAiRecommended rejects High-Risk Value Play when sim disagrees", () => {
  const hrVp = {
    composite: 7,
    grade: "B",
    confidencePct: 58,
    edgePct: 12,
    simHit: 0.32,
    simAligned: false,
    highRiskValuePlay: true,
    recommends: true,
    factors: [],
    rubric: { composite: 7, grade: "B", confidencePct: 58, edgePct: 12, scores: {} as never },
  };
  assert.equal(
    pickIsAiRecommended({ market: "Moneyline", sport: "mlb", odds: 135 }, hrVp),
    false,
  );
});

test("sanitizeCoachTicketPicks strips High-Risk Value Play and sim-opposed legs", () => {
  const hrVp = {
    game: "KC @ BAL",
    market: "Moneyline",
    pick: "Royals ML",
    odds: 135,
    highRiskValuePlay: true,
    ticketRole: "main" as const,
    finalAiScore: {
      composite: 7,
      grade: "B",
      confidencePct: 58,
      edgePct: 12,
      simHit: 0.32,
      simAligned: false,
      highRiskValuePlay: true,
      recommends: true,
      factors: [],
      rubric: { composite: 7, grade: "B", confidencePct: 58, edgePct: 12, scores: {} as never },
    },
  };
  assert.equal(sanitizeCoachTicketPicks([hrVp]).length, 0);

  const alt = {
    game: "E @ F",
    market: "Alt Spread",
    pick: "F +3.5",
    odds: -105,
    isProp: false,
    sport: "mlb",
    startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    ticketRole: "alt" as const,
    highRiskValuePlay: true,
    finalAiScore: {
      composite: 6,
      grade: "C+",
      confidencePct: 52,
      edgePct: 1.5,
      simHit: 0.53,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.5, scores: {} as never },
    },
  };
  const out = sanitizeCoachTicketPicks([alt], {
    realOdds: [{ game: "E @ F", market: "Alt Spread", pick: "F +3.5", odds: -105, startsAt: alt.startsAt }],
    gameMeta: [{ game: "E @ F", sport: "mlb", startsAt: alt.startsAt, homeTeam: "F", awayTeam: "E", homeAbbr: "F", awayAbbr: "E", homeLogo: null, awayLogo: null }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.highRiskValuePlay, false);
  assert.equal(out[0]!.finalAiScore?.highRiskValuePlay, false);
});

test("filterTicketPicksPreservingTicket drops sim-opposed legs from rescoring fallback", () => {
  const simOpposed = {
    game: "MIL @ STL",
    market: "Moneyline",
    pick: "Brewers ML",
    odds: 130,
    ticketRole: "main" as const,
    finalAiScore: {
      composite: 6.2,
      grade: "C+",
      confidencePct: 52,
      edgePct: 1.4,
      simHit: 0.48,
      simAligned: false,
      highRiskValuePlay: true,
      recommends: true,
      factors: [],
      rubric: { composite: 6.2, grade: "C+", confidencePct: 52, edgePct: 1.4, scores: {} as never },
    },
  };
  assert.equal(filterTicketPicksPreservingTicket([simOpposed]).length, 0);
});

test("filterTicketPicksPreservingTicket keeps sim-aligned positive-edge legs after rescoring", () => {
  const aligned = {
    game: "MIL @ STL",
    market: "Moneyline",
    pick: "Brewers ML",
    odds: 130,
    ticketRole: "main" as const,
    finalAiScore: {
      composite: 6.2,
      grade: "C+",
      confidencePct: 52,
      edgePct: 1.4,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 6.2, grade: "C+", confidencePct: 52, edgePct: 1.4, scores: {} as never },
    },
  };
  const out = filterTicketPicksPreservingTicket([aligned]);
  assert.equal(out.length, 1);
  assert.equal(out[0].pick, "Brewers ML");
});

test("filterTicketPicksPreservingTicket returns empty when no leg passes gates", () => {
  const weak = {
    game: "A @ B",
    market: "Home Runs",
    pick: "Player Over 0.5",
    odds: 400,
    isProp: true,
    ticketRole: "main" as const,
    finalAiScore: {
      composite: 9,
      grade: "A+",
      confidencePct: 60,
      edgePct: 2,
      simHit: null,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 9, grade: "A+", confidencePct: 60, edgePct: 2, scores: {} as never },
    },
    scores: { composite: 9, grade: "A+", confidencePct: 60, edgePct: 2 },
  };
  assert.equal(filterTicketPicksPreservingTicket([weak]).length, 0);
});

test("filterTicketPicks keeps staged alt legs that fail strict main gate", () => {
  const altLeg = {
    game: "A @ B",
    market: "Alt Spread",
    pick: "A +2.5",
    odds: 115,
    ticketRole: "alt" as const,
    finalAiScore: {
      composite: 6,
      grade: "C+",
      confidencePct: 52,
      edgePct: 1.1,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.1, scores: {} as never },
    },
  };
  const out = filterTicketPicks([altLeg]);
  assert.equal(out.length, 1);
});

test("pickIsAiRecommended requires sim grade and positive thresholds", () => {
  const score = {
    composite: 8,
    grade: "A",
    confidencePct: 65,
    edgePct: 4,
    simHit: 0.58,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { composite: 8, grade: "A", confidencePct: 65, edgePct: 4, scores: {} as never },
  };
  assert.equal(pickIsAiRecommended({ market: "Spread", sport: "nba", odds: -110 }, score), true);
});

test("pickGradeDisplayLabel shows Not AI Recommended when sim exists but thresholds fail", () => {
  const score = buildFinalAiScore({
    pick: {
      game: "A @ B",
      market: "Spread",
      pick: "B -3.5",
      odds: -110,
      isProp: false,
      sport: "nba",
    },
    rubricScores: {
      matchup: 5,
      trend: 5,
      lineValue: 5,
      injury: 5,
      lineShopping: 5,
      simulation: 5,
    },
    edgePct: -1,
    gameSim: {
      sport: "nba",
      simulations: 10_000,
      homeWinProbability: 0.48,
      awayWinProbability: 0.52,
      tieProbability: 0,
      homeProjectedScore: 108,
      awayProjectedScore: 109,
      mostLikelyWinner: "away",
      mostLikelyWinnerPct: 0.52,
      confidenceScore: 50,
      coverHitRates: { "a @ b|spread|b -3.5": 0.49 },
    },
  });
  assert.equal(
    pickGradeDisplayLabel({ market: "Spread", sport: "nba", odds: -110 }, score),
    NOT_AI_RECOMMENDED,
  );
});

test("filterAiRecommendedPicks removes sub-threshold legs", () => {
  const good = {
    game: "A @ B",
    market: "Spread",
    pick: "B -3.5",
    odds: -110,
    isProp: false,
    sport: "nba",
    finalAiScore: {
      composite: 8,
      grade: "A",
      confidencePct: 65,
      edgePct: 4,
      simHit: 0.58,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { composite: 8, grade: "A", confidencePct: 65, edgePct: 4, scores: {} as never },
    },
  };
  const weak = {
    ...good,
    finalAiScore: {
      ...good.finalAiScore,
      edgePct: -2,
      recommends: false,
      simHit: 0.44,
    },
  };
  const out = filterAiRecommendedPicks([good, weak]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.pick, good.pick);
});

test("unsupported market uses not-yet-graded path via pickHasSimGrade", () => {
  assert.equal(
    pickGradeDisplayLabel({ market: "Both Teams To Score", sport: "soccer" }, null),
    null,
  );
});

test("pickGradeDisplayLabel shows letter grade for alt-qualified plus-money ML", () => {
  const score = {
    composite: 6,
    grade: "B-",
    confidencePct: 58,
    edgePct: 2.5,
    simHit: 0.55,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { composite: 6, grade: "B-", confidencePct: 58, edgePct: 2.5, scores: {} as never },
  };
  const pick = { market: "Moneyline", sport: "mlb", odds: 110, ticketRole: "main" as const };
  assert.equal(pickGradeDisplayLabel(pick, score), "B-");
  assert.equal(
    pickGradeDisplayCaption(pick, score),
    "Passes sim, edge, EV, and confidence thresholds",
  );
});
