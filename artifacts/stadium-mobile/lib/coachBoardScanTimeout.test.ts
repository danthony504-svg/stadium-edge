import assert from "node:assert/strict";
import test from "node:test";

import { resolveCoachBoardScanTimeout } from "./coachBoardScanTimeout.ts";

type Scan = {
  requestedLegs: number;
  picks: { id: string }[];
  scanComplete?: boolean;
};

function scan(requestedLegs: number, pickCount: number, scanComplete = false): Scan {
  return {
    requestedLegs,
    picks: Array.from({ length: pickCount }, (_, index) => ({ id: `pick-${index}` })),
    scanComplete,
  };
}

test("timeout with zero picks fails terminally", () => {
  assert.deepEqual(resolveCoachBoardScanTimeout<Scan>(null, scan(5, 0), 5), {
    terminal: "failed",
    scan: null,
  });
});

test("timeout does not terminalize an incomplete qualified shortfall", () => {
  const staged = scan(15, 4);
  assert.deepEqual(resolveCoachBoardScanTimeout<Scan>(null, staged, 15), { terminal: "failed", scan: null });
});

test("timeout after target is reached preserves all requested legs", () => {
  const staged = scan(15, 15);
  const result = resolveCoachBoardScanTimeout<Scan>(null, staged, 15);
  assert.equal(result.terminal, "completed");
  if (result.terminal === "completed") assert.equal(result.scan.picks.length, 15);
});

test("timeout permits an honest shortfall only after scan completion", () => {
  const staged = scan(6, 3, true);
  assert.deepEqual(resolveCoachBoardScanTimeout<Scan>(null, staged, 6), {
    terminal: "completed",
    scan: staged,
  });
});

test("a five-leg request only accepts its own staged scan", () => {
  const result = resolveCoachBoardScanTimeout<Scan>(null, scan(15, 15), 5);
  assert.equal(result.terminal, "failed");
});

test("a fifteen-leg request only accepts its own staged scan", () => {
  const result = resolveCoachBoardScanTimeout<Scan>(null, scan(5, 5), 15);
  assert.equal(result.terminal, "failed");
});
