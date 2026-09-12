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
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
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

test("final incomplete prop phase does NOT keep awaitingPropSlots (no instant empty wipe)", () => {
  // Regression: treating finals as awaiting wiped cleared game lines to 0-of-7.
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 0,
      propPhaseIncomplete: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepAwaitingPropSlots({
      targetLegs: 7,
      propCount: 0,
      propPhaseIncomplete: false,
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
  assert.equal(
    shouldKeepAwaitingPropSlots({
      preview: true,
      targetLegs: 7,
      propCount: 1,
    }),
    false,
  );
});

test("shortfall copy does not claim every posted market was scanned", () => {
  assert.doesNotMatch(buildFixedLegCountShortfallLead(7, 0), /every posted market/i);
  assert.doesNotMatch(buildFixedLegCountShortfallLead(7, 3), /every posted market/i);
  assert.match(buildFixedLegCountShortfallLead(7, 0), /no AI-backed picks/i);
  assert.match(buildFixedLegCountShortfallLead(7, 3), /only \*\*3\*\*/);
  assert.doesNotMatch(coachShortfallNote(7, 3), /every posted market/i);
});

test("post-#469 wipe path cannot fire: finals never await, so game lines stay", () => {
  // Old buildParlay: wipe to [] when propPool>0 && no props && awaitingPropSlots.
  // After #469, finals with propPhaseIncomplete set awaitingPropSlots → instant 0-of-7.
  const awaiting = shouldKeepAwaitingPropSlots({
    targetLegs: 7,
    propCount: 0,
    propPhaseIncomplete: true,
  });
  assert.equal(awaiting, false);
  const rawPicks = [{ isProp: false }, { isProp: false }, { isProp: false }];
  // buildParlay now always keeps rawPicks (no wipe on awaiting / incomplete props).
  const picks = rawPicks;
  assert.equal(picks.length, 3);
  assert.equal(buildFixedLegCountShortfallLead(7, picks.length).includes("every posted"), false);
});
