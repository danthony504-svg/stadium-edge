import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isBlankReliabilityMeta,
  isKnownCrashTestFixture,
  mergeCrashMetadata,
} from "../src/lib/reliabilityCrashMeta.ts";
import {
  crashFingerprint,
  parseAndSanitizeCrashBody,
} from "../src/lib/reliabilitySanitize.ts";

test("mergeCrashMetadata fills blank update/runtime/channel/app only", () => {
  const { patch, enriched } = mergeCrashMetadata(
    {
      updateId: "—",
      runtimeVersion: "—",
      channel: "—",
      appVersion: "—",
      bundleSource: "unknown",
      componentStack: null,
    },
    {
      updateId: "01a1283b-9959-701e-aa25-63ef471e321f",
      runtimeVersion: "1.1.0",
      channel: "production",
      appVersion: "1.1.0",
      bundleSource: "ota",
      componentStack: "\n    in RootLayoutContent",
    },
  );
  assert.equal(enriched, true);
  assert.equal(patch.updateId?.startsWith("01a1283b"), true);
  assert.equal(patch.runtimeVersion, "1.1.0");
  assert.equal(patch.channel, "production");
  assert.equal(patch.appVersion, "1.1.0");
  assert.equal(patch.bundleSource, "ota");
  assert.match(patch.componentStack ?? "", /RootLayoutContent/);
});

test("mergeCrashMetadata never overwrites real fields with placeholders", () => {
  const { patch, enriched } = mergeCrashMetadata(
    {
      updateId: "01a11111-1111-1111-1111-111111111111",
      runtimeVersion: "1.1.0",
      channel: "production",
      appVersion: "1.1.0",
      bundleSource: "ota",
      componentStack: "\n    in Home",
    },
    {
      updateId: "—",
      runtimeVersion: "—",
      channel: "—",
      appVersion: "—",
      bundleSource: "unknown",
      componentStack: "",
    },
  );
  assert.equal(enriched, false);
  assert.deepEqual(patch, {});
});

test("blank meta helper", () => {
  assert.equal(isBlankReliabilityMeta("—"), true);
  assert.equal(isBlankReliabilityMeta("production"), false);
});

test("known test fixture defense-in-depth matches fp_3381f69b payload", () => {
  assert.equal(
    isKnownCrashTestFixture("startup-render-fail", "Error: startup-render-fail"),
    true,
  );
  assert.equal(
    crashFingerprint("startup-render-fail", "Error: startup-render-fail"),
    "fp_3381f69b",
  );
  assert.equal(
    isKnownCrashTestFixture(
      "Cannot convert undefined value to object",
      "TypeError\n    at ScoreBreakdown",
    ),
    false,
  );
});

test("parseAndSanitizeCrashBody rejects known test fixtures", () => {
  const rejected = parseAndSanitizeCrashBody({
    errorMessage: "startup-render-fail",
    errorStack: "Error: startup-render-fail",
    updateId: "—",
    runtimeVersion: "—",
    channel: "—",
    appVersion: "—",
    bundleSource: "unknown",
    platform: "ios",
    sessionId: "s_testfixture1",
    clientTs: Date.now(),
  });
  assert.equal(rejected, null);

  const accepted = parseAndSanitizeCrashBody({
    errorMessage: "Cannot convert undefined value to object",
    errorStack: "TypeError\n    at ScoreBreakdown",
    updateId: "01a12704-7361-7771-b8e6-13a7bbc65cd0",
    runtimeVersion: "1.1.0",
    channel: "production",
    appVersion: "1.1.0",
    bundleSource: "ota",
    platform: "ios",
    sessionId: "s_abc12345",
    clientTs: Date.now(),
  });
  assert.ok(accepted);
});

test("store enrichment path skips Telegram (source contract)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(
    join(process.cwd(), "src/lib/reliabilityCrashStore.ts"),
    "utf8",
  );
  assert.match(src, /mergeCrashMetadata/);
  assert.match(src, /enriched:\s*true/);
  assert.match(src, /alerted:\s*false/);
  // Enrichment return must not call sendCriticalAlertIfAllowed.
  const enrichIdx = src.indexOf("enriched && event.errorMessage === row.errorMessage");
  assert.ok(enrichIdx > 0);
  const enrichBlock = src.slice(enrichIdx, enrichIdx + 550);
  assert.equal(enrichBlock.includes("sendCriticalAlertIfAllowed"), false);
});
