import assert from "node:assert/strict";
import { test } from "node:test";

import type { FightFighter } from "./api.ts";
import {
  classifyFighterStyle,
  computeClientFightLean,
  enrichFightAnalysisWithClientSim,
  finalizeClientFightAnalysis,
  runClientFightMonteCarlo,
  simMetricsFromFightResult,
} from "./ufcClientSim.ts";

function fighter(partial: Partial<FightFighter> & { name: string }): FightFighter {
  return {
    name: partial.name,
    resolvedName: partial.resolvedName ?? partial.name,
    athleteId: partial.athleteId ?? null,
    weightClass: partial.weightClass ?? null,
    record: partial.record ?? null,
    stats: partial.stats ?? {
      strikeAccuracy: null,
      strikeLPM: null,
      takedownAccuracy: null,
      takedownAvg: null,
      submissionAvg: null,
      finishPct: null,
      decisionPct: null,
    },
    profile: partial.profile ?? {
      age: null,
      heightIn: null,
      displayHeight: null,
      reachIn: null,
      displayReach: null,
      stance: null,
      citizenship: null,
    },
    methods: partial.methods ?? {
      koWins: null,
      tkoWins: null,
      subWins: null,
      decisionWins: null,
    },
    style: partial.style ?? null,
    dataSources: partial.dataSources ?? ["sherdog"],
    recentForm: partial.recentForm ?? [],
  };
}

test("runClientFightMonteCarlo returns 10k sim with method rates from Sherdog methods", () => {
  const away = fighter({
    name: "Mate Kertesz",
    record: { wins: 2, losses: 1, draws: 0, winPct: 66.7 },
    methods: { koWins: 5, tkoWins: null, subWins: 1, decisionWins: 9 },
    stats: { strikeAccuracy: null, strikeLPM: null, takedownAccuracy: null, takedownAvg: null, submissionAvg: null, finishPct: 33.3, decisionPct: 60 },
  });
  const home = fighter({
    name: "Cihad Akipa",
    record: { wins: 0, losses: 1, draws: 0, winPct: 0 },
    methods: { koWins: 5, tkoWins: null, subWins: 2, decisionWins: 4 },
  });
  const sim = runClientFightMonteCarlo({
    away,
    home,
    lean: { side: "Mate Kertesz", edge: 2, reasons: ["record edge"] },
    simulations: 2000,
  });
  assert.equal(sim.simulations, 2000);
  assert.ok(sim.awayWinProbability > sim.homeWinProbability);
  assert.ok(sim.methodRates);
  const metrics = simMetricsFromFightResult(sim);
  assert.ok(metrics.winProbability.away > 0.5);
});

test("enrichFightAnalysisWithClientSim fills missing simulation block", () => {
  const away = fighter({
    name: "A",
    record: { wins: 3, losses: 0, draws: 0, winPct: 100 },
    methods: { koWins: 2, tkoWins: null, subWins: 0, decisionWins: 1 },
  });
  const home = fighter({ name: "B", record: { wins: 1, losses: 2, draws: 0, winPct: 33.3 } });
  const out = finalizeClientFightAnalysis({
    away,
    home,
    lean: null,
    comparison: { reachAdvantageIn: null, reachAdvantageFighter: null, styleMatchup: null, unavailable: [] },
    simulation: {
      simulations: 0,
      awayWinProbability: 0.5,
      homeWinProbability: 0.5,
      mostLikelyWinner: "home",
      mostLikelyWinnerPct: 0.5,
      confidenceScore: 0,
      methodRates: null,
      roundWinPct: null,
    },
    prePickAnalysis: {
      resolvedFighters: 2,
      dataCoveragePct: 50,
      unavailableFactors: [],
      advantages: {
        styleMatchup: { value: null, available: false },
        reachAdvantage: { value: null, available: false },
        ageAdvantage: { value: null, available: false },
      },
      unavailableMarkets: [],
    },
    simMetrics: {
      winProbability: { away: 0.5, home: 0.5 },
      finishProbability: { away: 0, home: 0 },
      koProbability: { away: 0, home: 0 },
      submissionProbability: { away: 0, home: 0 },
      decisionProbability: { away: 0, home: 0 },
      roundWinPct: null,
    },
    recommendations: [],
    books: [],
  });
  assert.ok(out.simulation.simulations > 0);
  assert.ok(out.simMetrics.winProbability.away !== 0.5 || out.simMetrics.winProbability.home !== 0.5);
});

test("computeClientFightLean from Sherdog records", () => {
  const away = fighter({
    name: "Aaron Aby",
    record: { wins: 14, losses: 8, draws: 1, winPct: 63 },
  });
  const home = fighter({
    name: "Zoran Milic",
    record: { wins: 6, losses: 2, draws: 0, winPct: 75 },
  });
  const lean = computeClientFightLean(away, home);
  assert.ok(lean);
  assert.equal(lean!.side, "Zoran Milic");
});

test("classifyFighterStyle from Sherdog method split", () => {
  const subHeavy = fighter({
    name: "G",
    record: { wins: 4, losses: 0, draws: 0, winPct: 100 },
    methods: { koWins: 0, tkoWins: null, subWins: 3, decisionWins: 1 },
  });
  assert.equal(classifyFighterStyle(subHeavy), "grappler");

  const koHeavy = fighter({
    name: "M",
    record: { wins: 6, losses: 2, draws: 0, winPct: 75 },
    methods: { koWins: 3, tkoWins: null, subWins: 0, decisionWins: 3 },
  });
  assert.equal(classifyFighterStyle(koHeavy), "striker");
});
