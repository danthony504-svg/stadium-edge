import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coachProgressSignature,
  initialCoachProgress,
  mergeCoachProgress,
} from "./coachProgressState.ts";

test("mergeCoachProgress ignores stale lower stage", () => {
  const base = {
    ...initialCoachProgress("req-1"),
    stage: "running-simulations" as const,
    percent: 74,
    gamesLoaded: 10,
    propsComplete: true,
    edgeComplete: true,
    simulationsComplete: false,
  };
  const merged = mergeCoachProgress(base, {
    requestId: "req-1",
    stage: "loading-games",
    percent: 12,
  });
  assert.equal(merged, null);
});

test("mergeCoachProgress advances monotonically", () => {
  const base = initialCoachProgress("req-1");
  const merged = mergeCoachProgress(base, {
    requestId: "req-1",
    stage: "running-simulations",
    gamesLoaded: 8,
  });
  assert.ok(merged);
  assert.equal(merged.stage, "running-simulations");
  assert.equal(merged.propsComplete, true);
  assert.equal(merged.edgeComplete, true);
  assert.equal(merged.percent, 74);
});

test("mergeCoachProgress preserves empty-scan terminal without ticket", () => {
  const base = {
    ...initialCoachProgress("req-empty"),
    stage: "running-simulations" as const,
    percent: 74,
    gamesLoaded: 12,
    propsComplete: true,
    edgeComplete: true,
    simulationsComplete: true,
  };
  const merged = mergeCoachProgress(base, {
    requestId: "req-empty",
    stage: "complete",
    percent: 100,
    terminal: true,
    ticketComplete: false,
    simulationsComplete: true,
    edgeComplete: true,
    propsComplete: true,
    gamesLoaded: 12,
  });
  assert.ok(merged);
  assert.equal(merged.terminal, true);
  assert.equal(merged.ticketComplete, false);
  assert.equal(merged.stage, "complete");
});

test("mergeCoachProgress returns null when unchanged", () => {
  const base = initialCoachProgress("req-1");
  const merged = mergeCoachProgress(base, { requestId: "req-1", stage: "loading-games" });
  assert.equal(merged, null);
  assert.equal(coachProgressSignature(base), coachProgressSignature(base));
});
