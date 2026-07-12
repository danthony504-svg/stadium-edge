import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPropHolisticScore,
  combinePropHolisticFactors,
  CONFIDENCE_PENALTY_PER_MISSING,
  propHolisticRecommends,
  propHolisticTopDrivers,
  resolvePropHolisticForDisplay,
  PROP_HOLISTIC_WEIGHTS,
} from "./propHolisticRecommendation.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { pickIsAiRecommended } from "./pickRecommendation.ts";

test("PROP_HOLISTIC_WEIGHTS sum to 100%", () => {
  const sum = Object.values(PROP_HOLISTIC_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
});

test("missing contextual factors reduce confidence", () => {
  const rich = buildPropHolisticScore({
    sport: "nba",
    marketKey: "player_points",
    propSide: "Over",
    rubricScores: {
      trend: 8,
      matchup: 8,
      lineValue: 8,
      injury: 8,
      lineShopping: 7,
      simulation: 8,
    },
    edgePct: 3,
    simHit: 0.58,
    minutesTrend: { l5: 36, season: 30, direction: "up" },
    vsOpponentGames: 3,
  });
  const thin = buildPropHolisticScore({
    sport: "nba",
    marketKey: "player_points",
    propSide: "Over",
    rubricScores: {
      trend: null,
      matchup: null,
      lineValue: 8,
      injury: null,
      lineShopping: null,
      simulation: 8,
    },
    edgePct: 3,
    simHit: 0.58,
  });
  assert.ok((rich.confidencePct ?? 0) > (thin.confidencePct ?? 0));
  assert.ok(rich.coveragePct > thin.coveragePct);
  assert.equal(
    (rich.confidencePct ?? 0) - (thin.confidencePct ?? 0) >= CONFIDENCE_PENALTY_PER_MISSING,
    true,
  );
});

test("prop holistic recommends strongest opportunities not sim-only edges", () => {
  const holistic = buildPropHolisticScore({
    sport: "mlb",
    marketKey: "player_hits",
    propSide: "Over",
    rubricScores: {
      trend: 8.5,
      matchup: 8.5,
      lineValue: 8,
      injury: 8,
      lineShopping: 7.5,
      simulation: 8,
    },
    edgePct: 3.5,
    simHit: 0.58,
    minutesTrend: null,
    mlbPlatoon: {
      platoon: "advantage",
      opposingPitcherTendency: {
        hrPer9: 1.5,
        oppOPS: 0.8,
        kPer9: 6.8,
        barrelPctAllowed: 9.5,
        battedBallEvents: 50,
      },
    },
    mlbGameEnv: {
      park: { hrIndex: 112, dome: false },
      weather: { tempF: 82, windMph: 12 },
    },
    vsOpponentGames: 3,
  });
  const pick = {
    game: "Away @ Home",
    market: "Hits",
    pick: "Star Over 1.5",
    odds: -110,
    isProp: true,
    sport: "mlb",
    player: "Star",
    propSide: "Over" as const,
    propLine: 1.5,
  };
  const recommends = propHolisticRecommends(pick, holistic, {
    edgePct: 3.5,
    simHit: 0.58,
    odds: -110,
  });
  assert.equal(recommends, true);
  assert.ok((holistic.composite ?? 0) >= 7.5);
});

test("sim-positive prop with thin context fails strict AI gate but may fill ticket", () => {
  const holistic = buildPropHolisticScore({
    sport: "nba",
    marketKey: "player_points",
    propSide: "Over",
    rubricScores: {
      trend: null,
      matchup: null,
      lineValue: 7,
      injury: null,
      lineShopping: null,
      simulation: 7.5,
    },
    edgePct: 1.5,
    simHit: 0.55,
  });
  const pick = {
    game: "A @ B",
    market: "Points",
    pick: "Star Over 24.5",
    odds: 110,
    isProp: true,
    sport: "nba",
    player: "Star",
    propSide: "Over" as const,
    propLine: 24.5,
  };
  assert.equal(
    propHolisticRecommends(pick, holistic, { edgePct: 1.5, simHit: 0.55, odds: 110 }),
    false,
  );
  const final = buildFinalAiScore({
    pick,
    rubricScores: {
      trend: null,
      matchup: null,
      lineValue: 7,
      injury: null,
      lineShopping: null,
      simulation: 7.5,
    },
    edgePct: 1.5,
    propSimHit: 0.55,
    propHolisticContext: {
      sport: "nba",
      marketKey: "player_points",
      propSide: "Over",
    },
  });
  assert.equal(pickIsAiRecommended(pick, final), false);
});

test("combinePropHolisticFactors renormalizes present factors", () => {
  const composite = combinePropHolisticFactors([
    { key: "simulation", label: "Simulation", score: 8, applicable: true, present: true },
    { key: "recentForm", label: "Recent Form", score: 8, applicable: true, present: true },
    { key: "lineMovement", label: "Line Movement", score: null, applicable: true, present: false },
    { key: "sportsbookValue", label: "Sportsbook Value", score: 8, applicable: true, present: true },
    { key: "matchup", label: "Matchup", score: null, applicable: true, present: false },
    { key: "opponentTendency", label: "Opponent", score: null, applicable: true, present: false },
    { key: "injury", label: "Injury", score: null, applicable: true, present: false },
    { key: "playingTime", label: "Minutes", score: null, applicable: true, present: false },
    { key: "weather", label: "Weather", score: null, applicable: false, present: false },
  ]);
  assert.equal(composite, 8);
});

test("buildFinalAiScore uses holistic composite for props", () => {
  const score = buildFinalAiScore({
    pick: {
      game: "Away @ Home",
      market: "Points",
      pick: "Star Over 22.5",
      odds: -108,
      isProp: true,
      sport: "nba",
      player: "Star",
      propSide: "Over",
      propLine: 22.5,
    },
    rubricScores: {
      trend: 8,
      matchup: 7.5,
      lineValue: 7,
      injury: 7,
      lineShopping: 6.5,
      simulation: 7.8,
    },
    edgePct: 2.8,
    propSimHit: 0.57,
    propHolisticContext: {
      sport: "nba",
      marketKey: "player_points",
      propSide: "Over",
      minutesTrend: { l5: 35, season: 31, direction: "up" },
      vsOpponentGames: 4,
    },
  });
  assert.ok(score.propHolistic);
  assert.equal(score.composite, score.propHolistic?.composite);
  assert.equal(score.grade, score.propHolistic?.grade);
});

test("propHolisticTopDrivers lists strongest grounded factors", () => {
  const holistic = buildPropHolisticScore({
    sport: "mlb",
    marketKey: "player_home_runs",
    propSide: "Over",
    rubricScores: {
      trend: 6.5,
      matchup: 7,
      lineValue: 5.5,
      injury: null,
      lineShopping: null,
      simulation: 7.2,
    },
    edgePct: 3.1,
    simHit: 0.54,
    minutesTrend: { l5: 4, season: 3.5, direction: "up" },
    vsOpponentGames: 6,
  });
  const drivers = propHolisticTopDrivers(holistic);
  assert.match(drivers, /Recent Form|Simulation|Matchup/);
  assert.doesNotMatch(drivers, /Waiting on matchup/);
});

test("resolvePropHolisticForDisplay synthesizes holistic strip from rubric scores", () => {
  const holistic = resolvePropHolisticForDisplay({
    game: "Sky @ Wings",
    market: "Assists",
    pick: "Paige Bueckers Over 6.5 Assists",
    odds: 132,
    isProp: true,
    player: "Paige Bueckers",
    propSide: "Over",
    propLine: 6.5,
    sport: "wnba",
    scores: {
      composite: 6.1,
      grade: "B-",
      confidencePct: 56,
      edgePct: 1.1,
      scores: {
        matchup: 6.2,
        trend: 6.5,
        lineValue: 6.8,
        injury: 5.8,
        lineShopping: 6,
        simulation: 6.4,
      },
    },
  });
  assert.ok(holistic);
  assert.ok(holistic!.factors.some((f) => f.key === "recentForm" && f.present));
  assert.ok(holistic!.factors.some((f) => f.key === "sportsbookValue" && f.present));
});
