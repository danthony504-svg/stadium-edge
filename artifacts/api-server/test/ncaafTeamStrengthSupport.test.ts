import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ncaafTeamStrengthMatchupSupport,
  ncaafTeamStrengthWithholdMessage,
} from "../src/lib/sportSim/ncaafTeamStrengthSupport.ts";
import { loadSubdivisionFixture } from "../src/lib/sportSim/ncaafSubdivision.ts";

test("FBS–FCS is unsupported scope with Coach withhold (not a validation miss)", () => {
  const fix = loadSubdivisionFixture();
  const fbs = Object.keys(fix.seasons["2025"]!.fbs)[0]!;
  const fcs = Object.keys(fix.seasons["2025"]!.fcs)[0]!;
  const d = ncaafTeamStrengthMatchupSupport({
    homeTeamId: fbs,
    awayTeamId: fcs,
    season: 2025,
    homeRated: true,
    awayRated: false,
  });
  assert.equal(d.supported, false);
  if (!d.supported) {
    assert.equal(d.reason, "fbs_fcs_unsupported_scope");
    assert.equal(d.coachAction, "withhold");
    assert.match(ncaafTeamStrengthWithholdMessage(d), /FBS–FCS/);
  }
});

test("FBS–FBS unrated side withholds; rated FBS–FBS allows", () => {
  const fix = loadSubdivisionFixture();
  const ids = Object.keys(fix.seasons["2025"]!.fbs);
  const a = ids[0]!;
  const b = ids[1]!;
  const unrated = ncaafTeamStrengthMatchupSupport({
    homeTeamId: a,
    awayTeamId: b,
    season: 2025,
    homeRated: true,
    awayRated: false,
  });
  assert.equal(unrated.supported, false);
  if (!unrated.supported) assert.equal(unrated.reason, "unrated_fbs_side");

  const ok = ncaafTeamStrengthMatchupSupport({
    homeTeamId: a,
    awayTeamId: b,
    season: 2025,
    homeRated: true,
    awayRated: true,
  });
  assert.equal(ok.supported, true);
  if (ok.supported) assert.equal(ok.coachAction, "allow_when_rated");
});

test("unknown team withholds", () => {
  const fix = loadSubdivisionFixture();
  const fbs = Object.keys(fix.seasons["2025"]!.fbs)[0]!;
  const d = ncaafTeamStrengthMatchupSupport({
    homeTeamId: fbs,
    awayTeamId: "999999999",
    season: 2025,
  });
  assert.equal(d.supported, false);
  if (!d.supported) assert.equal(d.reason, "involves_unknown");
});
