import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFighterStyle,
  computeFightLean,
  normFighter,
} from "../src/lib/ufc.ts";
import { mergeFighters, fighterNeedsSupplement } from "../src/lib/mmaSupplement.ts";
import type { Fighter } from "../src/lib/ufc.ts";
import { awayWinProbFromFight, runFightMonteCarlo } from "../src/lib/ufcMonteCarlo.ts";
import { buildFightRecommendations } from "../src/lib/fightRecommendations.ts";
import { buildFightPickAnalysis } from "../src/lib/fightPickAnalysis.ts";

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
    dataSources: ["espn"],
    recentForm: [],
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

describe("mmaSupplement", () => {
  it("fighterNeedsSupplement when ESPN has record but no strike stats", () => {
    const thin = fighter({
      name: "Aaron Aby",
      athleteId: "4083014",
      stats: {
        strikeAccuracy: null,
        strikeLPM: null,
        takedownAccuracy: null,
        takedownAvg: null,
        submissionAvg: null,
        finishPct: null,
        decisionPct: null,
      },
      methods: {
        koWins: null,
        tkoWins: 1,
        subWins: 5,
        decisionWins: null,
        koLosses: null,
        tkoLosses: 2,
        subLosses: 0,
      },
      recentForm: [],
    });
    assert.equal(fighterNeedsSupplement(thin), true);
  });
});

describe("classifyFighterStyle", () => {
  it("labels high-volume striker", () => {
    const f = fighter({
      name: "Striker",
      style: null,
      stats: {
        strikeAccuracy: 55,
        strikeLPM: 5,
        takedownAccuracy: null,
        takedownAvg: null,
        submissionAvg: null,
        finishPct: 70,
        decisionPct: 20,
      },
      methods: {
        koWins: 8,
        tkoWins: 2,
        subWins: 0,
        decisionWins: 0,
        koLosses: null,
        tkoLosses: null,
        subLosses: null,
      },
    });
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
    const comparison = { reachAdvantageIn: null, reachAdvantageFighter: null, styleMatchup: null, unavailable: [] };
    const prePick = buildFightPickAnalysis(away, home, comparison, 4);
    const analysis = {
      away,
      home,
      lean,
      comparison,
      simulation: runFightMonteCarlo({ away, home, lean }, 500),
      prePickAnalysis: prePick,
      simMetrics: { winProbability: { away: 0.6, home: 0.4 }, finishProbability: { away: 0.3, home: 0.2 }, koProbability: { away: 0.2, home: 0.1 }, submissionProbability: { away: 0.05, home: 0.05 }, decisionProbability: { away: 0.35, home: 0.25 }, roundWinPct: null },
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
      prePick,
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

describe("mmaSupplement mergeFighters", () => {
  it("fills Sherdog gaps when ESPN profile is thin", () => {
    const espn: Fighter = fighter({
      name: "Kamil Milic",
      athleteId: "espn-1",
      record: null,
      dataSources: ["espn"],
      recentForm: [],
      stats: {
        strikeAccuracy: null,
        strikeLPM: null,
        takedownAccuracy: null,
        takedownAvg: null,
        submissionAvg: null,
        finishPct: null,
        decisionPct: null,
      },
      profile: {
        age: null,
        heightIn: null,
        displayHeight: null,
        reachIn: null,
        displayReach: null,
        stance: null,
        citizenship: null,
      },
    });
    const sherdog: Fighter = fighter({
      name: "Kamil Milic",
      athleteId: null,
      record: { wins: 6, losses: 2, draws: 0, winPct: 75 },
      dataSources: ["sherdog"],
      recentForm: [{ result: "W", opponent: "Test Op", date: "2025-01-01", method: "TKO" }],
      profile: {
        age: 28,
        heightIn: 66,
        displayHeight: `5'6"`,
        reachIn: 68,
        displayReach: `68"`,
        stance: "Orthodox",
        citizenship: "Sweden",
      },
    });
    assert.equal(fighterNeedsSupplement(espn), true);
    const merged = mergeFighters(espn, sherdog);
    assert.deepEqual(merged.dataSources, ["espn", "sherdog"]);
    assert.equal(merged.record?.wins, 6);
    assert.equal(merged.profile.citizenship, "Sweden");
    assert.equal(merged.recentForm.length, 1);
  });

  it("requests supplement when ESPN has stats but profile bio is empty", () => {
    const espn = fighter({
      name: "Conor McGregor",
      profile: {
        age: null,
        heightIn: null,
        displayHeight: null,
        reachIn: null,
        displayReach: null,
        stance: null,
        citizenship: null,
      },
      methods: {
        koWins: null,
        tkoWins: null,
        subWins: null,
        decisionWins: null,
        koLosses: null,
        tkoLosses: null,
        subLosses: null,
      },
    });
    assert.equal(fighterNeedsSupplement(espn), true);
  });
});
