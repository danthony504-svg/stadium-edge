import assert from "node:assert/strict";
import test from "node:test";

import { shouldUnlockCoachComposer } from "./coachComposerUnlock.ts";

test("unlocks when completed ticket picks are on screen but streaming stuck", () => {
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: true,
      buildFinishing: false,
      waiting: false,
      assistantHasPicks: true,
      boardScanComplete: true,
      hasScanManifest: false,
    }),
    true,
  );
});

test("unlocks when full-count ticket is on screen even if scan still finishing", () => {
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: true,
      buildFinishing: false,
      waiting: false,
      assistantHasPicks: true,
      displayedPickCount: 9,
      ticketLegTarget: 9,
      boardScanComplete: false,
      stashScanComplete: false,
      hasScanManifest: false,
      liveScanDelivered: false,
    }),
    true,
  );
});

test("does not unlock mid-scan under-count sticky picks", () => {
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: true,
      buildFinishing: false,
      waiting: false,
      assistantHasPicks: true,
      displayedPickCount: 4,
      ticketLegTarget: 9,
      boardScanComplete: false,
      stashScanComplete: false,
      hasScanManifest: false,
      liveScanDelivered: false,
    }),
    false,
  );
});

test("no-op when already idle", () => {
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: false,
      buildFinishing: false,
      waiting: false,
      assistantHasPicks: true,
      boardScanComplete: true,
      hasScanManifest: true,
    }),
    false,
  );
});
