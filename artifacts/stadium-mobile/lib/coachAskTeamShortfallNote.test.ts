import test from "node:test";
import assert from "node:assert/strict";
import {
  coachAskTeamScope,
  coachAskTeamShortfallNote,
} from "./coachAskTeamScope.ts";

test("shortfall distinguishes qualification shortage from staging limit", () => {
  const scope = coachAskTeamScope("7 leg Saints");
  assert.ok(scope);

  const qualShort = coachAskTeamShortfallNote(scope, 7, {
    qualifiedInScope: 4,
    seatedCount: 4,
    matchedGameCount: 1,
  });
  assert.match(qualShort, /Only 4 qualified/i);
  assert.doesNotMatch(qualShort, /staging seated/i);

  const stagingShort = coachAskTeamShortfallNote(scope, 7, {
    qualifiedInScope: 39,
    seatedCount: 4,
    matchedGameCount: 1,
    limitingRule: "single_event_participant_cap",
  });
  assert.match(stagingShort, /39 qualified/i);
  assert.match(stagingShort, /staging seated 4 of 7/i);
  assert.doesNotMatch(stagingShort, /Only 4 eligible/i);
  assert.doesNotMatch(stagingShort, /Only 4 qualified/i);
});

test("shortfall never labels seatedCount as eligible when pool is larger", () => {
  const scope = coachAskTeamScope("5 leg Lakers");
  assert.ok(scope);
  const note = coachAskTeamShortfallNote(scope, 5, {
    qualifiedInScope: 12,
    seatedCount: 3,
    matchedGameCount: 1,
    limitingRule: "single_event_correlation_exhausted",
  });
  assert.match(note, /12 qualified/);
  assert.match(note, /seated 3/);
  assert.doesNotMatch(note, /Only 3 eligible/);
});

test("full seat returns empty note", () => {
  const scope = coachAskTeamScope("4 leg Chiefs");
  assert.ok(scope);
  assert.equal(
    coachAskTeamShortfallNote(scope, 4, {
      qualifiedInScope: 10,
      seatedCount: 4,
      matchedGameCount: 1,
    }),
    "",
  );
});
