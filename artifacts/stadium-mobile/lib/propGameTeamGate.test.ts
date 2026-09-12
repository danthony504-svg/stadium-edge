import assert from "node:assert/strict";
import test from "node:test";

import {
  filterPropsForGameTeams,
  propBelongsToGameTeams,
} from "./propGameTeamGate.ts";

const ATL = "1";
const PIT = "23";
const NYJ = "20";

test("fail closed: null playerTeamId dropped when game ids known", () => {
  assert.equal(propBelongsToGameTeams(null, PIT, ATL), false);
  assert.equal(propBelongsToGameTeams(undefined, PIT, ATL), false);
  assert.equal(propBelongsToGameTeams("", PIT, ATL), false);
});

test("Rodgers-like foreign team id must not label under Falcons@Steelers", () => {
  // Screenshot regression: player prop stamped on ATL @ PIT while playerTeamId
  // is a different club (or unresolved). Must not belong.
  assert.equal(propBelongsToGameTeams(NYJ, PIT, ATL), false);
  assert.equal(propBelongsToGameTeams(null, PIT, ATL), false);
});

test("player on home or away team id is kept", () => {
  assert.equal(propBelongsToGameTeams(PIT, PIT, ATL), true);
  assert.equal(propBelongsToGameTeams(ATL, PIT, ATL), true);
});

test("fail closed when game team ids unavailable (cannot verify membership)", () => {
  // Fail-open previously stamped orphan Odds rows with Away @ Home.
  assert.equal(propBelongsToGameTeams(null, null, null), false);
  assert.equal(propBelongsToGameTeams(NYJ, "", ""), false);
  assert.equal(propBelongsToGameTeams(null, undefined, undefined), false);
});

test("filterPropsForGameTeams drops orphans from a labeled event pool", () => {
  const rows = [
    { player: "Aaron Rodgers", playerTeamId: null as string | null },
    { player: "Najee Harris", playerTeamId: PIT },
    { player: "Bijan Robinson", playerTeamId: ATL },
    { player: "Garrett Wilson", playerTeamId: NYJ },
  ];
  const kept = filterPropsForGameTeams(rows, PIT, ATL);
  assert.deepEqual(
    kept.map((r) => r.player),
    ["Najee Harris", "Bijan Robinson"],
  );
});
