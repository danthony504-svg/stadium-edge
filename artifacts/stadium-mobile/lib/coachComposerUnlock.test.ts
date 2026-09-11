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

test("does not unlock mid-scan sticky picks before scanComplete", () => {
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: true,
      buildFinishing: false,
      waiting: false,
      assistantHasPicks: true,
      boardScanComplete: false,
      stashScanComplete: false,
      hasScanManifest: false,
      liveScanDelivered: false,
    }),
    false,
  );
});

test("unlocks empty complete with scan manifest", () => {
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: true,
      buildFinishing: false,
      waiting: true,
      assistantHasPicks: false,
      boardScanComplete: true,
      stashScanComplete: true,
      hasScanManifest: true,
    }),
    true,
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
