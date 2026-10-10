import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FANTASY_ROSTER_ID,
  FANTASY_ROSTER_SLOTS,
  createDefaultFantasyRosters,
  defaultFantasyRoster,
  isFantasyRostersSync,
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

test("isFantasyRostersSync rejects null/undefined rosters (Hermes Object.entries crash)", () => {
  // Regression: typeof null === "object" made the old guard accept this payload,
  // then repairFantasyRosterSlots → Object.entries(null) threw
  // "Cannot convert undefined value to object" under FantasyRosterProvider.
  assert.equal(isFantasyRostersSync({ rosters: null }), false);
  assert.equal(isFantasyRostersSync({ rosters: undefined }), false);
  assert.equal(isFantasyRostersSync({ rosters: [] }), false);
  assert.equal(isFantasyRostersSync(null), false);
  assert.equal(isFantasyRostersSync({ rosters: { default: { players: null } } }), false);
  assert.equal(isFantasyRostersSync(createDefaultFantasyRosters()), true);

  assert.throws(
    () => repairFantasyRosterSlots({ version: 1, defaultRosterId: "default", rosters: null as never }),
    (err: unknown) =>
      err instanceof TypeError &&
      /rosters/i.test((err as Error).message),
  );

  // Reproduce the historical throw site when validation is skipped.
  assert.throws(
    () => Object.entries(null as never),
    (err: unknown) =>
      err instanceof TypeError &&
      /Cannot convert undefined or null to object|Cannot convert undefined value to object/i.test(
        (err as Error).message,
      ),
  );
});

test("defaultFantasyRoster survives missing rosters map without throwing", () => {
  const roster = defaultFantasyRoster({
    version: 1,
    defaultRosterId: DEFAULT_FANTASY_ROSTER_ID,
    rosters: null as never,
  });
  assert.equal(roster.id, DEFAULT_FANTASY_ROSTER_ID);
  assert.equal(roster.players.length, 0);
});
