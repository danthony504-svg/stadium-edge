import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCoachPrecomputedSlateRow } from "../src/lib/coachSlateRow.ts";

test("normalizeCoachPrecomputedSlateRow returns empty for missing row", () => {
  const out = normalizeCoachPrecomputedSlateRow(null);
  assert.equal(out.snapshot, null);
  assert.equal(out.fresh, false);
  assert.equal(out.instantServe, false);
  assert.equal(out.computedAt, null);
  assert.equal(out.deepSimComplete, false);
});

test("normalizeCoachPrecomputedSlateRow tolerates string updatedAt (no toISOString throw)", () => {
  const at = Date.now();
  const out = normalizeCoachPrecomputedSlateRow({
    data: {
      at,
      fingerprint: "fp",
      built: {
        context: {
          selectedSports: [],
          currentSlip: [],
          realGames: [],
          realOdds: [],
          realProps: [],
        },
        propPool: [],
        gameMeta: [],
        upsetSpots: [],
        todayOnly: false,
        tomorrowOnly: false,
      },
      propSimulations: [],
      boardScan: null,
      deepSimComplete: true,
    },
    updatedAt: "2026-10-10T10:00:00.000Z",
    deepSimComplete: true,
  });
  assert.ok(out.snapshot);
  assert.equal(out.computedAt, "2026-10-10T10:00:00.000Z");
  assert.equal(out.deepSimComplete, true);
  assert.equal(out.fresh, true);
});

test("normalizeCoachPrecomputedSlateRow tolerates null updatedAt", () => {
  const out = normalizeCoachPrecomputedSlateRow({
    data: { at: Date.now(), fingerprint: "x", built: null, propSimulations: [], boardScan: null, deepSimComplete: false },
    updatedAt: null,
    deepSimComplete: false,
  });
  assert.equal(out.computedAt, null);
  assert.ok(out.snapshot);
});

test("normalizeCoachPrecomputedSlateRow rejects non-object data", () => {
  const out = normalizeCoachPrecomputedSlateRow({
    data: "not-json-object",
    updatedAt: new Date("2026-10-10T10:00:00.000Z"),
    deepSimComplete: true,
  });
  assert.equal(out.snapshot, null);
  assert.equal(out.computedAt, "2026-10-10T10:00:00.000Z");
});
