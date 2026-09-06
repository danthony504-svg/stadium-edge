import assert from "node:assert/strict";
import test from "node:test";

import {
  createCoachMarketPipelineAudit,
  legsQualifiedForStaging,
  picksSimulationEligible,
} from "./coachMarketPipelineAudit.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

test("pipeline audit records counts by sport and market family at each stage", () => {
  const audit = createCoachMarketPipelineAudit("req-audit");
  audit.recordRawFeed([
    { game: "KC @ BUF", market: "Spread", pick: "KC +3", odds: -110, sport: "nfl", isProp: false },
    { game: "LAD @ SF", market: "Total Bases", pick: "Player Over 1.5", odds: -120, sport: "mlb", isProp: true, player: "Player", propLine: 1.5, propSide: "Over" },
  ]);
  audit.recordNormalized([
    { game: "KC @ BUF", market: "Spread", pick: "KC +3", odds: -110, sport: "nfl", isProp: false },
    { game: "LAD @ SF", market: "Total Bases", pick: "Player Over 1.5", odds: -120, sport: "mlb", isProp: true, player: "Player", propLine: 1.5, propSide: "Over" },
  ]);
  const simEligible = picksSimulationEligible([
    { game: "KC @ BUF", market: "Spread", pick: "KC +3", odds: -110, sport: "nfl", isProp: false },
    { game: "LAD @ SF", market: "Total Bases", pick: "Player Over 1.5", odds: -120, sport: "mlb", isProp: true, player: "Player", propLine: 1.5, propSide: "Over" },
  ]);
  audit.recordSimulationEligible(simEligible);
  const snap = audit.snapshot();
  assert.equal(snap.stages.raw_feed?.nfl?.spread, 1);
  assert.equal(snap.stages.raw_feed?.mlb?.playerProps, 1);
  assert.equal(snap.stages.simulation_eligible?.nfl?.spread, 1);
  assert.equal(snap.funnel?.normalized?.nfl?.spread, 1);
});

test("pipeline audit preserves simulation and qualification funnel evidence", () => {
  const audit = createCoachMarketPipelineAudit("req-funnel");
  const pick = { game: "KC @ BUF", market: "Spread", pick: "KC +3", odds: -110, sport: "nfl", isProp: false };
  const score: import("./finalAiScore.ts").FinalAiScore = {
    composite: 7, grade: "B", confidencePct: 58, edgePct: 3, simHit: 0.56,
    simAligned: true, highRiskValuePlay: false, recommends: true, factors: [],
    rubric: { composite: 7, grade: "B", confidencePct: 58, edgePct: 3, scores: {} as never },
  };
  audit.recordFunnel("simulationAttempted", [pick]);
  audit.recordFunnel("simulationAttempted", [pick]);
  audit.recordFunnel("simulationReturned", [pick]);
  audit.recordScoredFunnel(pick, score);
  audit.recordGameSimulation({
    sport: "nfl", event: pick.game, marketFamily: "spread", selection: pick.pick, line: 3, odds: -110,
    homeTeam: "BUF", awayTeam: "KC", simulationShape: ["outcomes"], homeScoreSource: "outcomes.homeScores",
    awayScoreSource: "outcomes.awayScores", sampleHomeScore: 24, sampleAwayScore: 20,
    submittedCoverQueryIds: ["kc @ buf|spread|kc +3"], submittedCoverQueryCount: 1,
    returnedCoverHitRateIds: ["kc @ buf|spread|kc +3"], returnedCoverHitRateCount: 1,
    outcomesReturned: true, homeScoreDrawCount: 10_000, awayScoreDrawCount: 10_000,
    winnerSource: null, totalSource: "homeScores + awayScores", parsedTeam: "KC", parsedSide: "away",
    parsedLine: 3, wins: 5600, losses: 4400, pushes: 0, simHitRate: 0.56, nullReason: null,
  });
  const snap = audit.snapshot();
  assert.equal(snap.funnel?.simulationAttempted?.nfl?.spread, 2);
  assert.equal(snap.funnel?.simulationGradable?.nfl?.spread, 1);
  assert.equal(snap.funnel?.positiveEdge?.nfl?.spread, 1);
  assert.equal(snap.qualificationGateCounts?.qualified_main?.nfl?.spread, 1);
  assert.equal(snap.gameSimulations?.[0]?.wins, 5600);
  assert.equal(snap.gameSimulations?.[0]?.homeScoreDrawCount, 10_000);
});

test("pipeline audit retains final family-variety counts and skip reasons", () => {
  const audit = createCoachMarketPipelineAudit("req-variety");
  audit.recordTicketVariety({
    qualifiedByFamily: {
      moneyline: 2, spread: 1, gameTotal: 1, teamTotal: 0,
      playerOu: 12, milestone: 0, alternate: 1,
    },
    selectedByFamily: {
      moneyline: 1, spread: 1, gameTotal: 1, teamTotal: 0,
      playerOu: 2, milestone: 0, alternate: 0,
    },
    skippedFamilies: [{
      marketFamily: "alternate",
      qualifiedCount: 1,
      reason: "Requested 5 legs; higher-ranked qualified families filled the family-coverage slots",
    }],
  });
  const snap = audit.snapshot();
  assert.equal(snap.ticketVariety?.qualifiedByFamily.playerOu, 12);
  assert.equal(snap.ticketVariety?.selectedByFamily.moneyline, 1);
  assert.equal(snap.ticketVariety?.skippedFamilies[0]?.marketFamily, "alternate");
});

test("pipeline audit exposes request-scoped prop selection counts and exclusion reason", () => {
  const audit = createCoachMarketPipelineAudit("req-prop-selection");
  const prop = {
    game: "KC @ BUF", market: "Passing Yards", pick: "Quarterback Over 250.5",
    odds: -110, sport: "nfl", isProp: true, player: "Quarterback", propLine: 250.5, propSide: "Over",
  };
  const game = { game: "KC @ BUF", market: "Spread", pick: "KC +3", odds: -110, sport: "nfl", isProp: false };
  const score = {
    composite: 7, grade: "B", confidencePct: 58, edgePct: 3, simHit: 0.56,
    simAligned: true, highRiskValuePlay: false, recommends: true, factors: [],
    rubric: { composite: 7, grade: "B", confidencePct: 58, edgePct: 3, scores: {} as never },
  };
  audit.recordNormalized([prop, game]);
  audit.recordPropSimulationSummary(1, 1);
  audit.recordQualified([
    { pick: prop, rankScore: 7, confidencePct: 58, edgePct: 3, grade: "B", simHit: 56 } as BoardScoredLeg,
    { pick: { ...game, finalAiScore: score }, rankScore: 8, confidencePct: 58, edgePct: 3, grade: "B", simHit: 56 } as BoardScoredLeg,
  ]);
  audit.recordTicketVariety({
    qualifiedByFamily: { moneyline: 0, spread: 1, gameTotal: 0, teamTotal: 0, playerOu: 1, milestone: 0, alternate: 0 },
    selectedByFamily: { moneyline: 0, spread: 1, gameTotal: 0, teamTotal: 0, playerOu: 0, milestone: 0, alternate: 0 },
    skippedFamilies: [{ marketFamily: "playerOu", qualifiedCount: 1, reason: "higher-ranked families filled the family-coverage slots" }],
  });
  audit.recordFinalSelected([game]);

  assert.deepEqual(audit.snapshot().playerPropDiagnostics, {
    playerPropCandidates: 1,
    playerPropSimulated: 1,
    playerPropQualified: 1,
    playerPropSelected: 0,
    gameLineQualified: 1,
    gameLineSelected: 1,
    playerPropSelectionReason: "higher-ranked families filled the family-coverage slots",
  });
});

test("pipeline audit records non-prop rejection reasons across sports", () => {
  const audit = createCoachMarketPipelineAudit("req-football");
  audit.recordNonPropCandidate(
    { game: "", market: "Spread", pick: "Team +3", odds: -110, sport: "mlb", isProp: false },
    "raw_feed",
    { unresolvedEvent: true },
  );
  audit.recordNonPropQualificationFailure(
    {
      game: "ALA @ AUB",
      market: "Moneyline",
      pick: "ALA ML",
      odds: -150,
      sport: "soccer",
      isProp: false,
      finalAiScore: {
        composite: 4,
        grade: "D",
        confidencePct: 40,
        edgePct: -1,
        simHit: 0.55,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: false,
        factors: [],
        rubric: { composite: 4, grade: "D", confidencePct: 40, edgePct: -1, scores: {} as never },
      },
    },
    "qualified",
  );
  const snap = audit.snapshot();
  assert.ok(snap.nonPropRejections.some((r) => r.gate === "unresolved_event" && r.sport === "mlb"));
  assert.ok(snap.nonPropRejections.some((r) => r.gate === "negative_edge" && r.sport === "soccer"));
});

test("legsQualifiedForStaging uses shared boardLegPoolRole gates", () => {
  const qualScore = {
    composite: 7,
    grade: "B",
    confidencePct: 58,
    edgePct: 3,
    simHit: 0.56,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { composite: 7, grade: "B", confidencePct: 58, edgePct: 3, scores: {} as never },
  };
  const scored: BoardScoredLeg[] = [
    {
      pick: { game: "A @ B", market: "Spread", pick: "A -3", odds: -110, sport: "nfl", isProp: false, finalAiScore: qualScore },
      evPct: 2,
      edgePct: 3,
      confidencePct: 58,
      impliedProbPct: 52,
      lineShoppingScore: 1,
      grade: "B",
      simHit: 0.56,
      composite: 7,
      rankScore: 7,
    },
    {
      pick: {
        game: "C @ D",
        market: "Points",
        pick: "Player Over 20.5 Points",
        odds: 130,
        sport: "nba",
        isProp: true,
        player: "Player",
        propLine: 20.5,
        propSide: "Over",
        finalAiScore: { ...qualScore, simHit: 0.45, simAligned: false },
      },
      evPct: 2,
      edgePct: 3,
      confidencePct: 58,
      impliedProbPct: 43,
      lineShoppingScore: 1,
      grade: "B",
      simHit: 0.45,
      composite: 7,
      rankScore: 6,
    },
  ];
  const qualified = legsQualifiedForStaging(scored);
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0]?.pick.market, "Spread");
});
