import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CRASH_MAX_BODY_BYTES,
  parseAndSanitizeCrashBody,
} from "../src/lib/reliabilitySanitize.ts";

test("abuse: oversized stacks are truncated; nested API dumps rejected", () => {
  const huge = "x".repeat(50_000);
  const event = parseAndSanitizeCrashBody({
    errorMessage: "boom",
    errorStack: huge,
    componentStack: huge,
    sessionId: "s_abcdef12",
    updateId: "u1",
    runtimeVersion: "1.1.0",
    channel: "production",
    appVersion: "1.1.0",
    platform: "ios",
  });
  assert.ok(event);
  assert.ok((event!.errorStack?.length ?? 0) < 2_000);
  assert.ok((event!.componentStack?.length ?? 0) < 1_400);

  assert.equal(
    parseAndSanitizeCrashBody({
      errorMessage: "boom",
      sessionId: "s_abcdef12",
      entitlement: { planId: "pro", token: "secret" },
    }),
    null,
  );
});

test("abuse: body byte budget is small enough for Render safety", () => {
  assert.ok(CRASH_MAX_BODY_BYTES <= 8_192);
  const approx = JSON.stringify({
    errorMessage: "a".repeat(400),
    errorStack: "b".repeat(1800),
    componentStack: "c".repeat(1200),
    sessionId: "s_abcdef12",
    updateId: "01a12704-7361-7771-b8e6-13a7bbc65cd0",
    runtimeVersion: "1.1.0",
    channel: "production",
    appVersion: "1.1.0",
    platform: "ios",
    clientTs: Date.now(),
  });
  assert.ok(Buffer.byteLength(approx, "utf8") <= CRASH_MAX_BODY_BYTES);
});
