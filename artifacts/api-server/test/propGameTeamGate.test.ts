import assert from "node:assert/strict";
import test from "node:test";

import { propBelongsToGameTeams } from "../src/lib/propGameTeamGate.ts";

test("Odds props: orphan playerTeamId cannot inherit ATL@PIT label", () => {
  assert.equal(propBelongsToGameTeams(null, "23", "1"), false);
  assert.equal(propBelongsToGameTeams("20", "23", "1"), false);
  assert.equal(propBelongsToGameTeams("23", "23", "1"), true);
  assert.equal(propBelongsToGameTeams("1", "23", "1"), true);
});
