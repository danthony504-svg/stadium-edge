/**
 * Banner-trace formatting must tolerate missing/partial snapshots
 * (deep-link before hydration, AsyncStorage failure, missing manifests).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatOtaBannerTraceLines, type OtaBannerTraceSnapshot } from "./otaBannerTrace.ts";

function baseSnap(partial: Partial<OtaBannerTraceSnapshot> = {}): OtaBannerTraceSnapshot {
  return {
    at: "2026-10-12T00:00:00.000Z",
    otaIdentityFixVersion: 1,
    runningUpdateId: null,
    isEmbeddedLaunch: true,
    createdAt: "not available",
    runtimeVersion: "—",
    channel: "—",
    downloadedUpdateId: null,
    availableUpdateIdFromContext: null,
    availableUpdateIdFromCheck: null,
    checkResult: null,
    persistedReadyId: null,
    nativeIsUpdatePending: false,
    nativeIsDownloading: false,
    genuinelyPending: false,
    bannerVisible: false,
    bannerExpression: "bannerVisible = false",
    recoveryPending: false,
    recoveryReloadTargetId: "—",
    sessionNotes: [],
    ...partial,
  };
}

test("formatOtaBannerTraceLines: null snap", () => {
  assert.deepEqual(formatOtaBannerTraceLines(null), ["bannerTrace unavailable"]);
  assert.deepEqual(formatOtaBannerTraceLines(undefined), ["bannerTrace unavailable"]);
});

test("formatOtaBannerTraceLines: all ids null / missing manifests", () => {
  const lines = formatOtaBannerTraceLines(
    baseSnap({
      runningUpdateId: null,
      downloadedUpdateId: null,
      availableUpdateIdFromCheck: null,
      persistedReadyId: null,
      sessionNotes: undefined as unknown as string[],
    }),
  );
  assert.ok(lines.some((l) => l.includes("downloadedManifest.id: —")));
  assert.ok(lines.some((l) => l.includes("persisted @stadium/ota-update-ready: —")));
  assert.ok(lines.some((l) => l.includes("OTA_IDENTITY_FIX_VERSION: 1")));
});

test("formatOtaBannerTraceLines: deep-link cold launch notes", () => {
  const lines = formatOtaBannerTraceLines(
    baseSnap({
      sessionNotes: ["latestContext not hydrated yet", "expo-updates unavailable — banner trace using null fallbacks"],
    }),
  );
  assert.ok(lines.some((l) => l.includes("latestContext not hydrated yet")));
});
