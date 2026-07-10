import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFighterStyle,
  computeFightLean,
  normFighter,
  type Fighter,
} from "../src/lib/ufc.ts";
import { awayWinProbFromFight, runFightMonteCarlo } from "../src/lib/ufcMonteCarlo.ts";
import { buildFightRecommendations } from "../src/lib/fightRecommendations.ts";

function fighter(partial: Partial<Fighter> & { name: string }): Fighter {
  return {
    resolvedName: partial.name,
    athleteId: "1",
    weightClass: "Lightweight",
    record: { wins: 10, losses: 2, draws: 0, winPct: 83.3 },
    stats: {
      strikeAccuracy: 50,
      strikeLPM: 4.5,
      takedownAccuracy: 40,
      takedownAvg: 2,
      submissionAvg: 0.5,
      finishPct: 60,
      decisionPct: 20,
    },
    profile: {
      age: 28,
      heightIn: 70,
      displayHeight: "5' 10\"",
      reachIn: 72,
      displayReach: '72"',
      stance: "Orthodox",
      citizenship: "USA",
    },
    methods: {
      koWins: 3,
      tkoWins: 2,
      subWins: 2,
      decisionWins: 3,
      koLosses: null,
      tkoLosses: 1,
      subLosses: null,
    },
    style: null,
    ...partial,
  };
}

describe("normFighter", () => {
  it("strips diacritics and collapses spacing", () => {
    assert.equal(normFighter("Joandérson  Brito"), normFighter("Joanderson Brito"));
  });
});

describe("computeFightLean", () => {
  it("returns null when no comparable stats", () => {
    const a = fighter({ name: "A", record: null, stats: { strikeAccuracy: null, strikeLPM: null, takedownAccuracy: null, takedownAvg: null, submissionAvg: null, finishPct: null, decisionPct: null } });
    const h = fighter({ name: "B", record: null, stats: { strikeAccuracy: null, strikeLPM: null, takedownAccuracy: null, takedownAvg: null, submissionAvg: null, finishPct: null, decisionPct: null } });
    assert.equal(computeFightLean(a, h), null);
  });

  it("favors fighter with better record and reach", () => {
    const away = fighter({ name: "Away", record: { wins: 15, losses: 2, draws: 0, winPct: 88 } });
    const home = fighter({
      name: "Home",
      record: { wins: 8, losses: 5, draws: 0, winPct: 61.5 },
      profile: { ...fighter({ name: "Home" }).profile, reachIn: 68 },
    });
    const lean = computeFightLean(away, home);
    assert.ok(lean);
    assert.match(lean!.side, /Away/i);
    assert.ok(lean!.edge >= 0.3);
  });
});

describe("classifyFighterStyle", () => {
  it("labels high-volume striker", () => {
    const f = fighter({ name: "Striker", style: null });
    f.style = classifyFighterStyle(f);
    assert.equal(f.style, "striker");
  });
});

describe("runFightMonteCarlo", () => {
  it("runs 10k draws and returns probabilities", () => {
    const away = fighter({ name: "Away" });
    const home = fighter({ name: "Home", record: { wins: 5, losses: 8, draws: 0, winPct: 38.5 } });
    const lean = computeFightLean(away, home);
    const sim = runFightMonteCarlo(
      { away, home, lean },
      1000,
    );
    assert.equal(sim.simulations, 1000);
    assert.ok(sim.awayWinProbability > sim.homeWinProbability);
    assert.ok(sim.confidenceScore >= 5 && sim.confidenceScore <= 95);
  });
});

describe("buildFightRecommendations", () => {
  it("skips weak plus-money dog without lean support", () => {
    const away = fighter({ name: "Mick Stanton" });
    const home = fighter({ name: "Kamil Oniszczuk" });
    const lean = computeFightLean(away, home);
    const analysis = {
      away,
      home,
      lean,
      comparison: { reachAdvantageIn: null, reachAdvantageFighter: null, styleMatchup: null, unavailable: [] },
      simulation: runFightMonteCarlo({ away, home, lean }, 500),
      recommendations: [],
      books: [],
    };
    const outcomes = [
      { name: "Mick Stanton", price: 225, book: "BookA" },
      { name: "Kamil Oniszczuk", price: -350, book: "BookA" },
      { name: "Mick Stanton", price: 210, book: "BookB" },
      { name: "Kamil Oniszczuk", price: -340, book: "BookB" },
    ];
    const { recommendations } = buildFightRecommendations(
      analysis,
      "Mick Stanton",
      "Kamil Oniszczuk",
      outcomes,
      analysis.simulation,
    );
    assert.ok(recommendations.length >= 1);
    const fav = recommendations.find((r) => r.pick.includes("Oniszczuk"));
    assert.ok(fav);
  });
});

describe("awayWinProbFromFight", () => {
  it("stays within bounds", () => {
    const away = fighter({ name: "Away" });
    const home = fighter({ name: "Home" });
    const p = awayWinProbFromFight({ away, home, lean: null });
    assert.ok(p >= 0.12 && p <= 0.88);
  });
});
