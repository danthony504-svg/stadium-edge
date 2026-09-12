import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanGamePhaseBudgetMs,
  boardScanPropPhaseDeadlineMs,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";

test("prefetched prop pools overlap prop scoring with game lines", () => {
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120), true);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 0), false);
  assert.equal(shouldOverlapPropPhaseWithGames(false, 120), false);
  assert.equal(shouldOverlapPropPhaseWithGames(true, 120, true), false);
});

test("game-phase budget leaves room for prop-phase deadline inside Coach wall", () => {
  assert.equal(boardScanGamePhaseBudgetMs(7), 28_000);
  assert.equal(boardScanPropPhaseDeadlineMs(7), 45_000);
  assert.ok(boardScanGamePhaseBudgetMs(7) + boardScanPropPhaseDeadlineMs(7) > 60_000);
});
