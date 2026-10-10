import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CRASH_MAX_BODY_BYTES,
  crashFingerprint,
  parseAndSanitizeCrashBody,
  sanitizeReliabilityText,
} from "../src/lib/reliabilitySanitize.ts";

test("sanitizeReliabilityText strips emails, JWT, Bearer, RC keys", () => {
  const raw =
    "Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb dan@example.com appl_v1_abc123 pk_live_xyz odds_api_key=secret123";
  const cleaned = sanitizeReliabilityText(raw, 400);
  assert.equal(cleaned.includes("eyJhbGci"), false);
  assert.equal(cleaned.includes("dan@example.com"), false);
  assert.equal(cleaned.includes("appl_v1_abc123"), false);
  assert.equal(cleaned.includes("pk_live_xyz"), false);
  assert.equal(cleaned.includes("secret123"), false);
});

test("parseAndSanitizeCrashBody accepts valid envelope", () => {
  const event = parseAndSanitizeCrashBody({
    errorMessage: "Cannot convert undefined value to object",
    errorStack: "TypeError\n    at ScoreBreakdown",
    componentStack: "\n    in ScoreBreakdown",
    updateId: "01a12704-7361-7771-b8e6-13a7bbc65cd0",
    runtimeVersion: "1.1.0",
    channel: "production",
    appVersion: "1.1.0",
    bundleSource: "ota",
    platform: "ios",
    sessionId: "s_abc12345",
    clientTs: Date.now(),
    isEmbeddedLaunch: false,
    isEmergencyLaunch: false,
    failedLaunchCount: 0,
  });
  assert.ok(event);
  assert.equal(event!.runtimeVersion, "1.1.0");
  assert.equal(event!.channel, "production");
  assert.match(event!.fingerprint, /^fp_/);
  assert.equal(event!.sessionId, "s_abc12345");
});

test("parseAndSanitizeCrashBody rejects nested objects / missing session / empty message", () => {
  assert.equal(
    parseAndSanitizeCrashBody({
      errorMessage: "x",
      sessionId: "s_abc12345",
      payload: { odds: [1, 2, 3] },
    }),
    null,
  );
  assert.equal(
    parseAndSanitizeCrashBody({
      errorMessage: "x",
      sessionId: "bad",
    }),
    null,
  );
  assert.equal(
    parseAndSanitizeCrashBody({
      errorMessage: "",
      sessionId: "s_abc12345",
    }),
    null,
  );
  assert.equal(parseAndSanitizeCrashBody(null), null);
  assert.equal(parseAndSanitizeCrashBody([]), null);
});

test("fingerprint is stable for same message/stack head", () => {
  const a = crashFingerprint("boom", "at A\nat B\nat C\nat D\nat E");
  const b = crashFingerprint("boom", "at A\nat B\nat C\nat D\nat ZZZ");
  assert.equal(a, b);
  assert.notEqual(a, crashFingerprint("other", "at A\nat B\nat C\nat D"));
});

test("body size constant is bounded", () => {
  assert.ok(CRASH_MAX_BODY_BYTES <= 8192);
});

test("sanitize handles Unicode, unusual stacks, and nested secrets via reject", () => {
  const cleaned = sanitizeReliabilityText(
    "💥 boom café 東京\n    at Object.<anonymous> (native)\nBearer tok_abc",
    400,
  );
  assert.match(cleaned, /boom/);
  assert.equal(cleaned.includes("tok_abc"), false);
  assert.equal(
    parseAndSanitizeCrashBody({
      errorMessage: "nested-secret",
      sessionId: "s_abcdef12",
      meta: { Authorization: "Bearer nested" },
    }),
    null,
  );
  const weird = parseAndSanitizeCrashBody({
    errorMessage: "Hermes bytecode 0xdead",
    errorStack: "\u0000\n\tat eval (unknown:1:1)\n\tat 中国",
    sessionId: "s_abcdef12",
  });
  assert.ok(weird);
  assert.ok((weird!.errorStack?.length ?? 0) <= 1801);
});
