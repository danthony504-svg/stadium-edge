import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanNonPropPreviewCap,
  boardScanPropSlotCount,
  buildFinalCoachParlayNote,
  selectFinalCoachParlayPicks,
  shouldKeepAwaitingPropSlots,
} from "./boardScanPropDelivery.ts";
import {
  boardScanGamePhaseBudgetMs,
  boardScanPropPhaseDeadlineMs,
  shouldOverlapPropPhaseWithGames,
} from "./boardScanScope.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
import { coachShortfallNote } from "./coach/session.ts";

/** Dead #469 wipe formula — kept only so the regression proves it stays dead. */
function buggyWipeOnAwaitingPropSlots<T extends { isProp?: boolean }>(
  rawPicks: T[],
  propPoolSize: number,
  awaitingPropSlots: boolean,
): T[] {
  const propLike = rawPicks.filter((p) => p.isProp).length;
  return propPoolSize > 0 && propLike === 0 && awaitingPropSlots ? [] : rawPicks;
}

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

test("phone 0-of-7 regression: incomplete props keep 3 game lines, honest note", () => {
  // Inputs matching the post-#469 phone failure: final scan, props incomplete,
  // 3 cleared F5/game lines, large prop pool, target 7.
  const rawPicks = [
    { isProp: false, market: "F5 totals" },
    { isProp: false, market: "F5 totals" },
    { isProp: false, market: "F5 totals" },
  ];
  const propPoolSize = 240;
  const awaitingOnFinal = shouldKeepAwaitingPropSlots({
    targetLegs: 7,
    propCount: 0,
    propPhaseIncomplete: true,
  });
  assert.equal(awaitingOnFinal, false);

  // Prove the old wipe would have produced the screenshot (0 legs).
  assert.equal(
    buggyWipeOnAwaitingPropSlots(rawPicks, propPoolSize, true).length,
    0,
  );

  const picks = selectFinalCoachParlayPicks(rawPicks);
  assert.equal(picks.length, 3);

  const note = buildFinalCoachParlayNote({
    target: 7,
    picks,
    propPoolSize,
    propsPending: true,
    shortfallLead: buildFixedLegCountShortfallLead(7, picks.length),
  });
  assert.match(note, /only \*\*3\*\*/);
  assert.match(note, /props did not finish scoring/i);
  assert.doesNotMatch(note, /every posted market/i);
  assert.doesNotMatch(note, /only \*\*0\*\*/);
});

test("empty final with incomplete props does not claim every market scanned", () => {
  const picks = selectFinalCoachParlayPicks([]);
  const note = buildFinalCoachParlayNote({
    target: 7,
    picks,
    propPoolSize: 240,
    propsPending: true,
    shortfallLead: buildFixedLegCountShortfallLead(7, 0),
  });
  assert.match(note, /no AI-backed picks/i);
  assert.match(note, /prop scoring did not finish/i);
  assert.doesNotMatch(note, /every posted market/i);
});
