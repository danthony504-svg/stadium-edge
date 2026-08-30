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
  assert.equal(snap.stages.raw_feed?.mlb?.playerOu, 1);
  assert.equal(snap.stages.simulation_eligible?.nfl?.spread, 1);
});

test("pipeline audit records football rejection reasons", () => {
  const audit = createCoachMarketPipelineAudit("req-football");
  audit.recordFootballCandidate(
    { game: "", market: "Spread", pick: "Team +3", odds: -110, sport: "ncaaf", isProp: false },
    "raw_feed",
    { unresolvedEvent: true },
  );
  audit.recordFootballQualificationFailure(
    {
      game: "ALA @ AUB",
      market: "Moneyline",
      pick: "ALA ML",
      odds: -150,
      sport: "ncaaf",
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
  assert.ok(snap.footballRejections.some((r) => r.gate === "unresolved_event"));
  assert.ok(snap.footballRejections.some((r) => r.gate === "negative_edge"));
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
