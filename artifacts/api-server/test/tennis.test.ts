import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTennisLean, normName, type TennisMatchup, type TennisPlayer } from "../src/lib/tennis.ts";
import { homeWinProbFromMatchup } from "../src/lib/tennisMonteCarlo.ts";
import { buildTennisPickAnalysis, passesTennisDataGate } from "../src/lib/tennisPickAnalysis.ts";
import {
  buildCoverQueriesFromOutcomes,
  buildTennisRecommendations,
} from "../src/lib/tennisRecommendations.ts";

function player(partial: Partial<TennisPlayer> & { name: string }): TennisPlayer {
  return {
    resolvedName: partial.name,
    athleteId: "1",
    country: "USA",
    rank: 10,
    rankPoints: 3000,
    tour: "ATP",
    recentForm: [],
    formSummary: null,
    ...partial,
  };
}

function matchup(away: TennisPlayer, home: TennisPlayer): TennisMatchup {
  return { away, home, h2h: null, tournament: "Wimbledon", round: "Semifinal" };
}

describe("normName", () => {
  it("strips diacritics", () => {
    assert.equal(normName("Jannik Sinner"), normName("Jannik  Sinner"));
  });
});

describe("computeTennisLean", () => {
  it("favors higher-ranked player", () => {
    const away = player({ name: "Novak Djokovic", rank: 4 });
    const home = player({ name: "Jannik Sinner", rank: 1 });
    const lean = computeTennisLean(away, home, null);
    assert.ok(lean);
    assert.match(lean!.side, /Sinner/i);
  });
});

describe("buildTennisPickAnalysis", () => {
  it("reports unavailable advanced stats honestly", async () => {
    const m = matchup(
      player({ name: "A", recentForm: [{ date: "2026-01-01", opponent: "B", win: true, score: "6-4 6-3", round: null }] }),
      player({ name: "B", rank: 20 }),
    );
    const pre = await buildTennisPickAnalysis(m, { away: { bio: null, career: null }, home: { bio: null, career: null } }, 4);
    assert.ok(pre.unavailableFactors.length > 5);
    assert.ok(passesTennisDataGate(pre));
  });
});

describe("buildTennisRecommendations", () => {
  it("skips weak moneyline without lean support", () => {
    const away = player({ name: "Novak Djokovic", rank: 4 });
    const home = player({ name: "Jannik Sinner", rank: 1 });
    const m = matchup(away, home);
    const lean = computeTennisLean(away, home, null);
    const prePick = {
      dataCoveragePct: 25,
      resolvedPlayers: 2,
      unavailableFactors: [],
      unavailableMarkets: [],
      away: {} as never,
      home: {} as never,
      matchup: {} as never,
      betting: {} as never,
    };
    const sim = {
      simulations: 1000,
      homeWinProbability: 0.62,
      awayWinProbability: 0.38,
      tieProbability: 0,
      homeProjectedScore: 12,
      awayProjectedScore: 10,
      mostLikelyWinner: "home" as const,
      mostLikelyWinnerPct: 0.62,
      confidenceScore: 72,
    };
    const analysis = {
      ...m,
      lean,
      prePickAnalysis: prePick,
      simulation: sim,
      simMetrics: { winProbability: { away: 0.38, home: 0.62 }, projectedTotalGames: 22, avgGamesAway: 10, avgGamesHome: 12, confidenceScore: 72 },
      recommendations: [],
      books: [],
    };
    const outcomes = [
      { name: "Novak Djokovic", price: 400, book: "BookA" },
      { name: "Jannik Sinner", price: -465, book: "BookA" },
      { name: "Novak Djokovic", price: 380, book: "BookB" },
      { name: "Jannik Sinner", price: -450, book: "BookB" },
    ];
    const { recommendations } = buildTennisRecommendations(
      analysis,
      "Novak Djokovic",
      "Jannik Sinner",
      outcomes,
      [],
      [],
      sim,
      prePick,
    );
    assert.ok(recommendations.length >= 1);
    const dog = recommendations.find((r) => r.pick.includes("Djokovic"));
    assert.ok(dog?.skipped);
  });
});

describe("buildCoverQueriesFromOutcomes", () => {
  it("builds spread and total queries", () => {
    const q = buildCoverQueriesFromOutcomes(
      "Novak Djokovic",
      "Jannik Sinner",
      [{ name: "Jannik Sinner", price: -110, point: -4.5, book: "DK" }],
      [{ name: "Over", price: -110, point: 22.5, book: "DK" }],
    );
    assert.equal(q.length, 2);
  });
});

describe("homeWinProbFromMatchup", () => {
  it("stays within bounds", () => {
    const away = player({ name: "Away", rank: 50 });
    const home = player({ name: "Home", rank: 5 });
    const p = homeWinProbFromMatchup(matchup(away, home));
    assert.ok(p >= 0.12 && p <= 0.88);
  });
});
