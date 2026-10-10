import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  _resetCrashReporterForTests,
  buildCrashEnvelope,
  getAnonymousSessionId,
  reportCrash,
} from "./crashReporter.ts";

test("buildCrashEnvelope sanitizes secrets and keeps OTA fields", () => {
  _resetCrashReporterForTests();
  const env = buildCrashEnvelope({
    errorMessage: "Cannot convert undefined value to object Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
    errorStack: "TypeError\n    at ScoreBreakdown\nAuthorization: Bearer secrettokenvalue\ndan@example.com\nappl_v1_abc123XYZ",
    componentStack: "\n    in ScoreBreakdown\n    in PickCard",
    appVersion: "1.1.0",
    ota: {
      updateId: "01a12704-7361-7771-b8e6-13a7bbc65cd0",
      runtimeVersion: "1.1.0",
      channel: "production",
      bundleSource: "ota",
      isEmbeddedLaunch: false,
      isEmergencyLaunch: false,
      updatePreviouslyFailed: false,
      failedLaunchCount: 0,
    },
  });
  assert.equal(env.updateId.includes("01a12704"), true);
  assert.equal(env.runtimeVersion, "1.1.0");
  assert.equal(env.channel, "production");
  assert.equal(env.appVersion, "1.1.0");
  assert.equal(env.platform, "ios");
  assert.match(env.sessionId, /^s_/);
  assert.equal(typeof env.clientTs, "number");
  assert.equal(env.errorMessage.includes("eyJhbGci"), false);
  assert.equal(env.errorStack.includes("dan@example.com"), false);
  assert.equal(env.errorStack.includes("secrettokenvalue"), false);
  assert.equal(env.errorStack.includes("appl_v1_abc123XYZ"), false);
  assert.match(env.errorMessage, /Cannot convert undefined/);
  assert.match(env.errorStack, /ScoreBreakdown/);
  assert.match(env.errorStack, /\[redacted\]/);
});

test("anonymous session id is stable within process", () => {
  _resetCrashReporterForTests();
  const a = getAnonymousSessionId();
  const b = getAnonymousSessionId();
  assert.equal(a, b);
  assert.ok(a.length >= 10);
});

test("reportCrash is nonblocking and never throws; dedupes identical crashes", async () => {
  _resetCrashReporterForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  }) as typeof fetch;
  try {
    assert.doesNotThrow(() =>
      reportCrash({
        errorMessage: "boom-test-unique",
        errorStack: "Error: boom-test-unique\n    at test",
      }),
    );
    reportCrash({
      errorMessage: "boom-test-unique",
      errorStack: "Error: boom-test-unique\n    at test",
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1, "client dedupe must send at most one POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportCrash does not read backend secrets from process.env", () => {
  _resetCrashReporterForTests();
  const keys = [
    "TELEGRAM_BOT_TOKEN",
    "RELIABILITY_INGEST_SECRET",
    "SENTRY_AUTH_TOKEN",
    "NOTIFY_CRON_KEY",
  ];
  const file = readFileSync(join(process.cwd(), "lib/crashReporter.ts"), "utf8");
  for (const key of keys) {
    assert.equal(file.includes(key), false, `must not mention ${key}`);
  }
});
