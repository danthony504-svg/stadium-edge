import { test } from "node:test";
import assert from "node:assert/strict";
import { todayBuildNote } from "./slate.ts";

// The "nothing is upcoming" phrasing was the bug: it is always at least partly
// false under a today-only build (todayOnly is only true when a game IS still
// upcoming) and it conflated two distinct empty-result causes. None of the
// honest notes may contain it.
const BANNED = /nothing on today's board is still upcoming/i;

test("zero survivors + nothing emitted => no note at all", () => {
  assert.equal(
    todayBuildNote({ before: 0, surviving: 0, emittedPickLines: 0 }),
    "",
  );
});

test("thin slate (before===0, lines emitted) => offer full slate / shorter, never 'nothing upcoming'", () => {
  const note = todayBuildNote({
    before: 0,
    surviving: 0,
    emittedPickLines: 7,
  });
  assert.match(note, /too thin/i);
  assert.match(note, /full slate|shorter ticket/i);
  assert.doesNotMatch(note, BANNED);
});

test("legs grounded but all started/non-today (before>0, none survive) => offer 48h / check back, never 'nothing upcoming'", () => {
  const note = todayBuildNote({
    before: 5,
    surviving: 0,
    emittedPickLines: 5,
  });
  assert.match(note, /already kicked off|aren't today/i);
  assert.match(note, /next 48 hours|check back/i);
  assert.doesNotMatch(note, BANNED);
});

test("partial survivors => transparency count with correct pluralization", () => {
  const many = todayBuildNote({ before: 4, surviving: 2, emittedPickLines: 4 });
  assert.match(many, /Showing the 2 real legs/);
  assert.match(many, /dropped 2/);

  const one = todayBuildNote({ before: 3, surviving: 1, emittedPickLines: 3 });
  assert.match(one, /Showing the 1 real leg\b/);
  assert.match(one, /dropped 2/);
});

test("all survive (no drops) => no note", () => {
  assert.equal(
    todayBuildNote({ before: 4, surviving: 4, emittedPickLines: 4 }),
    "",
  );
});
