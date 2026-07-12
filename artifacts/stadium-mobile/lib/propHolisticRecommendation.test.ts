import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPropHolisticScore,
  buildCoachCardHolistic,
  combinePropHolisticFactors,
  CONFIDENCE_PENALTY_PER_MISSING,
  propHolisticRecommends,
  propHolisticTopDrivers,
  resolvePropHolisticForDisplay,
  minimalPropHolisticForPick,
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

test("resolvePropHolisticForDisplay merges rubric factors into thin propHolistic", () => {
  const holistic = resolvePropHolisticForDisplay({
    game: "Storm @ Mystics",
    market: "Rebounds",
    pick: "Dominique Malonga Under 8.5 Rebounds",
    odds: -127,
    isProp: true,
    player: "Dominique Malonga",
    propSide: "Under",
    propLine: 8.5,
    sport: "wnba",
    finalAiScore: {
      composite: 6,
      grade: "C+",
      confidencePct: 50,
      edgePct: 1.2,
      simHit: 0.52,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: {
        composite: 6,
        grade: "C+",
        confidencePct: 50,
        edgePct: 1.2,
        scores: {
          matchup: 6.1,
          trend: 6.4,
          lineValue: 6.2,
          injury: 5.9,
          lineShopping: 6,
          simulation: 6.3,
        },
      },
      propHolistic: {
        composite: 6,
        grade: "C+",
        confidencePct: 48,
        coveragePct: 12,
        missingCount: 7,
        applicableCount: 8,
        recommends: false,
        factors: [
          {
            key: "sportsbookValue",
            label: "Sportsbook Value",
            score: 6.1,
            applicable: true,
            present: true,
          },
        ],
      },
    },
  });
  assert.ok(holistic);
  assert.ok(holistic!.factors.some((f) => f.key === "recentForm" && f.present));
  assert.ok(holistic!.factors.some((f) => f.key === "matchup" && f.present));
  assert.ok(holistic!.factors.some((f) => f.key === "simulation" && f.present));
});

test("minimalPropHolisticForPick always returns holistic for sim-graded props", () => {
  const holistic = minimalPropHolisticForPick({
    game: "Rockies @ Giants",
    market: "Strikeouts",
    pick: "Trevor McDonald Over 4.5 Strikeouts",
    odds: 135,
    isProp: true,
    player: "Trevor McDonald",
    propSide: "Over",
    propLine: 4.5,
    sport: "mlb",
    finalAiScore: {
      composite: 6.1,
      grade: "B-",
      confidencePct: 58,
      edgePct: 2,
      simHit: 0.54,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: 6.1,
        grade: "B-",
        confidencePct: 58,
        edgePct: 2,
        scores: {
          matchup: null,
          trend: null,
          lineValue: 6.5,
          injury: null,
          lineShopping: 6.2,
          simulation: 6.4,
        },
      },
    },
  });
  assert.ok(holistic);
  const labels = holistic!.factors.filter((f) => f.applicable).map((f) => f.key);
  assert.equal(new Set(labels).size, labels.length, "holistic factor keys must be unique");
  assert.ok(holistic!.factors.some((f) => f.key === "sportsbookValue" && f.present));
  assert.ok(holistic!.factors.some((f) => f.key === "simulation" && f.present));
});

test("buildCoachCardHolistic exposes EV/sim/match/form/injury/market strip without Line labels", () => {
  const holistic = buildCoachCardHolistic({
    game: "Fever @ Aces",
    market: "Assists",
    pick: "Aliyah Boston Under 2.5 Assists",
    odds: 134,
    isProp: true,
    player: "Aliyah Boston",
    propSide: "Under",
    propLine: 2.5,
    sport: "wnba",
    finalAiScore: {
      composite: 7.2,
      grade: "B+",
      confidencePct: 62,
      edgePct: 3.1,
      simHit: 0.56,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: 7.2,
        grade: "B+",
        confidencePct: 62,
        edgePct: 3.1,
        scores: {
          matchup: 7.4,
          trend: 6.8,
          lineValue: 7.1,
          injury: 6.5,
          lineShopping: 6.9,
          simulation: 7.3,
        },
      },
      propHolistic: buildPropHolisticScore({
        sport: "wnba",
        marketKey: "player_assists",
        propSide: "Under",
        rubricScores: {
          matchup: 7.4,
          trend: 6.8,
          lineValue: 7.1,
          injury: 6.5,
          lineShopping: 6.9,
          simulation: 7.3,
        },
        edgePct: 3.1,
        simHit: 0.56,
        vsOpponentGames: 2,
      }),
    },
  });
  assert.ok(holistic);
  const keys = holistic!.factors.map((f) => f.key);
  assert.deepEqual(keys, [
    "sportsbookValue",
    "simulation",
    "matchup",
    "recentForm",
    "injury",
    "lineMovement",
  ]);
  assert.ok(!holistic!.factors.some((f) => /line/i.test(f.label) && f.label !== "Market Efficiency"));
  assert.ok(holistic!.factors.some((f) => f.key === "matchup" && f.present));
  assert.ok(holistic!.factors.some((f) => f.key === "recentForm" && f.present));
});
