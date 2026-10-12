/**
 * Crash-guards for /ota-debug — covers the exact failure modes that took down
 * stadium-mobile://ota-debug and router.push("/ota-debug").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildSafeRequiredFields,
  OTA_DEBUG_NULL,
  OTA_DEBUG_UNAVAILABLE,
  OTA_DEBUG_UNKNOWN,
  safeDiagText,
  safeFormatCreatedAt,
  safeLogLines,
  safeSpreadLines,
  safeUpdateIdText,
} from "./otaDebugGuards.ts";

const ROOT = process.cwd();

/** Historic crash: LogBlock did `lines.map` when lines was undefined. */
test("repro: undefined.lines.map throws TypeError (exact crash)", () => {
  const lines = undefined as unknown as string[];
  assert.throws(
    () => {
      // Same expression as the pre-fix LogBlock render path.
      lines.map((line, i) => `${i}-${String(line).slice(0, 24)}`);
    },
    (err: unknown) => {
      assert.ok(err instanceof TypeError);
      const msg = err.message;
      // V8: "Cannot read properties of undefined (reading 'map')"
      // JSC: "undefined is not an object (evaluating 'lines.map')"
      assert.match(msg, /map|undefined|null|object/i);
      console.log("EXACT_CRASH_STACK:\n", err.stack);
      return true;
    },
  );
});

/** Historic crash: buildReport spread `...diag.bannerTraceLines` when undefined. */
test("repro: spread undefined bannerTraceLines throws", () => {
  const bannerTraceLines = undefined as unknown as string[];
  assert.throws(
    () => {
      void ["header", ...bannerTraceLines].join("\n");
    },
    (err: unknown) => {
      assert.ok(err instanceof TypeError);
      console.log("EXACT_SPREAD_CRASH_STACK:\n", (err as Error).stack);
      return true;
    },
  );
});

test("safeLogLines: all values null / undefined never throws", () => {
  assert.deepEqual(safeLogLines(undefined), ["(none)"]);
  assert.deepEqual(safeLogLines(null), ["(none)"]);
  assert.deepEqual(safeLogLines([]), ["(none)"]);
  assert.deepEqual(safeLogLines(["a", null, undefined]), ["a", "(none)", "(none)"]);
});

test("safeSpreadLines: missing manifest log arrays are iterable", () => {
  assert.ok(Array.isArray(safeSpreadLines(undefined)));
  assert.equal([...safeSpreadLines(undefined)].length >= 1, true);
});

test("buildSafeRequiredFields: all values present", () => {
  const fields = buildSafeRequiredFields({
    updateId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    isEmbeddedLaunch: false,
    createdAt: "2026-10-01T12:00:00.000Z",
    runtimeVersion: "1.1.0",
    channel: "production",
    checkAvailableUpdateId: "ffffffff-1111-2222-3333-444444444444",
    downloadedUpdateId: "ffffffff-1111-2222-3333-444444444444",
    persistedReadyId: "ffffffff-1111-2222-3333-444444444444",
    isUpdatePending: true,
    recoveryPending: false,
    bannerExpression: "bannerVisible = true",
    otaIdentityFixVersion: 1,
    contextHydrated: true,
  });
  assert.equal(fields.updateId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(fields.isEmbeddedLaunch, "false");
  assert.equal(fields.createdAt, "2026-10-01T12:00:00.000Z");
  assert.equal(fields.runtimeVersion, "1.1.0");
  assert.equal(fields.channel, "production");
  assert.equal(fields.checkAvailableUpdateId, "ffffffff-1111-2222-3333-444444444444");
  assert.equal(fields.downloadedUpdateId, "ffffffff-1111-2222-3333-444444444444");
  assert.equal(fields.persistedReadyId, "ffffffff-1111-2222-3333-444444444444");
  assert.equal(fields.isUpdatePending, "true");
  assert.equal(fields.recoveryPending, "false");
  assert.equal(fields.bannerExpression, "bannerVisible = true");
  assert.equal(fields.otaIdentityFixVersion, "1");
});

test("buildSafeRequiredFields: all values null", () => {
  const fields = buildSafeRequiredFields({
    updateId: null,
    isEmbeddedLaunch: null,
    createdAt: null,
    runtimeVersion: null,
    channel: null,
    checkAvailableUpdateId: null,
    downloadedUpdateId: null,
    persistedReadyId: null,
    isUpdatePending: null,
    recoveryPending: null,
    bannerExpression: null,
    otaIdentityFixVersion: null,
    contextHydrated: true,
  });
  assert.equal(fields.updateId, OTA_DEBUG_NULL);
  assert.equal(fields.isEmbeddedLaunch, OTA_DEBUG_UNKNOWN);
  assert.equal(fields.createdAt, OTA_DEBUG_UNAVAILABLE);
  assert.equal(fields.runtimeVersion, OTA_DEBUG_UNKNOWN);
  assert.equal(fields.channel, OTA_DEBUG_UNKNOWN);
  assert.equal(fields.checkAvailableUpdateId, OTA_DEBUG_NULL);
  assert.equal(fields.downloadedUpdateId, OTA_DEBUG_NULL);
  assert.equal(fields.persistedReadyId, OTA_DEBUG_NULL);
  assert.equal(fields.isUpdatePending, OTA_DEBUG_UNKNOWN);
  assert.equal(fields.recoveryPending, OTA_DEBUG_UNKNOWN);
  assert.equal(fields.bannerExpression, OTA_DEBUG_UNAVAILABLE);
  assert.equal(fields.otaIdentityFixVersion, OTA_DEBUG_UNAVAILABLE);
});

test("buildSafeRequiredFields: context not hydrated yet (deep-link cold launch)", () => {
  const fields = buildSafeRequiredFields({
    updateId: null,
    isEmbeddedLaunch: null,
    isUpdatePending: null,
    contextHydrated: false,
  });
  assert.match(fields.updateId, /context not hydrated/);
  assert.match(fields.isEmbeddedLaunch, /context not hydrated/);
  assert.match(fields.isUpdatePending, /context not hydrated/);
});

test("buildSafeRequiredFields: missing manifest IDs", () => {
  const fields = buildSafeRequiredFields({
    updateId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    downloadedUpdateId: undefined,
    checkAvailableUpdateId: "",
    persistedReadyId: "—",
    contextHydrated: true,
  });
  assert.equal(fields.downloadedUpdateId, OTA_DEBUG_NULL);
  assert.equal(fields.checkAvailableUpdateId, OTA_DEBUG_NULL);
  assert.equal(fields.persistedReadyId, OTA_DEBUG_NULL);
});

test("safeFormatCreatedAt: Invalid Date / null never throws", () => {
  assert.equal(safeFormatCreatedAt(null), OTA_DEBUG_UNAVAILABLE);
  assert.equal(safeFormatCreatedAt(new Date("not-a-date")), OTA_DEBUG_UNAVAILABLE);
  assert.equal(safeFormatCreatedAt("2026-01-02T03:04:05.000Z"), "2026-01-02T03:04:05.000Z");
});

test("safeUpdateIdText: embedded / pending / blank", () => {
  assert.equal(safeUpdateIdText(null), OTA_DEBUG_NULL);
  assert.equal(safeUpdateIdText("embedded"), "embedded");
  assert.equal(
    safeUpdateIdText(null, { embeddedFallback: true, isEmbeddedLaunch: true }),
    "embedded",
  );
});

test("safeDiagText never throws on exotic values", () => {
  assert.equal(safeDiagText(undefined), OTA_DEBUG_UNAVAILABLE);
  assert.equal(safeDiagText({}), OTA_DEBUG_UNAVAILABLE);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.equal(typeof safeDiagText(cyclic), "string");
});

test("AsyncStorage read failure shape: persisted ready id falls back to null text", () => {
  // Mimic readPersistedOtaReadyId catch → null, then screen field mapping.
  const persistedReadyId: string | null = null; // AsyncStorage threw
  const fields = buildSafeRequiredFields({ persistedReadyId });
  assert.equal(fields.persistedReadyId, OTA_DEBUG_NULL);
});

test("/ota-debug static import graph must not evaluate expo-updates", () => {
  const files = [
    "app/ota-debug.tsx",
    "lib/otaDebug.ts",
    "lib/otaBannerTrace.ts",
    "lib/expoUpdatesAccess.ts",
    "lib/otaDebugGuards.ts",
  ];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.doesNotMatch(
      src,
      /(?:^|\n)\s*import\s[^;]*from\s*["']expo-updates["']/,
      `${rel} must not statically import expo-updates (deep-link module-eval crash)`,
    );
    assert.doesNotMatch(
      src,
      /(?:^|\n)\s*import\s+\*\s+as\s+\w+\s+from\s*["']expo-updates["']/,
      `${rel} must not namespace-import expo-updates`,
    );
  }
  const access = readFileSync(join(ROOT, "lib/expoUpdatesAccess.ts"), "utf8");
  assert.match(access, /require\(["']expo-updates["']\)/, "lazy require must remain");
});
