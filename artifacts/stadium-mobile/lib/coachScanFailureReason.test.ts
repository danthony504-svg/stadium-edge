import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCoachScanFailureReason,
  formatCoachScanFailureTrace,
} from "./coachScanFailureReason.ts";

test("empty ticket with unresolved team ids is not QUALITY_BAR_EMPTY", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 12,
    teamIdMapSize: 40,
    gameEntryCount: 12,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 200,
    propLegsScored: 0,
  });
  assert.equal(reason?.code, "TEAM_IDS_UNRESOLVED");
  assert.match(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
});

test("scan null surfaces SCAN_THREW", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    scanMissing: true,
  });
  assert.equal(reason?.code, "SCAN_THREW");
});

test("team id map empty while odds exist", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 8,
    teamIdMapSize: 0,
    gameEntryCount: 8,
  });
  assert.equal(reason?.code, "TEAM_ID_MAP_EMPTY");
});

test("prop phase incomplete preferred over generic quality bar", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 6,
    teamIdMapSize: 20,
    gameEntryCount: 6,
    gameSimsLoaded: 3,
    gameLegsScored: 0,
    gameLegsDroppedNoSim: 0,
    propPoolSize: 180,
    propLegsScored: 0,
    propPhaseIncomplete: true,
  });
  // game sims loaded but 0 scored with no dropped-no-sim → GAME_SIMS_ALL_NULL wins first
  assert.ok(reason);
  assert.notEqual(reason!.code, "QUALITY_BAR_EMPTY");
});

test("non-empty ticket has no failure reason", () => {
  assert.equal(
    deriveCoachScanFailureReason({ stagedPickCount: 3, gameLegsScored: 3 }),
    null,
  );
});
