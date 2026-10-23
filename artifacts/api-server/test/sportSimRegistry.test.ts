import assert from "node:assert/strict";
import { test } from "node:test";

import { runSportGameMonteCarlo, sportSimModelForSport } from "../src/lib/sportSim/registry.ts";

test("sportSimModelForSport maps each major sport", () => {
  assert.equal(sportSimModelForSport("mlb"), "mlb-inning");
  assert.equal(sportSimModelForSport("nba"), "nba-score-v2");
  assert.equal(sportSimModelForSport("wnba"), "wnba-score-v2");
  assert.equal(sportSimModelForSport("nfl"), "nfl-drive");
  assert.equal(sportSimModelForSport("nhl"), "nhl-shift");
  assert.equal(sportSimModelForSport("soccer"), "soccer-xg");
});

test("runSportGameMonteCarlo runs 10k MLB inning draws", () => {
  const result = runSportGameMonteCarlo({
    sport: "mlb",
    simulations: 10_000,
    home: { ptsFor: 5.1, ptsAgainst: 4.2, recentScores: [4, 5, 6, 5, 7] },
    away: { ptsFor: 4.4, ptsAgainst: 4.8, recentScores: [3, 4, 5, 4, 6] },
    retainOutcomes: true,
    coverQueries: [{ id: "home-ml", kind: "ml", teamSide: "home" }],
  });
  assert.ok(result);
  assert.equal(result!.simModel, "mlb-inning");
  assert.equal(result!.simulations, 10_000);
  assert.ok((result!.coverHitRates?.["home-ml"] ?? 0) > 0);
});

test("runSportGameMonteCarlo runs NBA observed-score model", () => {
  const result = runSportGameMonteCarlo({
    sport: "nba",
    simulations: 5000,
    home: { ptsFor: 114, ptsAgainst: 110, recentScores: [110, 112, 118, 109, 115] },
    away: { ptsFor: 108, ptsAgainst: 112, recentScores: [105, 111, 107, 113, 110] },
  });
  assert.ok(result);
  assert.equal(result!.simModel, "nba-score-v2");
  assert.ok(result!.homeProjectedScore > 95);
});

import { createPropSimRng } from "../src/lib/monteCarlo.ts";
import { deriveCoverHitRates } from "../src/lib/gameMonteCarlo.ts";

function seeded<T>(fn: () => T): T {
  const original = Math.random;
  Math.random = createPropSimRng(719);
  try { return fn(); } finally { Math.random = original; }
}
function team(mean: number, spread = 10) {
  return { ptsFor: mean, ptsAgainst: mean, recentScores: [mean-spread,mean,mean+spread,mean-spread,mean+spread] };
}
function score(sport: string, home = team(120), away = team(120)) {
  return seeded(() => runSportGameMonteCarlo({sport,home,away,simulations:10000,
    coverQueries:[{id:"u238",kind:"total",totalSide:"under",line:238.5}]}));
}
test("basketball scoring levels do not cancel in ratios or saturate pace caps", () => {
  for (const mean of [100,110,120,130]) {
    const result = score("nba",team(mean),team(mean))!;
    assert.ok(Math.abs(result.homeProjectedScore-mean)<0.5);
    assert.ok(Math.abs(result.awayProjectedScore-mean)<0.5);
    assert.equal(result.simulations,10000);
    assert.equal(result.outcomes!.homeScores.length,10000);
  }
  const low = score("nba",team(100),team(100))!;
  const high = score("nba",team(130),team(130))!;
  assert.ok(low.coverHitRates!.u238 > 0.9);
  assert.ok(high.coverHitRates!.u238 < 0.3);
});
test("offense and opponent defense change only the affected scoring mean", () => {
  const base = score("nba")!;
  for (const changed of [score("nba",{...team(120),ptsFor:140}),score("nba",team(120),{...team(120),ptsAgainst:140})]) {
    assert.ok(changed!.homeProjectedScore > base.homeProjectedScore+9);
    assert.equal(changed!.awayProjectedScore,base.awayProjectedScore);
  }
});
test("basketball uses league score scale, observed variance, and withholds missing history", () => {
  for (const [sport,mean] of [["wnba",80],["ncaab",70]] as const) {
    const result=score(sport,team(mean),team(mean))!;
    assert.equal(result.simModel,`${sport}-score-v2`);
    assert.ok(Math.abs(result.homeProjectedScore-mean)<0.5);
  }
  const narrow=score("nba",team(120,5),team(120,5))!;
  const wide=score("nba",team(120,40),team(120,40))!;
  const variance=(v:number[])=>{const m=v.reduce((a,b)=>a+b,0)/v.length;return v.reduce((a,b)=>a+(b-m)**2,0)/v.length;};
  assert.ok(variance(wide.outcomes!.homeScores)>variance(narrow.outcomes!.homeScores)*4);
  assert.equal(score("nba",{...team(120),ptsFor:null}),null);
  assert.equal(score("nba",{...team(120),recentScores:[120,120,120]}),null);
});
test("basketball period and race queries are unavailable, never false zero or scaled FG hits", () => {
  const outcomes={homeScores:[120,130],awayScores:[110,115]};
  const queries=[{id:"q1",kind:"spread",teamSide:"home",line:7.5,period:"q1"},{id:"race",kind:"raceTo",teamSide:"home",raceTarget:20},{id:"fg",kind:"total",totalSide:"under",line:250}] as const;
  for (const sport of ["nba","wnba","ncaab"]) {
    assert.deepEqual(deriveCoverHitRates(outcomes,[...queries],sport),{fg:1});
  }
});
