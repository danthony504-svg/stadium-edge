/**
 * Regression: two-team game must never share the first prop's opponent
 * defenseIndex. Home rush Over vs weak away D, and away pass Over vs stingy
 * home D, get opposite-direction indices. ALT rungs share the player's
 * opponent key; replacement scoring uses the same opponent-scoped set.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type { FootballOppDefenseSlice } from "./footballRushDefense.ts";
import {
  buildPropProjectionTrace,
  classifyPropContextChannel,
  defenseIndexByFamilyFromPack,
  gameLabelFromPropOpponentDefenseKey,
  propOpponentDefenseKey,
  proposeFootballWeatherImpact,
  shouldApplyKeyInjuryMeanTilt,
  shouldApplyPostSimOppDefenseTilt,
} from "./propContextPipeline.ts";

const GAME = "Kansas City Chiefs @ Buffalo Bills";
const KC_ID = "12";
const BUF_ID = "2";

const bufWeakRush: FootballOppDefenseSlice = {
  rush: {
    rushingYardsAllowedPerGame: 150,
    yardsPerRushAllowed: 4.9,
    sampleSize: 8,
    stuffs: null,
    teamName: "Bills",
  },
  pass: {
    // > NFL pass_yds baseline (220) so bug-path inheritance clearly boosts overs
    passingYardsAllowedPerGame: 280,
    yardsPerPassAllowed: 7.8,
    sampleSize: 8,
    teamName: "Bills",
  },
  teamName: "Bills",
  pointsAgainst: 26,
};

const kcStingyPass: FootballOppDefenseSlice = {
  rush: {
    rushingYardsAllowedPerGame: 95,
    yardsPerRushAllowed: 3.6,
    sampleSize: 9,
    stuffs: null,
    teamName: "Chiefs",
  },
  pass: {
    passingYardsAllowedPerGame: 160,
    yardsPerPassAllowed: 5.5,
    sampleSize: 9,
    teamName: "Chiefs",
  },
  teamName: "Chiefs",
  pointsAgainst: 17,
};

test("propOpponentDefenseKey distinguishes both sides of one game", () => {
  const homePlayerOpp = propOpponentDefenseKey(GAME, KC_ID); // Bills player faces KC
  const awayPlayerOpp = propOpponentDefenseKey(GAME, BUF_ID); // Chiefs player faces BUF
  assert.ok(homePlayerOpp);
  assert.ok(awayPlayerOpp);
  assert.notEqual(homePlayerOpp, awayPlayerOpp);
  assert.equal(gameLabelFromPropOpponentDefenseKey(homePlayerOpp), GAME);
  assert.equal(propOpponentDefenseKey(GAME, null), null);
  assert.equal(propOpponentDefenseKey("", BUF_ID), null);
});

test("two-team: home vs away never inherit the first prop's opponent index", () => {
  // Simulate pre-fix bug: first ranked prop is a Chiefs rusher → key by game only
  // stored BUF weak rush for the whole game. Bills WR would wrongly get BUF's index.
  const firstPropOppId = BUF_ID; // Chiefs @ Bills → Chiefs face BUF
  const secondPropOppId = KC_ID; // Bills player faces KC

  const byOpponent: Record<string, Record<string, number> | null> = {};
  for (const [oppId, pack] of [
    [firstPropOppId, bufWeakRush],
    [secondPropOppId, kcStingyPass],
  ] as const) {
    const key = propOpponentDefenseKey(GAME, oppId)!;
    byOpponent[key] = defenseIndexByFamilyFromPack("nfl", pack);
  }

  const chiefsRushKey = propOpponentDefenseKey(GAME, BUF_ID)!;
  const billsPassKey = propOpponentDefenseKey(GAME, KC_ID)!;
  const chiefsRushIdx = byOpponent[chiefsRushKey]!;
  const billsPassIdx = byOpponent[billsPassKey]!;

  assert.ok(chiefsRushIdx.rush_yds! > 1, "Chiefs RB vs weak BUF rush D → boost");
  assert.ok(billsPassIdx.pass_yds! < 1, "Bills WR vs stingy KC pass D → suppress");
  assert.notEqual(chiefsRushIdx.rush_yds, billsPassIdx.pass_yds);

  // Pre-fix: single game key would have overwritten with whichever prop ranked first.
  const legacyGameOnly = defenseIndexByFamilyFromPack("nfl", bufWeakRush)!;
  assert.notEqual(
    legacyGameOnly.pass_yds,
    billsPassIdx.pass_yds,
    "game-only map cannot represent KC pass D for Bills props",
  );
});

test("ALT rungs and replacement scoring retain the same opponent defense key", () => {
  const mainKey = propOpponentDefenseKey(GAME, BUF_ID)!;
  // ALT rungs share player/team → same opponent id → same key.
  const altKeys = [59.5, 69.5, 79.5].map(() => propOpponentDefenseKey(GAME, BUF_ID)!);
  for (const k of altKeys) assert.equal(k, mainKey);
  const fam = defenseIndexByFamilyFromPack("nfl", bufWeakRush)!;
  const projectionKeys = new Set([mainKey]);
  // Replacement / ALT scoring: same key → skip post-sim tilt (projection owns D).
  assert.equal(
    shouldApplyPostSimOppDefenseTilt({
      projectionUsedDefenseIndex: projectionKeys.has(altKeys[1]!),
    }),
    false,
  );
  // Opposite side must still apply post-sim tilt if their key was never projected.
  const otherKey = propOpponentDefenseKey(GAME, KC_ID)!;
  assert.equal(
    shouldApplyPostSimOppDefenseTilt({
      projectionUsedDefenseIndex: projectionKeys.has(otherKey),
    }),
    true,
  );
  // Replacement leg on the opposite side uses its own key + pack (never mainKey's fam).
  const replacementFam = defenseIndexByFamilyFromPack("nfl", kcStingyPass)!;
  assert.notEqual(fam.pass_yds, replacementFam.pass_yds);
  assert.ok(replacementFam.pass_yds! < 1);
});

test("before/after projection traces: both sides get correct direction", () => {
  const chiefsVsBuf = defenseIndexByFamilyFromPack("nfl", bufWeakRush)!;
  const billsVsKc = defenseIndexByFamilyFromPack("nfl", kcStingyPass)!;

  const beforeShared = buildPropProjectionTrace({
    sport: "nfl",
    market: "player_reception_yds",
    side: "Over",
    line: 64.5,
    baselineMean: 60,
    // Bug path: Bills WR wrongly inherits BUF rush/pass (weak) from first prop.
    adjustments: [
      {
        name: "opp_defense",
        source: "BUG game-scoped first-prop pack",
        factor: chiefsVsBuf.pass_yds ?? chiefsVsBuf.rush_yds!,
      },
    ],
  });

  const afterCorrect = buildPropProjectionTrace({
    sport: "nfl",
    market: "player_reception_yds",
    side: "Over",
    line: 64.5,
    baselineMean: 60,
    adjustments: [
      {
        name: "opp_defense",
        source: "propOpponentDefenseKey → KC pack",
        factor: billsVsKc.pass_yds!,
      },
    ],
  });

  assert.ok(beforeShared.finalMean! > 60, "bug path boosted vs weak BUF");
  assert.ok(afterCorrect.finalMean! < 60, "fixed path suppressed vs stingy KC");
  assert.ok(afterCorrect.finalMean! < beforeShared.finalMean!);
});

test("cold/warm: two-team key resolve stays sync sub-ms", () => {
  const cold = performance.now();
  for (let i = 0; i < 1000; i++) {
    const k1 = propOpponentDefenseKey(GAME, BUF_ID)!;
    const k2 = propOpponentDefenseKey(GAME, KC_ID)!;
    defenseIndexByFamilyFromPack("nfl", bufWeakRush);
    defenseIndexByFamilyFromPack("nfl", kcStingyPass);
    void k1;
    void k2;
  }
  const coldMs = performance.now() - cold;
  const warm = performance.now();
  for (let i = 0; i < 1000; i++) {
    propOpponentDefenseKey(GAME, BUF_ID);
    propOpponentDefenseKey(GAME, KC_ID);
    defenseIndexByFamilyFromPack("nfl", bufWeakRush);
    defenseIndexByFamilyFromPack("nfl", kcStingyPass);
  }
  const warmMs = performance.now() - warm;
  assert.ok(coldMs < 80, `cold ${coldMs}ms`);
  assert.ok(warmMs < 80, `warm ${warmMs}ms`);
});

test("channel split: defenseIndex is distribution; holistic tendency is ranking", () => {
  assert.equal(
    classifyPropContextChannel({ name: "opponent_defense_index" }),
    "distribution",
  );
  assert.equal(
    classifyPropContextChannel({ name: "holistic_opponent_tendency" }),
    "ranking_display",
  );
  assert.equal(
    classifyPropContextChannel({ name: "holistic_weather" }),
    "ranking_display",
  );
  assert.equal(
    classifyPropContextChannel({ name: "weather_impact" }),
    "distribution",
  );
});

test("football weather proposal: suppress outdoor; skip when vs-opp history owns matchup", () => {
  const windy = proposeFootballWeatherImpact({
    sport: "nfl",
    env: { weather: { tempF: 28, windMph: 22, precipChancePct: 40 } },
    vsOpponentGames: 0,
  });
  assert.equal(windy.apply, true);
  assert.ok(windy.weatherImpact != null && windy.weatherImpact < 0);

  const historyOwns = proposeFootballWeatherImpact({
    sport: "nfl",
    env: { weather: { tempF: 28, windMph: 22, precipChancePct: 40 } },
    vsOpponentGames: 5,
  });
  assert.equal(historyOwns.apply, false);
  assert.equal(historyOwns.reason, "vs_opponent_history_owns_matchup");

  const dome = proposeFootballWeatherImpact({
    sport: "nfl",
    env: { climateControlled: true, weather: { tempF: 28 } },
    vsOpponentGames: 0,
  });
  assert.equal(dome.apply, false);
});

test("key-injury mean tilt suppressed when Opp Shift or vs-opp history owns signal", () => {
  assert.equal(
    shouldApplyKeyInjuryMeanTilt({ opportunitySuppressOwnInjuries: true }),
    false,
  );
  assert.equal(shouldApplyKeyInjuryMeanTilt({ vsOpponentGames: 4 }), false);
  assert.equal(shouldApplyKeyInjuryMeanTilt({ vsOpponentGames: 1 }), true);
});
