import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canShowFixedLegBoardScanPicks,
  shouldAcceptSameRequestBoardScanTicketUpdate,
  shouldFreezeDisplayedCoachTicket,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

/**
 * Timeline proof: same-request reshape must not replace a finished ticket.
 */
function applyWave(state: {
  displayedPickCount: number;
  displayedScanComplete: boolean;
}, wave: { pickCount: number; scanComplete: boolean }, legTarget: number) {
  if (
    !shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: state.displayedScanComplete,
      displayedPickCount: state.displayedPickCount,
      incomingScanComplete: wave.scanComplete,
      incomingPickCount: wave.pickCount,
      legTarget,
    })
  ) {
    return state;
  }
  if (
    !canShowFixedLegBoardScanPicks({
      legTarget,
      pickCount: wave.pickCount,
      scanComplete: wave.scanComplete,
    }) &&
    wave.pickCount > 0
  ) {
    return state;
  }
  return {
    displayedPickCount: wave.pickCount,
    displayedScanComplete: wave.scanComplete,
  };
}

test("timeline: 2 → 4 → final 6 becomes stable finished ticket only", () => {
  let state = { displayedPickCount: 0, displayedScanComplete: false };
  state = applyWave(state, { pickCount: 2, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 0, displayedScanComplete: false });
  state = applyWave(state, { pickCount: 4, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 0, displayedScanComplete: false });
  state = applyWave(state, { pickCount: 6, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: true,
      displayedPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
});

test("timeline: final 6 → late partial 5 stays at 6", () => {
  let state = { displayedPickCount: 6, displayedScanComplete: true };
  state = applyWave(state, { pickCount: 5, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
});

test("timeline: final 6 → duplicate final 6 no flicker/replace", () => {
  let state = { displayedPickCount: 6, displayedScanComplete: true };
  state = applyWave(state, { pickCount: 6, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
});

test("timeline: new request empty bubble rejects old incomplete; accepts new complete", () => {
  const fresh = { displayedPickCount: 0, displayedScanComplete: false };
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      ...{
        displayedScanComplete: fresh.displayedScanComplete,
        displayedPickCount: fresh.displayedPickCount,
      },
      incomingScanComplete: false,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
  const next = applyWave(fresh, { pickCount: 6, scanComplete: true }, 6);
  assert.deepEqual(next, { displayedPickCount: 6, displayedScanComplete: true });
});

test("timeline: shortfall 5-of-6 only after scanComplete", () => {
  let state = { displayedPickCount: 0, displayedScanComplete: false };
  state = applyWave(state, { pickCount: 5, scanComplete: false }, 6);
  assert.equal(state.displayedPickCount, 0);
  state = applyWave(state, { pickCount: 5, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 5, displayedScanComplete: true });
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
      readyPickCount: 5,
    }),
    false,
  );
});

test("coach.tsx wires freeze accept gate", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx"),
    "utf8",
  );
  assert.match(src, /shouldAcceptSameRequestBoardScanTicketUpdate/);
  assert.match(src, /shouldFreezeDisplayedCoachTicket/);
});
