/**
 * GET /api/coach/slate must never start expensive slate generation.
 * Cold/missing snapshots degrade with refreshing=true; cron warms the DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  coachSlateGetMayStartJob,
  coachSlateNeedsRefresh,
  concurrentCoachSlateGetsMayStartJobs,
  hasUsableCoachSlateSnapshot,
} from "../src/lib/coachSlateGetPolicy.ts";
import { normalizeCoachPrecomputedSlateRow } from "../src/lib/coachSlateRow.ts";

test("cold cache / missing DB snapshot: needs refresh, not usable, GET must not start job", () => {
  const row = normalizeCoachPrecomputedSlateRow(null);
  assert.equal(row.snapshot, null);
  assert.equal(row.fresh, false);
  assert.equal(hasUsableCoachSlateSnapshot(row), false);
  assert.equal(coachSlateNeedsRefresh(row), true);
  assert.equal(coachSlateGetMayStartJob(row), false);
});

test("soft-stale instant-serve row: refreshing without authorizing GET job start", () => {
  // Within instant-serve window but past fresh TTL (15m < age < 30m).
  const at = Date.now() - 20 * 60 * 1000;
  const row = normalizeCoachPrecomputedSlateRow({
    data: {
      at,
      fingerprint: "fp",
      built: {
        context: {
          selectedSports: ["nfl"],
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
      boardScan: { picks: [], totalScanned: 0, totalQualified: 0 },
      tickets: { global: {}, bySport: {} },
      activeSports: ["nfl"],
      deepSimComplete: true,
    },
    updatedAt: new Date(at),
    deepSimComplete: true,
  });
  assert.equal(row.fresh, false);
  assert.equal(row.instantServe, true);
  assert.equal(hasUsableCoachSlateSnapshot(row), true);
  assert.equal(coachSlateNeedsRefresh(row), true);
  assert.equal(coachSlateGetMayStartJob(row), false);
});

test("concurrent GET requests cannot launch duplicate generation jobs", () => {
  assert.equal(concurrentCoachSlateGetsMayStartJobs(1), false);
  assert.equal(concurrentCoachSlateGetsMayStartJobs(8), false);
  assert.equal(concurrentCoachSlateGetsMayStartJobs(100), false);
});

test("scheduleCoachSlateRefresh is a documented no-op (does not call runCoachSlateJob)", () => {
  const src = readFileSync(
    join(import.meta.dirname, "../src/lib/coachSlateJobs.ts"),
    "utf8",
  );
  const fn = src.match(
    /export function scheduleCoachSlateRefresh[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(fn, "scheduleCoachSlateRefresh function present");
  assert.match(fn, /no-op/i);
  assert.doesNotMatch(fn, /runCoachSlateJob\s*\(/);
});

test("GET route does not call scheduleCoachSlateRefresh", () => {
  const src = readFileSync(
    join(import.meta.dirname, "../src/routes/coachSlate.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /scheduleCoachSlateRefresh\s*\(/);
  assert.match(src, /coachSlateGetMayStartJob/);
  assert.match(src, /READ-ONLY/);
});

test("degraded GET body shape for missing snapshot (stable, no sim kickoff)", () => {
  const row = normalizeCoachPrecomputedSlateRow(null);
  const body = {
    snapshot: null as null,
    fresh: row.fresh,
    instantServe: row.instantServe,
    refreshing: coachSlateNeedsRefresh(row),
    computedAt: row.computedAt,
    deepSimComplete: row.deepSimComplete,
    activeSports: [] as string[],
    premiumUnlocked: false,
    startJob: coachSlateGetMayStartJob(row),
  };
  assert.equal(body.snapshot, null);
  assert.equal(body.fresh, false);
  assert.equal(body.refreshing, true);
  assert.equal(body.premiumUnlocked, false);
  assert.equal(body.startJob, false);
  assert.deepEqual(body.activeSports, []);
});
