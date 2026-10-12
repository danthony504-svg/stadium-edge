/**
 * Banner-loop guards: same update id as running must never show "App update ready".
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isGenuinelyPendingOtaUpdate,
  isNewerThanRunningUpdate,
  normalizeOtaUpdateId,
  OTA_IDENTITY_FIX_VERSION,
  otaUpdateIdsEqual,
  parseOtaReadyFlag,
  reconcileOtaReadyFlag,
} from "./otaUpdateIdentity.ts";

test("OTA_IDENTITY_FIX_VERSION marker is 1", () => {
  assert.equal(OTA_IDENTITY_FIX_VERSION, 1);
});

const RUNNING = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NEWER = "ffffffff-1111-2222-3333-444444444444";

test("normalizeOtaUpdateId lowercases and drops placeholders", () => {
  assert.equal(normalizeOtaUpdateId(RUNNING.toUpperCase()), RUNNING);
  assert.equal(normalizeOtaUpdateId("embedded"), null);
  assert.equal(normalizeOtaUpdateId("pending"), null);
  assert.equal(normalizeOtaUpdateId("—"), null);
  assert.equal(normalizeOtaUpdateId(""), null);
});

test("otaUpdateIdsEqual is case-insensitive", () => {
  assert.equal(otaUpdateIdsEqual(RUNNING, RUNNING.toUpperCase()), true);
  assert.equal(otaUpdateIdsEqual(RUNNING, NEWER), false);
  assert.equal(otaUpdateIdsEqual(null, RUNNING), false);
});

test("no update / not pending → banner hidden", () => {
  assert.equal(
    isGenuinelyPendingOtaUpdate({
      runningUpdateId: RUNNING,
      downloadedUpdateId: null,
      isUpdatePending: false,
    }),
    false,
  );
});

test("downloaded id === running id → banner hidden even if native pending stuck", () => {
  assert.equal(
    isGenuinelyPendingOtaUpdate({
      runningUpdateId: RUNNING,
      downloadedUpdateId: RUNNING,
      isUpdatePending: true,
    }),
    false,
  );
  assert.equal(
    isGenuinelyPendingOtaUpdate({
      runningUpdateId: RUNNING.toUpperCase(),
      downloadedUpdateId: RUNNING,
      isUpdatePending: true,
    }),
    false,
  );
});

test("available id === running id → banner hidden", () => {
  assert.equal(
    isGenuinelyPendingOtaUpdate({
      runningUpdateId: RUNNING,
      availableUpdateId: RUNNING,
      isUpdatePending: true,
    }),
    false,
  );
});

test("genuinely newer downloaded update → banner shown", () => {
  assert.equal(
    isGenuinelyPendingOtaUpdate({
      runningUpdateId: RUNNING,
      downloadedUpdateId: NEWER,
      isUpdatePending: true,
    }),
    true,
  );
});

test("embedded launch with pending download → banner shown", () => {
  assert.equal(
    isGenuinelyPendingOtaUpdate({
      runningUpdateId: null,
      downloadedUpdateId: NEWER,
      isUpdatePending: true,
    }),
    true,
  );
});

test("isNewerThanRunningUpdate rejects same id; allows rollback and unknown", () => {
  assert.equal(
    isNewerThanRunningUpdate({
      runningUpdateId: RUNNING,
      candidateUpdateId: RUNNING,
    }),
    false,
  );
  assert.equal(
    isNewerThanRunningUpdate({
      runningUpdateId: RUNNING,
      candidateUpdateId: NEWER,
    }),
    true,
  );
  assert.equal(
    isNewerThanRunningUpdate({
      runningUpdateId: RUNNING,
      isRollBackToEmbedded: true,
      candidateUpdateId: RUNNING,
    }),
    true,
  );
  assert.equal(
    isNewerThanRunningUpdate({
      runningUpdateId: RUNNING,
      candidateUpdateId: null,
    }),
    true,
  );
});

test("reconcileOtaReadyFlag clears when running matches ready id", () => {
  const flag = { readyUpdateId: RUNNING, markedAt: 1 };
  assert.equal(reconcileOtaReadyFlag(flag, RUNNING), null);
  assert.deepEqual(reconcileOtaReadyFlag(flag, NEWER), flag);
  assert.equal(reconcileOtaReadyFlag(null, RUNNING), null);
});

test("parseOtaReadyFlag rejects junk; failed apply does not invent a flag", () => {
  assert.equal(parseOtaReadyFlag(null), null);
  assert.equal(parseOtaReadyFlag("{"), null);
  assert.equal(parseOtaReadyFlag(JSON.stringify({ readyUpdateId: "embedded", markedAt: 1 })), null);
  assert.deepEqual(
    parseOtaReadyFlag(JSON.stringify({ readyUpdateId: RUNNING, markedAt: 99 })),
    { readyUpdateId: RUNNING, markedAt: 99 },
  );
});
