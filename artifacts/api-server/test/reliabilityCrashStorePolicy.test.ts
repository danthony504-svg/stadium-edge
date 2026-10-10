import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  allowTelegramWithoutSharedDedupe,
  RELIABILITY_HOURLY_OCCURRENCE_BUDGET,
  reliabilitySecurityModelSummary,
} from "../src/lib/reliabilityPolicy.ts";
import { shouldSendCriticalTelegram } from "../src/lib/telegramAlert.ts";
import { crashFingerprint } from "../src/lib/reliabilitySanitize.ts";

test("policy: Telegram is forbidden when shared dedupe is unavailable", () => {
  assert.equal(allowTelegramWithoutSharedDedupe(), false);
});

test("store catch path does not call sendTelegramMessage on DB failure", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/reliabilityCrashStore.ts"),
    "utf8",
  );
  // The catch block must not invoke Telegram — only the shared-dedupe helper may.
  const catchIdx = src.indexOf(
    'logger.warn({ err }, "reliability crash ingest store failed")',
  );
  assert.ok(catchIdx > 0);
  const afterCatch = src.slice(catchIdx, catchIdx + 450);
  assert.equal(afterCatch.includes("sendTelegramMessage("), false);
  assert.match(afterCatch, /allowTelegramWithoutSharedDedupe/);
  assert.match(afterCatch, /shed:\s*true/);
});

test("repeated fingerprints respect Telegram quiet window", () => {
  const now = Date.parse("2026-10-10T18:00:00.000Z");
  assert.equal(
    shouldSendCriticalTelegram({
      lastAlertedAt: new Date(now - 60_000),
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

test("high concurrency: identical fingerprints collapse to one fp key", () => {
  const fps = Array.from({ length: 200 }, () =>
    crashFingerprint("Same boom", "at A\nat B\nat C\nat D"),
  );
  assert.equal(new Set(fps).size, 1);
});

test("security model: no Redis ⇒ per-instance IP limits; PG scopes shared", () => {
  const model = reliabilitySecurityModelSummary({} as NodeJS.ProcessEnv);
  assert.equal(model.redisConfigured, false);
  assert.equal(model.ipRateLimitScope, "per-instance-memory");
  assert.equal(model.fingerprintDedupeScope, "postgresql");
  assert.equal(model.hourlyBudgetScope, "postgresql");
  assert.equal(model.multiInstanceSafeWithoutRedis, false);

  const withRedis = reliabilitySecurityModelSummary({
    REDIS_URL: "redis://example.internal:6379",
  } as NodeJS.ProcessEnv);
  assert.equal(withRedis.redisConfigured, true);
  assert.equal(withRedis.ipRateLimitScope, "shared-redis");
});

test("hourly occurrence budget is bounded", () => {
  assert.ok(RELIABILITY_HOURLY_OCCURRENCE_BUDGET <= 500);
  assert.ok(RELIABILITY_HOURLY_OCCURRENCE_BUDGET >= 50);
});
