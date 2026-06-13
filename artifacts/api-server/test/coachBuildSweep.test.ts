import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSweepAction } from "../src/lib/coachBuildSweep.ts";

const STALE = 8 * 60 * 1000; // mirrors COACH_BUILD_STALE_MS
const NOW = Date.parse("2026-06-13T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test("malformed marker (no buildId) => clear, even when fresh", () => {
  assert.deepEqual(
    decideSweepAction({ createdAt: iso(0) }, null, NOW, STALE),
    { kind: "clearMarker" },
  );
});

test("malformed marker (bad createdAt) => clear", () => {
  assert.deepEqual(
    decideSweepAction({ buildId: "b1", createdAt: "not-a-date" }, null, NOW, STALE),
    { kind: "clearMarker" },
  );
});

test("null / undefined marker => clear", () => {
  assert.deepEqual(decideSweepAction(null, null, NOW, STALE), { kind: "clearMarker" });
  assert.deepEqual(decideSweepAction(undefined, null, NOW, STALE), { kind: "clearMarker" });
});

test("fresh marker within deadline => skip (handler may still be running)", () => {
  assert.deepEqual(
    decideSweepAction({ buildId: "b1", createdAt: iso(STALE - 1000) }, null, NOW, STALE),
    { kind: "skip" },
  );
});

test("stale marker, no terminal stash => finalize failed (the autoscale-gap case)", () => {
  assert.deepEqual(
    decideSweepAction({ buildId: "b1", createdAt: iso(STALE + 1000) }, null, NOW, STALE),
    { kind: "finalizeFailed", buildId: "b1" },
  );
});

test("stale marker, but a 'ready' stash already exists for this build => clear, never clobber it", () => {
  assert.deepEqual(
    decideSweepAction(
      { buildId: "b1", createdAt: iso(STALE + 1000) },
      { buildId: "b1", status: "ready" },
      NOW,
      STALE,
    ),
    { kind: "clearMarker" },
  );
});

test("stale marker, terminal 'failed'/'timedOut' stash for this build => clear", () => {
  for (const status of ["failed", "timedOut"]) {
    assert.deepEqual(
      decideSweepAction(
        { buildId: "b1", createdAt: iso(STALE + 1000) },
        { buildId: "b1", status },
        NOW,
        STALE,
      ),
      { kind: "clearMarker" },
    );
  }
});

test("stale marker, stash is for a DIFFERENT build => still finalize failed", () => {
  assert.deepEqual(
    decideSweepAction(
      { buildId: "b2", createdAt: iso(STALE + 1000) },
      { buildId: "b1", status: "ready" },
      NOW,
      STALE,
    ),
    { kind: "finalizeFailed", buildId: "b2" },
  );
});

test("stale marker, stash has unknown/non-terminal status => finalize failed", () => {
  assert.deepEqual(
    decideSweepAction(
      { buildId: "b1", createdAt: iso(STALE + 1000) },
      { buildId: "b1", status: "pending" },
      NOW,
      STALE,
    ),
    { kind: "finalizeFailed", buildId: "b1" },
  );
});

test("exactly at the deadline => stale (not skipped)", () => {
  assert.deepEqual(
    decideSweepAction({ buildId: "b1", createdAt: iso(STALE) }, null, NOW, STALE),
    { kind: "finalizeFailed", buildId: "b1" },
  );
});
