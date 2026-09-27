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
