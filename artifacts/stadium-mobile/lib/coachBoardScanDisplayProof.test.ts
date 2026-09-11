/**
 * Pre-OTA proof: with hold disabled, partials display and finalize to 100%.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { shouldHoldIncompleteBoardScanPickDisplay } from "./coachBoardScanDisplay.ts";
import {
  awaitLateBoardScanAfterBudget,
  runBoardScanBudgetHandoffTimeline,
  type BudgetHandoffScan,
} from "./coachBoardScanBudgetHandoff.ts";

const TARGETS = [6, 16, 28, 40, 52, 64, 74, 84, 93, 100] as const;

function progressPct(opts: { legCount: number; effectiveIndex: number }): number {
  if (opts.legCount > 0) return 100;
  return TARGETS[Math.min(opts.effectiveIndex, TARGETS.length - 1)]!;
}

type UiTicket = {
  displayedPicks: number;
  pct: number;
  holding: boolean;
};

function applyScanWave(opts: {
  legTarget: number;
  readyPickCount: number;
  scanComplete: boolean;
  effectiveIndex?: number;
}): UiTicket {
  const holding = shouldHoldIncompleteBoardScanPickDisplay({
    scanComplete: opts.scanComplete,
    legTarget: opts.legTarget,
    readyPickCount: opts.readyPickCount,
  });
  const displayedPicks = holding ? 0 : opts.readyPickCount;
  return {
    displayedPicks,
    pct: progressPct({
      legCount: displayedPicks,
      effectiveIndex: opts.effectiveIndex ?? 8,
    }),
    holding,
  };
}

function mockScan(
  pickCount: number,
  opts: { requestedLegs: number; requestId: string; scanComplete: boolean },
): BudgetHandoffScan {
  return {
    picks: { length: pickCount },
    requestedLegs: opts.requestedLegs,
    requestId: opts.requestId,
    scanComplete: opts.scanComplete,
  };
}

test("5-leg: first partials show cards and hit 100% (no empty hold)", () => {
  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: 2,
    scanComplete: false,
  });
  assert.equal(ui.holding, false);
  assert.equal(ui.displayedPicks, 2);
  assert.equal(ui.pct, 100);
});

test("5-leg: full count + complete shows all picks at 100%", () => {
  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: 5,
    scanComplete: true,
  });
  assert.equal(ui.holding, false);
  assert.equal(ui.displayedPicks, 5);
  assert.equal(ui.pct, 100);
});

test("5-leg: late budget complete still delivers full ticket", async () => {
  const partial2 = mockScan(2, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: false,
  });
  const partial4 = mockScan(4, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: false,
  });
  const final5 = mockScan(5, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: true,
  });

  const timeline = runBoardScanBudgetHandoffTimeline({
    requestedLegs: 5,
    partials: [partial2, partial4],
    raceWinner: null,
    latestAtRaceEnd: partial4,
    lateFinal: final5,
  });
  assert.equal(timeline.uiAfterLateFinal.pickCount, 5);
  assert.equal(timeline.uiAfterLateFinal.boardScanComplete, true);
  assert.equal(timeline.showsContinuesAfterLateFinal, false);

  const late = await awaitLateBoardScanAfterBudget(Promise.resolve(final5), {
    legTarget: 5,
    stillActive: () => true,
  });
  assert.equal(late?.picks?.length, 5);
  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: 5,
    scanComplete: true,
  });
  assert.equal(ui.displayedPicks, 5);
  assert.equal(ui.pct, 100);
});
