import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSimCountLabel,
  isFullDeepSimulation,
  REQUESTED_DEEP_SIMS,
} from "./simRunDisplay.ts";

test("formatSimCountLabel shows 10,000 only when server confirms", () => {
  const full = {
    requestedSims: 10_000,
    completedSims: 10_000,
    failedSims: 0,
    actualSimCount: 10_000,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    runTimeMs: 120,
  };
  assert.equal(formatSimCountLabel(full), "10,000 Sims");
  assert.equal(isFullDeepSimulation(full), true);

  const partial = { ...full, completedSims: 1000, actualSimCount: 1000 };
  assert.match(formatSimCountLabel(partial), /partial simulation/);
  assert.equal(isFullDeepSimulation(partial), false);
});

test("REQUESTED_DEEP_SIMS is 10,000", () => {
  assert.equal(REQUESTED_DEEP_SIMS, 10_000);
});
