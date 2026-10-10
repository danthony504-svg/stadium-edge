import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCriticalCrashAlert,
  formatDailyHealthySummary,
  sendTelegramMessage,
  shouldSendCriticalTelegram,
  telegramConfigured,
} from "../src/lib/telegramAlert.ts";

test("telegramConfigured requires token + chat and respects disable flag", () => {
  assert.equal(telegramConfigured({}), false);
  assert.equal(
    telegramConfigured({
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      TELEGRAM_CHAT_ID: "-100123",
    }),
    true,
  );
  assert.equal(
    telegramConfigured({
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      TELEGRAM_CHAT_ID: "-100123",
      RELIABILITY_TELEGRAM_ENABLED: "0",
    }),
    false,
  );
});

test("shouldSendCriticalTelegram respects dedupe window", () => {
  const now = Date.parse("2026-10-10T18:00:00.000Z");
  assert.equal(
    shouldSendCriticalTelegram({
      lastAlertedAt: null,
      nowMs: now,
      dedupeWindowMs: 30 * 60 * 1000,
    }),
    true,
  );
  assert.equal(
    shouldSendCriticalTelegram({
      lastAlertedAt: new Date(now - 5 * 60 * 1000),
      nowMs: now,
      dedupeWindowMs: 30 * 60 * 1000,
    }),
    false,
  );
  assert.equal(
    shouldSendCriticalTelegram({
      lastAlertedAt: new Date(now - 31 * 60 * 1000),
      nowMs: now,
      dedupeWindowMs: 30 * 60 * 1000,
    }),
    true,
  );
});

test("formatCriticalCrashAlert and daily healthy summary", () => {
  const critical = formatCriticalCrashAlert({
    fingerprint: "fp_deadbeef",
    errorMessage: "Cannot convert undefined value to object",
    updateId: "01a12704-7361-7771-b8e6-13a7bbc65cd0",
    runtimeVersion: "1.1.0",
    channel: "production",
    appVersion: "1.1.0",
    platform: "ios",
    occurrenceCount: 3,
  });
  assert.match(critical, /critical crash/);
  assert.match(critical, /fp_deadbeef/);
  assert.match(critical, /01a12704/);
  assert.match(critical, /occurrences: 3/);

  const healthy = formatDailyHealthySummary({
    windowHours: 24,
    criticalCount: 0,
    distinctFingerprints: 0,
    lastCriticalAt: null,
  });
  assert.match(healthy, /healthy/);
  assert.match(healthy, /0 critical/);

  const summary = formatDailyHealthySummary({
    windowHours: 24,
    criticalCount: 2,
    distinctFingerprints: 1,
    lastCriticalAt: "2026-10-10T12:00:00.000Z",
  });
  assert.match(summary, /daily summary/);
  assert.match(summary, /2 critical/);
});

test("sendTelegramMessage skips when unset; posts when configured", async () => {
  const skipped = await sendTelegramMessage("hi", {});
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);

  let called = 0;
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    called += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(body.chat_id, "-1001");
    assert.match(body.text, /hi/);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const sent = await sendTelegramMessage(
    "hi",
    {
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEFGH",
      TELEGRAM_CHAT_ID: "-1001",
    },
    fakeFetch,
  );
  assert.equal(sent.ok, true);
  assert.equal(sent.skipped, undefined);
  assert.equal(called, 1);
});
