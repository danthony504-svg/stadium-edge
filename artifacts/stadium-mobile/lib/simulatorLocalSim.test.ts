import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_PROP_SIM_MIN_SAMPLE,
  localPropSimulation,
  mergePropSimWithLocal,
} from "./simulatorLocalSim.ts";

test("LOCAL_PROP_SIM_MIN_SAMPLE matches props-only 2-game early season", () => {
  assert.equal(LOCAL_PROP_SIM_MIN_SAMPLE, 2);
});

test("phone Pat Bryant SAMPLE=2: local sim fills hit / median / conf (not dashes)", () => {
  // Prop detail showed PROJECTION 21.0 + HIT RATE 50% but SIM HIT / PROJECTED
  // STAT / SIM CONF as "—" because localPropSimulation required 3 games.
  const hist = {
    recent: [
      { stats: { receivingYards: "32" } },
      { stats: { receivingYards: "10" } },
    ],
  };
  const local = localPropSimulation(hist, {
    player: "Pat Bryant",
    market: "player_reception_yds",
    line: 26.5,
    side: "Over",
  });
  assert.ok(local);
  assert.equal(local!.sampleGames, 2);
  assert.ok(local!.hitProbability != null, "2-game sample must grade hit %");
  assert.equal(local!.hitProbability, 0.5);
  assert.ok(local!.mostLikelyLine != null, "median must fill PROJECTED STAT");
  assert.ok(local!.confidenceScore != null, "SIM CONF must not be dash");
});

test("mergePropSimWithLocal: null server + 2-game local fills prop card tiles", () => {
  const local = localPropSimulation(
    {
      recent: [
        { stats: { receivingYards: "40" } },
        { stats: { receivingYards: "15" } },
      ],
    },
    {
      player: "Pat Bryant",
      market: "player_reception_yds",
      line: 26.5,
      side: "Over",
    },
  );
  const merged = mergePropSimWithLocal(null, local);
  assert.ok(merged);
  assert.equal(merged!.hitProbability, 0.5);
  assert.ok(merged!.mostLikelyLine != null);
  assert.ok(merged!.confidenceScore != null);
});

test("1-game sample still returns null hit (below min)", () => {
  const local = localPropSimulation(
    { recent: [{ stats: { receivingYards: "40" } }] },
    {
      player: "Rookie",
      market: "player_reception_yds",
      line: 26.5,
      side: "Over",
    },
  );
  assert.ok(local);
  assert.equal(local!.sampleGames, 1);
  assert.equal(local!.hitProbability, null);
});

test("rare HR 0/N sample does not invent a 2% local sim floor", () => {
  const local = localPropSimulation(
    {
      recent: Array.from({ length: 10 }, () => ({ stats: { HR: "0" } })),
    },
    {
      player: "Dustin Harris",
      market: "batter_home_runs",
      line: 1.5,
      side: "Over",
    },
  );
  assert.ok(local);
  assert.equal(local!.hitProbability, null);
});

test("rare HR Over 0.5 vs 1.5 are threshold-specific in local sim", () => {
  const hist = {
    recent: [
      ...Array.from({ length: 9 }, () => ({ stats: { HR: "0" } })),
      { stats: { HR: "2" } },
    ],
  };
  const over05 = localPropSimulation(hist, {
    player: "Jake Cronenworth",
    market: "batter_home_runs",
    line: 0.5,
    side: "Over",
  });
  const over15 = localPropSimulation(hist, {
    player: "Jake Cronenworth",
    market: "batter_home_runs",
    line: 1.5,
    side: "Over",
  });
  assert.ok(over05?.hitProbability != null && over15?.hitProbability != null);
  assert.ok(over05!.hitProbability! > over15!.hitProbability!);
});

test("milestone fallback cannot invent rare-event probabilities from thin or one-sided logs", () => {
  const history = (values:number[]) => ({labels:["PTS","REB","AST","STL","BLK"],recent:values.map(v=>({stats:{PTS:"20",REB:v?"10":"9",AST:v?"10":"9",STL:"0",BLK:"0"}}))});
  for (const market of ["player_double_double","player_triple_double"]) {
    const args={player:"Player",market,line:0.5,side:"Over" as const};
    for (const values of [[0,0,0],Array(10).fill(0),Array(10).fill(1)]) assert.equal(localPropSimulation(history(values),args),null);
    const mixed=[1,0,1,0,0,1,0,0,1,0];
    const yes=localPropSimulation(history(mixed),args)!;
    const no=localPropSimulation(history(mixed),{...args,side:"Under"})!;
    assert.ok(Math.abs(yes.hitProbability!-0.4)<1e-12);
    assert.ok(Math.abs(yes.hitProbability!+no.hitProbability!-1)<1e-12);
  }
});
