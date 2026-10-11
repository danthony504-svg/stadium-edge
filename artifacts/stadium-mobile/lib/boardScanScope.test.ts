import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanFootballMixOverlapGameBudgetMs,
  boardScanGamePhaseBudgetMs,
  boardScanMaxPropsToSimForMix,
  boardScanPropPhaseDeadlineMs,
  boardScanPropSimBatchTimeoutMs,
  shouldOverlapFootballMixSims,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";

test("prefetched prop pools overlap prop scoring with game lines", () => {
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120), true);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 0), false);
  assert.equal(shouldOverlapPropPhaseWithGames(false, 120), false);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120, true), false);
});

test("football mix overlaps prop∥game sims with finishable ≤72 deep-sim cap", () => {
  assert.equal(shouldOverlapFootballMixSims(true, false, 500), true);
  assert.equal(boardScanMaxPropsToSimForMix(9, 5000), 72);
  assert.equal(
    boardScanFootballMixOverlapGameBudgetMs(9, 110_000, 4_000),
    36_000,
  );
});

test("game-phase budget leaves room for prop-phase deadline inside Coach wall", () => {
  assert.equal(boardScanGamePhaseBudgetMs(7), 28_000);
  assert.equal(boardScanPropPhaseDeadlineMs(7), 65_000);
  assert.ok(boardScanGamePhaseBudgetMs(7) + boardScanPropPhaseDeadlineMs(7) > 60_000);
});

test("8-leg prop phase allows multiple batches (batch timeout << phase)", () => {
  assert.equal(boardScanPropPhaseDeadlineMs(8), 75_000);
  assert.ok(boardScanPropSimBatchTimeoutMs() * 2 < boardScanPropPhaseDeadlineMs(8));
});

test("HR exhaust boards get a longer prop-phase deadline", () => {
  assert.equal(boardScanPropPhaseDeadlineMs(3), 40_000);
  assert.equal(boardScanPropPhaseDeadlineMs(3, { exhaustPropBoard: true }), 55_000);
  assert.equal(boardScanPropPhaseDeadlineMs(6, { exhaustPropBoard: true }), 75_000);
});
