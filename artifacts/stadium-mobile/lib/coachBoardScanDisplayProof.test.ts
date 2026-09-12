import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  boardScanDisplayProgressPct,
  canCompleteFixedLegBoardScanHandoff,
  canShowFixedLegBoardScanPicks,
  isPermanentBoardScan93PctState,
  shouldAcceptSameRequestBoardScanTicketUpdate,
  shouldBlockPostFreezeTicketDisplayMutation,
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
  const next = {
    displayedPickCount: wave.pickCount,
    displayedScanComplete:
      wave.scanComplete ||
      (legTarget >= 3 && wave.pickCount >= legTarget),
  };
  return next;
}

test("timeline: 2 → 4 → full 6 freezes; late waves cannot reshape", () => {
  let state = { displayedPickCount: 0, displayedScanComplete: false };
  state = applyWave(state, { pickCount: 2, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 0, displayedScanComplete: false });
  state = applyWave(state, { pickCount: 4, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 0, displayedScanComplete: false });
  // Scored 6 of 6 paints without scanComplete — no permanent 93%.
  state = applyWave(state, { pickCount: 6, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: state.displayedScanComplete,
      displayedPickCount: state.displayedPickCount,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    boardScanDisplayProgressPct({
      displayedLegCount: 6,
      scoredLegCount: 6,
      legTarget: 6,
    }),
    100,
  );
  // Late reshape rejected.
  state = applyWave(state, { pickCount: 6, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
  state = applyWave(state, { pickCount: 5, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
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
      displayedScanComplete: fresh.displayedScanComplete,
      displayedPickCount: fresh.displayedPickCount,
      incomingScanComplete: false,
      incomingPickCount: 4,
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

test("timeline: scored 6 of 6 → 100% → final ticket (no permanent 93%)", () => {
  let state = { displayedPickCount: 0, displayedScanComplete: false };
  assert.equal(
    canCompleteFixedLegBoardScanHandoff({
      legTarget: 6,
      scoredLegCount: 6,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: 0,
      scanComplete: false,
    }),
    true,
  );
  state = applyWave(state, { pickCount: 6, scanComplete: false }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
  assert.equal(
    boardScanDisplayProgressPct({
      displayedLegCount: state.displayedPickCount,
      scoredLegCount: 6,
      legTarget: 6,
    }),
    100,
  );
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: state.displayedPickCount,
      scanComplete: false,
    }),
    false,
  );
});

test("timeline: scored N of N → scanComplete still stable at 100%", () => {
  let state = { displayedPickCount: 0, displayedScanComplete: false };
  state = applyWave(state, { pickCount: 6, scanComplete: false }, 6);
  state = applyWave(state, { pickCount: 6, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
  assert.equal(
    boardScanDisplayProgressPct({
      displayedLegCount: 6,
      scoredLegCount: 6,
      legTarget: 6,
    }),
    100,
  );
});

test("timeline: post-freeze sim rescore cannot mutate visible finished ticket", () => {
  let state = { displayedPickCount: 6, displayedScanComplete: true };
  assert.equal(
    shouldBlockPostFreezeTicketDisplayMutation({ frozen: true, legTarget: 6 }),
    true,
  );
  state = applyWave(state, { pickCount: 6, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
  state = applyWave(state, { pickCount: 5, scanComplete: true }, 6);
  assert.deepEqual(state, { displayedPickCount: 6, displayedScanComplete: true });
});

test("timeline: Try Again clears freeze and accepts a fresh completed ticket", () => {
  const prior = { displayedPickCount: 6, displayedScanComplete: true };
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: prior.displayedScanComplete,
      displayedPickCount: prior.displayedPickCount,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
  const fresh = { displayedPickCount: 0, displayedScanComplete: false };
  assert.equal(
    shouldBlockPostFreezeTicketDisplayMutation({ frozen: false, legTarget: 6 }),
    false,
  );
  const next = applyWave(fresh, { pickCount: 8, scanComplete: false }, 8);
  assert.deepEqual(next, { displayedPickCount: 8, displayedScanComplete: true });
});

test("coach.tsx wires freeze accept gate and post-freeze sim block", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx"),
    "utf8",
  );
  assert.match(src, /shouldAcceptSameRequestBoardScanTicketUpdate/);
  assert.match(src, /shouldFreezeDisplayedCoachTicket/);
  assert.match(src, /shouldBlockPostFreezeTicketDisplayMutation/);
  assert.match(src, /footerDisplayedLegCount/);
  assert.match(src, /footerScoredLegCount/);
  assert.match(src, /freezeNow/);
});


test("coach.tsx passes forceShowIncomplete into accept gate (escape paint)", () => {
  const src = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  // Accept-gate callsites used by patchInstant must thread escape flags —
  // otherwise releaseUnderCountBoardScanEscape paints nothing.
  assert.match(
    src,
    /shouldAcceptSameRequestBoardScanTicketUpdate\(\{[\s\S]*?forceShowIncomplete:\s*forceShowIncompleteBoardScanRef\.current/,
  );
  assert.match(
    src,
    /allowIncompletePicks:\s*opts\?\.allowIncompletePicks/,
  );
  // Failed accept on empty bubble must return false (not fake success).
  assert.match(
    src,
    /return \(boardTicketSnapshotRef\.current\?\.length \?\? 0\) > 0/,
  );
  // Escape must not unlock busy when paint failed.
  assert.match(
    src,
    /Keep busy \+ forceShow latched so stall\/retry can try again/,
  );
  // Stream-end must not wipe escape-painted cards.
  assert.match(
    src,
    /!forceShowIncompleteBoardScanRef\.current/,
  );
});
