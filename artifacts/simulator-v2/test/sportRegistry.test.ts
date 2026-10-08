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

test("football + MLB scaffolds registered; others empty", () => {
  for (const row of SPORT_COVERAGE_REGISTRY) {
    if (row.sport === "nfl" || row.sport === "ncaaf" || row.sport === "mlb") {
      assert.ok(row.scoringModelId, row.sport);
      assert.ok(row.v2SettleFamilies.length > 0, row.sport);
    } else {
      assert.equal(row.scoringModelId, null, row.sport);
    }
  }
  assert.ok(sportsMissingScoringModel().includes("nhl"));
});

test("non-scaffolded sports stay fail-closed; MLB shadow settle allowed", () => {
  assert.equal(isMarketFamilySupported("mlb", "player_prop").supported, true);
  for (const sport of ["nhl", "nba", "soccer", "tennis", "ufc", "boxing", "cricket"] as const) {
    assert.equal(isMarketFamilySupported(sport, "ml").supported, false);
  }
});
