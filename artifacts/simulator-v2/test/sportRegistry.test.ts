import assert from "node:assert/strict";
import { test } from "node:test";
import { SimV2SportIdSchema } from "../src/schemas/sport.js";
import {
  SPORT_COVERAGE_REGISTRY,
  coverageForSport,
  sportsMissingScoringModel,
} from "../src/models/sportRegistry.js";
import { isMarketFamilySupported } from "../src/validation/unsupported.js";

test("registry covers every SimV2SportId exactly once", () => {
  const ids = SimV2SportIdSchema.options;
  assert.equal(SPORT_COVERAGE_REGISTRY.length, ids.length);
  for (const id of ids) {
    assert.ok(coverageForSport(id), `missing coverage row for ${id}`);
  }
});

test("football + basketball scaffolds registered; others empty", () => {
  const active = new Set(["nfl", "ncaaf", "nba", "wnba", "ncaab"]);
  for (const row of SPORT_COVERAGE_REGISTRY) {
    if (active.has(row.sport)) {
      assert.ok(row.scoringModelId, row.sport);
      assert.ok(row.v2SettleFamilies.length > 0, row.sport);
    } else {
      assert.equal(row.scoringModelId, null, row.sport);
    }
  }
  assert.ok(sportsMissingScoringModel().includes("nhl"));
  assert.ok(sportsMissingScoringModel().includes("mlb"));
});

test("non-scaffolded sports stay fail-closed; basketball shadow settle allowed", () => {
  assert.equal(isMarketFamilySupported("nba", "player_prop").supported, true);
  assert.equal(isMarketFamilySupported("wnba", "total").supported, true);
  for (const sport of ["nhl", "mlb", "soccer", "tennis", "ufc", "boxing", "cricket"] as const) {
    assert.equal(isMarketFamilySupported(sport, "ml").supported, false);
  }
});
