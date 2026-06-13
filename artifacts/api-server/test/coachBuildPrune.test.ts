import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneCutoffMs } from "../src/lib/coachBuildSweep.ts";

const RETENTION = 7 * 24 * 60 * 60 * 1000; // mirrors COACH_BUILD_RETENTION_MS
const NOW = Date.parse("2026-06-13T12:00:00.000Z");

test("cutoff is exactly retention before now", () => {
  assert.equal(pruneCutoffMs(NOW, RETENTION), NOW - RETENTION);
});

test("a row written just inside the window is NOT past the cutoff", () => {
  const cutoff = pruneCutoffMs(NOW, RETENTION);
  const writtenMs = NOW - (RETENTION - 1000); // 1s newer than the cutoff
  assert.ok(writtenMs > cutoff, "fresh row must survive pruning");
});

test("a row written just past the window IS past the cutoff", () => {
  const cutoff = pruneCutoffMs(NOW, RETENTION);
  const writtenMs = NOW - (RETENTION + 1000); // 1s older than the cutoff
  assert.ok(writtenMs < cutoff, "stale row must be pruned");
});

test("the retention window dwarfs the 8-min sweep deadline (dedupe stays safe)", () => {
  const SWEEP_DEADLINE = 8 * 60 * 1000;
  assert.ok(
    NOW - pruneCutoffMs(NOW, RETENTION) > SWEEP_DEADLINE * 100,
    "nothing live can re-touch a build old enough to prune",
  );
});
