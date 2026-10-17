import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  INJURY_COLLECTOR_SCHEDULE,
  appendFailure,
  buildInjuryCollectorActivationPackage,
  injuryMinuteBucket,
  loadManifest,
  persistInjurySnapshot,
} from "../src/lib/sportSim/ncaafClean/index.ts";
import { ODDS_RETRIEVAL_HOLD } from "../src/lib/sportSim/ncaafClean/oddsEvalSplitHold.ts";

test("schedule count is 20 = 4×2 + 3×4", () => {
  assert.equal(INJURY_COLLECTOR_SCHEDULE.freezesPerWeek, 20);
  assert.equal(INJURY_COLLECTOR_SCHEDULE.math, "4×2 + 3×4 = 20");
  assert.equal(
    INJURY_COLLECTOR_SCHEDULE.monThuDays * INJURY_COLLECTOR_SCHEDULE.monThuPerDay +
      INJURY_COLLECTOR_SCHEDULE.friSunDays * INJURY_COLLECTOR_SCHEDULE.friSunPerDay,
    20,
  );
});

test("persist writes once; minute-bucket and content dedupe", () => {
  const dir = mkdtempSync(join(tmpdir(), "ncaaf-inj-"));
  const base = {
    source: "test",
    captureNote: "t",
    teamCount: 1,
    qbOutOrDoubtfulCount: 0,
    teams: [{ team: "A", entries: [] }],
  };
  const a = persistInjurySnapshot(dir, {
    ...base,
    captureTimestamp: "2026-10-17T18:00:01.000Z",
  });
  assert.equal(a.status, "wrote");
  const b = persistInjurySnapshot(dir, {
    ...base,
    captureTimestamp: "2026-10-17T18:00:45.000Z",
  });
  assert.equal(b.status, "deduped_skip");
  if (b.status === "deduped_skip") {
    assert.equal(b.reason, "same_minute_bucket");
  }
  const c = persistInjurySnapshot(dir, {
    ...base,
    captureTimestamp: "2026-10-17T19:00:00.000Z",
    teams: [{ team: "A", entries: [] }],
  });
  // same content different minute → content sha dedupe
  assert.equal(c.status, "deduped_skip");
  if (c.status === "deduped_skip") {
    assert.equal(c.reason, "same_content_sha");
  }
  const d = persistInjurySnapshot(dir, {
    ...base,
    captureTimestamp: "2026-10-17T20:00:00.000Z",
    teams: [{ team: "B", entries: [{ player: "x" }] }],
    teamCount: 1,
  });
  assert.equal(d.status, "wrote");
  const man = loadManifest(dir);
  assert.equal(man.snapshots.length, 2);
  assert.equal(man.freezesPerWeek, 20);
});

test("failure journal appends and updates manifest counters", () => {
  const dir = mkdtempSync(join(tmpdir(), "ncaaf-inj-fail-"));
  appendFailure(dir, {
    at: "2026-10-17T18:10:00.000Z",
    stage: "fetch",
    httpStatus: 503,
    message: "ESPN down",
    frozenMlUnchanged: true,
  });
  assert.ok(existsSync(join(dir, "failures.jsonl")));
  assert.ok(existsSync(join(dir, "latest-failure.json")));
  const man = loadManifest(dir);
  assert.equal(man.consecutiveFailures, 1);
  assert.equal(man.lastFailureAt, "2026-10-17T18:10:00.000Z");
  const line = readFileSync(join(dir, "failures.jsonl"), "utf8").trim();
  assert.match(line, /ESPN down/);
});

test("minute bucket truncates to UTC minute", () => {
  assert.equal(
    injuryMinuteBucket("2026-10-17T18:07:33.154Z"),
    "2026-10-17T18:07:00Z",
  );
});

test("activation package reports ACTIVE when requested; gates unchanged", () => {
  const p = buildInjuryCollectorActivationPackage({ activated: true });
  assert.equal(p.status, "ACTIVE");
  assert.equal(p.activated, true);
  assert.equal(p.frozenMlUnchanged, true);
  assert.equal(p.productGatesUnchanged, true);
  assert.equal(p.schedule.freezesPerWeek, 20);
});

test("Odds retrieval held; FINAL_EVAL not for development inspection", () => {
  assert.equal(ODDS_RETRIEVAL_HOLD.status, "HELD");
  assert.equal(ODDS_RETRIEVAL_HOLD.fetchAuthorized, false);
  assert.equal(ODDS_RETRIEVAL_HOLD.splits.FINAL_EVAL.useForDevelopment, false);
  assert.equal(
    ODDS_RETRIEVAL_HOLD.splits.FINAL_EVAL.inspectResultsToGuideFixes,
    false,
  );
  assert.equal(ODDS_RETRIEVAL_HOLD.splits.TUNING.useForDevelopment, true);
  assert.equal(ODDS_RETRIEVAL_HOLD.alts.deferred, true);
});
