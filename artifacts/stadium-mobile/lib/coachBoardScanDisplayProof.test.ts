/**
 * Proof: 6-leg shows once and must not vanish on a later under-count restage.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

function applyWave(opts: {
  ready: number;
  target: number;
  complete?: boolean;
  displayed?: number;
}) {
  const hold = shouldHoldIncompleteBoardScanPickDisplay({
    scanComplete: opts.complete === true,
    legTarget: opts.target,
    readyPickCount: opts.ready,
  });
  const blank = shouldBlankHeldBoardScanPickDisplay({
    holdIncomplete: hold,
    displayedPickCount: opts.displayed ?? 0,
  });
  const displayedAfter = blank ? 0 : hold ? opts.displayed ?? 0 : opts.ready;
  return { hold, blank, displayedAfter };
}

test("6-leg timeline: hold 2/4, show 6, later under-count keeps 6 on screen", () => {
  const w2 = applyWave({ ready: 2, target: 6, displayed: 0 });
  assert.equal(w2.blank, true);
  assert.equal(w2.displayedAfter, 0);

  const w4 = applyWave({ ready: 4, target: 6, displayed: 0 });
  assert.equal(w4.blank, true);
  assert.equal(w4.displayedAfter, 0);

  const w6 = applyWave({ ready: 6, target: 6, displayed: 0 });
  assert.equal(w6.hold, false);
  assert.equal(w6.blank, false);
  assert.equal(w6.displayedAfter, 6);

  // Restage drops to 4 while still incomplete — must NOT erase the 6-leg ticket.
  const restage = applyWave({ ready: 4, target: 6, displayed: 6 });
  assert.equal(restage.hold, true);
  assert.equal(restage.blank, false);
  assert.equal(restage.displayedAfter, 6);
});

test("6-leg scanComplete may replace sticky ticket with final shortfall/full", () => {
  const final = applyWave({ ready: 6, target: 6, complete: true, displayed: 6 });
  assert.equal(final.hold, false);
  assert.equal(final.displayedAfter, 6);

  const shortfall = applyWave({ ready: 5, target: 6, complete: true, displayed: 6 });
  assert.equal(shortfall.hold, false);
  assert.equal(shortfall.displayedAfter, 5);
});
