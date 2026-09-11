/**
 * Pre-OTA proof: 5-leg board-scan display reaches 100% and shows all picks.
 *
 * Mirrors coach.tsx hold + AnalysisProgress finalize rules without changing
 * staging / qualification / simulation.
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

/** Same finalize rule AnalysisProgress uses for the % bar. */
function progressPct(opts: { legCount: number; effectiveIndex: number }): number {
  if (opts.legCount > 0) return 100;
  return TARGETS[Math.min(opts.effectiveIndex, TARGETS.length - 1)]!;
}

type UiTicket = {
  displayedPicks: number;
  scoredLegs: number;
  boardScanComplete: boolean;
  progressFinalizeLegs: number;
  pct: number;
  holding: boolean;
};

function applyScanWave(opts: {
  legTarget: number;
  readyPickCount: number;
  scanComplete: boolean;
  forceShowIncomplete?: boolean;
  effectiveIndex?: number;
}): UiTicket {
  const holding = shouldHoldIncompleteBoardScanPickDisplay({
    scanComplete: opts.scanComplete,
    legTarget: opts.legTarget,
    readyPickCount: opts.readyPickCount,
    forceShowIncomplete: opts.forceShowIncomplete,
  });
  const displayedPicks = holding ? 0 : opts.readyPickCount;
  // coach.tsx: while holding, do not feed stash counts into finalize legCount.
  const progressFinalizeLegs = holding ? 0 : displayedPicks;
  return {
    displayedPicks,
    scoredLegs: opts.readyPickCount,
    boardScanComplete: opts.scanComplete,
    progressFinalizeLegs,
    pct: progressPct({
      legCount: progressFinalizeLegs,
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

test("5-leg proof: under-count waves stay held below 100% with no pick cards", () => {
  for (const n of [1, 2, 3, 4]) {
    const ui = applyScanWave({
      legTarget: 5,
      readyPickCount: n,
      scanComplete: false,
      effectiveIndex: 7,
    });
    assert.equal(ui.holding, true, `wave ${n} should hold`);
    assert.equal(ui.displayedPicks, 0, `wave ${n} shows no cards`);
    assert.equal(ui.scoredLegs, n);
    assert.equal(ui.pct, 84, `wave ${n} still below finalize`);
    assert.ok(ui.pct < 100);
  }
});

test("5-leg proof: reaching requested count releases hold → 100% + all 5 picks", () => {
  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: 5,
    scanComplete: false,
    effectiveIndex: 8,
  });
  assert.equal(ui.holding, false);
  assert.equal(ui.displayedPicks, 5);
  assert.equal(ui.progressFinalizeLegs, 5);
  assert.equal(ui.pct, 100);
});

test("5-leg proof: scanComplete with full ticket → 100% + all picks once", () => {
  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: 5,
    scanComplete: true,
    effectiveIndex: 8,
  });
  assert.equal(ui.holding, false);
  assert.equal(ui.displayedPicks, 5);
  assert.equal(ui.pct, 100);
  assert.equal(ui.boardScanComplete, true);
});

test("5-leg proof: stall force-show releases under-count so UI is not empty forever", () => {
  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: 3,
    scanComplete: false,
    forceShowIncomplete: true,
    effectiveIndex: 8,
  });
  assert.equal(ui.holding, false);
  assert.equal(ui.displayedPicks, 3);
  assert.equal(ui.pct, 100);
});

test("5-leg proof: budget race null → late scanComplete delivers full ticket", async () => {
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
  assert.equal(timeline.uiAfterPartials.pickCount, 4);
  assert.equal(timeline.showsContinuesAfterRace, true);
  assert.equal(timeline.uiAfterLateFinal.pickCount, 5);
  assert.equal(timeline.uiAfterLateFinal.boardScanComplete, true);
  assert.equal(timeline.showsContinuesAfterLateFinal, false);

  const late = await awaitLateBoardScanAfterBudget(Promise.resolve(final5), {
    legTarget: 5,
    stillActive: () => true,
  });
  assert.ok(late);
  assert.equal(late!.picks?.length, 5);
  assert.equal(late!.scanComplete, true);

  const ui = applyScanWave({
    legTarget: 5,
    readyPickCount: late!.picks!.length,
    scanComplete: true,
  });
  assert.equal(ui.displayedPicks, 5);
  assert.equal(ui.pct, 100);
});

test("5-leg proof: full wave timeline ends at 100% with all picks displayed", () => {
  const waves = [2, 3, 4, 5];
  let last: UiTicket | null = null;
  for (const n of waves) {
    last = applyScanWave({
      legTarget: 5,
      readyPickCount: n,
      scanComplete: n === 5,
      effectiveIndex: 8,
    });
    if (n < 5) {
      assert.equal(last.displayedPicks, 0);
      assert.ok(last.pct < 100);
    }
  }
  assert.ok(last);
  assert.equal(last!.displayedPicks, 5);
  assert.equal(last!.pct, 100);
  assert.equal(last!.boardScanComplete, true);
});
