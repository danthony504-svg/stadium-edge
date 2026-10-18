/**
 * Stage 4 P1 wiring guards — shadow must not alter live seating contracts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  COACH_SIM_MIN_CONFIDENCE,
  meetsCoachSimQualityFloor,
} from "./gameSimQualityGates.ts";
import {
  VALIDATED_HISTORICAL_MODEL_ALLOWLIST,
  propProvenanceAllowsSeating,
} from "./coachPropProbabilityProvenance.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

test("Coach props-only ticket wires shadow recorder without defenseIndexByFamily on deep fetch", () => {
  const src = readFileSync(join(ROOT, "coachFootballPropsOnlyTicket.ts"), "utf8");
  assert.match(src, /recordDefenseIndexShadow/);
  assert.match(src, /isDefenseIndexShadowEnabled/);
  assert.match(src, /deepSimMeta/);
  // Live deep path must not pass defenseIndexByFamily (that is P2 seating).
  const deepCall = src.slice(
    src.indexOf("fetchPropSimulations("),
    src.indexOf("fetchPropSimulations(") + 500,
  );
  assert.doesNotMatch(deepCall, /defenseIndexByFamily/);
  assert.match(src, /never write|never writes|NEVER send defenseIndexByFamily/i);
});

test("#711 52/C+ floor still enforced", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(meetsCoachSimQualityFloor({ grade: "C+", confidencePct: 52 }), true);
  assert.equal(meetsCoachSimQualityFloor({ grade: "C+", confidencePct: 51 }), false);
  assert.equal(meetsCoachSimQualityFloor({ grade: "C", confidencePct: 60 }), false);
});

test("#773 Option C: empty historical allowlist still requires exact-market 10k", () => {
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
  // Validated-historical stamp still fails when allowlist is empty.
  const histOnly = {
    source: "validated_historical_model" as const,
    hitProbability: 0.61,
    simulations: 0,
    sport: "nfl",
    marketKey: "player_rush_yds",
    nullReason: null,
    hitReliability: 0.8,
    athleteId: "a1",
    eventId: "e1",
    side: "Over" as const,
    line: 64.5,
  };
  assert.equal(
    propProvenanceAllowsSeating(histOnly, {
      athleteId: "a1",
      eventId: "e1",
      propMarketKey: "player_rush_yds",
      propSide: "Over",
      propLine: 64.5,
    }),
    false,
  );
});
