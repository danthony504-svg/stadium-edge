import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanNonPropPreviewCap,
  boardScanPropSlotCount,
  shouldKeepAwaitingPropSlots,
} from "./boardScanPropDelivery.ts";
import {
  boardScanGamePhaseBudgetMs,
  boardScanPropPhaseDeadlineMs,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";
import { coachShortfallNote } from "./coach/session.ts";

test("5-leg reserved prop slots leave exactly 2 game-line preview capacity", () => {
  assert.equal(boardScanPropSlotCount(5), 3);
  assert.equal(boardScanNonPropPreviewCap(5), 2);
});

test("7-leg reserved prop slots leave exactly 3 game-line preview capacity", () => {
  assert.equal(boardScanPropSlotCount(7), 4);
  assert.equal(boardScanNonPropPreviewCap(7), 3);
});

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

test("incomplete prop phase keeps awaitingPropSlots on game-line-only finals", () => {
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 0,
      propPhaseIncomplete: true,
    }),
    true,
  );
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 0,
      propPhaseIncomplete: false,
    }),
    false,
  );
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 2,
      propPhaseIncomplete: true,
    }),
    false,
  );
});

test("preview with zero props awaits prop slots", () => {
  assert.equal(
    shouldKeepAwaitingPropSlots({
      preview: true,
      targetLegs: 7,
      propCount: 0,
    }),
    true,
  );
});

test("shortfall copy does not claim every posted market was scanned", () => {
  const note = coachShortfallNote(7, 3);
  assert.match(note, /only \*\*3\*\*/);
  assert.doesNotMatch(note, /every posted market/i);
  assert.doesNotMatch(note, /every market was scanned/i);
});
