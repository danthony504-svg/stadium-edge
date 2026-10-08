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
  const sports = SPORT_COVERAGE_REGISTRY.map((r) => r.sport);
  assert.equal(new Set(sports).size, sports.length);
});

test("only NFL/NCAAF have scoring models and v2 settle families today", () => {
  for (const row of SPORT_COVERAGE_REGISTRY) {
    if (row.sport === "nfl" || row.sport === "ncaaf") {
      assert.ok(row.scoringModelId);
      assert.ok(row.v2SettleFamilies.includes("spread"));
      assert.equal(row.propModelId, null);
    } else {
      assert.equal(row.scoringModelId, null);
      assert.deepEqual(row.v2SettleFamilies, []);
    }
  }
  assert.ok(sportsMissingScoringModel().includes("nhl"));
  assert.ok(sportsMissingScoringModel().includes("boxing"));
});

test("non-football sports stay fail-closed in settlement support", () => {
  for (const sport of ["nhl", "nba", "mlb", "soccer", "tennis", "ufc", "boxing", "cricket"] as const) {
    const d = isMarketFamilySupported(sport, "ml");
    assert.equal(d.supported, false);
  }
});
