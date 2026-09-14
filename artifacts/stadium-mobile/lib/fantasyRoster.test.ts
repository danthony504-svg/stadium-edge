import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FANTASY_ROSTER_ID,
  FANTASY_ROSTER_SLOTS,
  createDefaultFantasyRosters,
  defaultFantasyRoster,
  positionEligibleForSlot,
  repairFantasyRosterSlots,
} from "./fantasyRoster.ts";

test("default fantasy rosters seed one empty NFL roster", () => {
  const data = createDefaultFantasyRosters();
  assert.equal(data.version, 1);
  assert.equal(data.defaultRosterId, DEFAULT_FANTASY_ROSTER_ID);
  const roster = defaultFantasyRoster(data);
  assert.equal(roster.sport, "nfl");
  assert.equal(roster.players.length, 0);
  assert.ok(FANTASY_ROSTER_SLOTS.includes("FLEX"));
});

test("positionEligibleForSlot enforces known starter slots", () => {
  assert.equal(positionEligibleForSlot("RB", "FLEX"), true);
  assert.equal(positionEligibleForSlot("QB", "FLEX"), false);
  assert.equal(positionEligibleForSlot("QB", "QB"), true);
  assert.equal(positionEligibleForSlot("WR", "Bench"), true);
});

test("repairFantasyRosterSlots moves illegal starters to Bench", () => {
  const data = createDefaultFantasyRosters();
  data.rosters[DEFAULT_FANTASY_ROSTER_ID]!.players.push({
    athleteId: "1",
    name: "Test QB",
    team: "NO",
    position: "QB",
    headshot: null,
    rosterSlot: "FLEX",
    dateAdded: Date.now(),
  });
  const repaired = repairFantasyRosterSlots(data);
  assert.equal(defaultFantasyRoster(repaired).players[0]!.rosterSlot, "Bench");
});
