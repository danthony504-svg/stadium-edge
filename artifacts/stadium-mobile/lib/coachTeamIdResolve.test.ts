import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoachGameTeamIdMap,
  resolveCoachGameTeamIds,
} from "./coachTeamIdResolve.ts";
import {
  deriveCoachScanFailureReason,
  formatCoachScanFailureTrace,
} from "./coachScanFailureReason.ts";

test("NCAAF odds label resolves ESPN full nicknames for game sims", () => {
  const map = buildCoachGameTeamIdMap([
    {
      sport: "ncaaf",
      homeTeam: "Michigan Wolverines",
      awayTeam: "Ohio State Buckeyes",
      homeTeamId: "130",
      awayTeamId: "194",
    },
  ]);
  // Nickname-only keys fail here ("buckeyes|wolverines" vs "state|michigan").
  assert.equal(map.get("state|michigan"), undefined);
  const ids = resolveCoachGameTeamIds("Ohio State @ Michigan", "ncaaf", map);
  assert.ok(ids, "fuzzy resolve must bind Odds label to ESPN ids");
  assert.equal(ids!.homeTeamId, "130");
  assert.equal(ids!.awayTeamId, "194");
});

test("empty diagnostics produce TEAM_IDS_UNRESOLVED trace for phone triage", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 10,
    teamIdMapSize: 30,
    gameEntryCount: 10,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 120,
  });
  assert.equal(reason?.code, "TEAM_IDS_UNRESOLVED");
  assert.match(formatCoachScanFailureTrace(reason!), /0 game sims bound/);
});
