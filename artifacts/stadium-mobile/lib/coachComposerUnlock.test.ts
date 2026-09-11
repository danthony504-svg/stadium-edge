import assert from "node:assert/strict";
import test from "node:test";

import {
  isFinishedCoachTicketOnScreen,
  shouldAllowCoachComposerSend,
  shouldUnlockCoachComposer,
} from "./coachComposerUnlock.ts";

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

test("frozen finished ticket unlocks sticky waiting after ticket", () => {
  assert.equal(
    isFinishedCoachTicketOnScreen({
      displayedPickCount: 6,
      ticketLegTarget: 6,
      boardScanComplete: true,
      ticketFrozen: true,
    }),
    true,
  );
  assert.equal(
    shouldUnlockCoachComposer({
      hasUserTurn: true,
      streaming: false,
      buildFinishing: true,
      waiting: true,
      assistantHasPicks: true,
      displayedPickCount: 6,
      ticketLegTarget: 6,
      boardScanComplete: true,
      hasScanManifest: false,
      ticketFrozen: true,
    }),
    true,
  );
});

test("after finished ticket, send is allowed even when busy flags stick", () => {
  assert.equal(
    shouldAllowCoachComposerSend({
      hasInput: true,
      coachBuildInFlight: true,
      isParlayBuildAsk: true,
      finishedTicketOnScreen: true,
    }),
    true,
  );
  assert.equal(
    shouldAllowCoachComposerSend({
      hasInput: true,
      coachBuildInFlight: true,
      isParlayBuildAsk: false,
      finishedTicketOnScreen: true,
    }),
    true,
  );
  assert.equal(
    shouldAllowCoachComposerSend({
      hasInput: true,
      coachBuildInFlight: true,
      isParlayBuildAsk: false,
      finishedTicketOnScreen: false,
    }),
    false,
  );
  assert.equal(
    shouldAllowCoachComposerSend({
      hasInput: false,
      coachBuildInFlight: false,
      isParlayBuildAsk: false,
      finishedTicketOnScreen: true,
    }),
    false,
  );
});
