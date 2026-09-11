/**
 * Proof: 6-leg under-count waves stay off-screen; full ticket shows once at 100%.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { shouldHoldIncompleteBoardScanPickDisplay } from "./coachBoardScanDisplay.ts";

const TARGETS = [6, 16, 28, 40, 52, 64, 74, 84, 93, 100] as const;

function progressPct(legCount: number, effectiveIndex = 8): number {
  if (legCount > 0) return 100;
  return TARGETS[Math.min(effectiveIndex, TARGETS.length - 1)]!;
}

function scoredFloor(scored: number, requested: number): number {
  if (requested <= 0 || scored <= 0) return 0;
  return Math.min(93, Math.round(40 + (53 * scored) / requested));
}

function applyWave(opts: {
  ready: number;
  target: number;
  complete?: boolean;
  force?: boolean;
}) {
  const holding = shouldHoldIncompleteBoardScanPickDisplay({
    scanComplete: opts.complete === true,
    legTarget: opts.target,
    readyPickCount: opts.ready,
    forceShowIncomplete: opts.force,
  });
  const displayed = holding ? 0 : opts.ready;
  return {
    holding,
    displayed,
    pct: progressPct(displayed),
    floor: scoredFloor(opts.ready, opts.target),
  };
}

test("6-leg: 2 then 4 stay held (no add/remove cards); progress floor tracks score", () => {
  const w2 = applyWave({ ready: 2, target: 6 });
  const w4 = applyWave({ ready: 4, target: 6 });
  assert.equal(w2.holding, true);
  assert.equal(w2.displayed, 0);
  assert.ok(w2.pct < 100);
  assert.equal(w2.floor, Math.round(40 + (53 * 2) / 6));
  assert.equal(w4.holding, true);
  assert.equal(w4.displayed, 0);
  assert.ok(w4.floor > w2.floor);
});

test("6-leg: ready=6 shows all picks once at 100%", () => {
  const w6 = applyWave({ ready: 6, target: 6 });
  assert.equal(w6.holding, false);
  assert.equal(w6.displayed, 6);
  assert.equal(w6.pct, 100);
});

test("6-leg: scanComplete shortfall shows actual picks at 100%", () => {
  const w = applyWave({ ready: 5, target: 6, complete: true });
  assert.equal(w.holding, false);
  assert.equal(w.displayed, 5);
  assert.equal(w.pct, 100);
});
