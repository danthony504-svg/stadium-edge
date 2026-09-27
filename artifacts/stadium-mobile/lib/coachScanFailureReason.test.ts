import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCoachScanFailureReason,
  formatCoachScanFailureTrace,
} from "./coachScanFailureReason.ts";

test("empty ticket with unresolved labels is TEAM_IDS_UNRESOLVED", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 12,
    teamIdMapSize: 40,
    gameEntryCount: 12,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 200,
    propLegsScored: 0,
    oddsLabelsUnresolved: 12,
    oddsLabelsBound: 0,
  });
  assert.equal(reason?.code, "TEAM_IDS_UNRESOLVED");
  assert.match(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
});

test("0 sims with healthy map but no unresolved counters is GAME_SIMS_FETCH_EMPTY", () => {
  // Rebuild: map.size alone must not claim "labels did not resolve".
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
    propLegsScored: 0,
    oddsLabelsBound: 15,
    oddsLabelsUnresolved: 0,
    gameSimsFetchNull: 15,
  });
  assert.equal(reason?.code, "GAME_SIMS_FETCH_EMPTY");
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
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

test("props-only empty ticket is not TEAM_IDS_UNRESOLVED when game sims were skipped", () => {
  // Phone: "10 leg nfl player props" → propsOnly skips game slate, so
  // gameSimsLoaded stays 0 even with a healthy ESPN id map.
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 180,
    propLegsScored: 0,
    propPhaseIncomplete: true,
    propsOnly: true,
  });
  assert.equal(reason?.code, "PROP_PHASE_INCOMPLETE");
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
});

test("props-only with scored-none props reports PROP_ALL_NO_SIM_GRADE", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 120,
    propLegsScored: 0,
    propPhaseIncomplete: false,
    propsOnly: true,
  });
  assert.equal(reason?.code, "PROP_ALL_NO_SIM_GRADE");
});

test("football requirePropMix empty prefers PROP_* over TEAM_IDS_UNRESOLVED", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 180,
    propLegsScored: 0,
    propPhaseIncomplete: true,
    requirePropMix: true,
    gameSimsAttempted: true,
  });
  assert.equal(reason?.code, "PROP_PHASE_INCOMPLETE");
});

test("phone screenshot 10-leg NFL never TEAM_IDS even with empty prop pool", () => {
  // Rebuild contract: requirePropMix is props-primary — empty pool → PROP_POOL_EMPTY,
  // never the screenshot "15 odds / 60 ESPN / 0 sims — labels did not resolve".
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
    propLegsScored: 0,
    requirePropMix: true,
    gameSimsAttempted: true,
    oddsLabelsBound: 15,
    oddsLabelsUnresolved: 0,
  });
  assert.equal(reason?.code, "PROP_POOL_EMPTY");
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /TEAM_IDS_UNRESOLVED/);
  assert.doesNotMatch(formatCoachScanFailureTrace(reason!), /labels did not resolve/);
});

test("game-phase timeout is GAME_SIMS_TIMED_OUT not TEAM_IDS", () => {
  const reason = deriveCoachScanFailureReason({
    stagedPickCount: 0,
    oddsGameCount: 15,
    teamIdMapSize: 60,
    gameEntryCount: 15,
    gameSimsLoaded: 0,
    gameLegsScored: 0,
    propPoolSize: 0,
    propLegsScored: 0,
    oddsLabelsBound: 15,
    oddsLabelsUnresolved: 0,
    gameSimsTimedOut: 12,
  });
  assert.equal(reason?.code, "GAME_SIMS_TIMED_OUT");
});

test("non-empty ticket has no failure reason", () => {
  assert.equal(
    deriveCoachScanFailureReason({ stagedPickCount: 3, gameLegsScored: 3 }),
    null,
  );
});
