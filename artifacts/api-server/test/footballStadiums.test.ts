import assert from "node:assert/strict";
import test from "node:test";

import {
  NFL_STADIUMS,
  NCAAF_STADIUMS,
  resolveFootballStadium,
} from "../src/lib/footballStadiums.ts";

test("NFL stadium table covers all 32 teams with real coords", () => {
  assert.ok(Object.keys(NFL_STADIUMS).length >= 32);
  for (const [abbr, s] of Object.entries(NFL_STADIUMS)) {
    assert.ok(Number.isFinite(s.lat), abbr);
    assert.ok(Number.isFinite(s.lon), abbr);
    assert.ok(s.surface === "turf" || s.surface === "grass", abbr);
    assert.ok(s.name.length > 2, abbr);
  }
  // Domed examples
  assert.equal(NFL_STADIUMS.DAL!.dome, true);
  assert.equal(NFL_STADIUMS.GB!.dome, false);
  assert.equal(NFL_STADIUMS.GB!.surface, "grass");
});

test("NCAAF stadium table resolves major programs and fails closed on unknown", () => {
  assert.ok(resolveFootballStadium("ncaaf", "UGA"));
  assert.ok(resolveFootballStadium("ncaaf", "OSU"));
  assert.equal(resolveFootballStadium("ncaaf", "ZZZFAKE"), null);
  assert.equal(resolveFootballStadium("nba", "UGA"), null);
  assert.ok(Object.keys(NCAAF_STADIUMS).length >= 40);
});
