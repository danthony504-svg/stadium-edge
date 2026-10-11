import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  runReliabilityHealthChecks,
  summarizeHealthChecks,
  type HealthCheckId,
} from "../src/lib/reliabilityHealthChecks.ts";
import {
  formatHealthFailureAlert,
  formatHealthRecoveryAlert,
  shouldSendCriticalTelegram,
} from "../src/lib/telegramAlert.ts";

test("forceFail synthetic failures mark checks failed without network", async () => {
  const forceFail: Partial<Record<HealthCheckId, string>> = {
    website: "synthetic-website-down",
    api: "synthetic-api-down",
    ssl: "synthetic-ssl-fail",
    response_time: "synthetic-slow",
    database: "synthetic-db-down",
    odds_feed: "synthetic-odds-down",
    player_props: "synthetic-props-down",
    ai_coach: "synthetic-ai-down",
    game_simulator: "synthetic-sim-down",
    steals_scanner: "synthetic-steals-down",
  };
  const checks = await runReliabilityHealthChecks({
    forceFail,
    fetchFn: (async () => {
      throw new Error("fetch should not be called when forceFail set for all");
    }) as typeof fetch,
  });
  const summary = summarizeHealthChecks(checks);
  assert.equal(summary.ok, false);
  assert.equal(summary.failed.length, 10);
  for (const id of Object.keys(forceFail) as HealthCheckId[]) {
    const row = checks.find((c) => c.id === id);
    assert.ok(row);
    assert.equal(row!.ok, false);
    assert.match(row!.detail, /synthetic/);
  }
});

test("health alert formatters and dedupe helper", () => {
  const fail = formatHealthFailureAlert({
    checkId: "odds_feed",
    detail: "odds http 502",
    latencyMs: 900,
    httpStatus: 502,
    occurrenceCount: 3,
  });
  assert.match(fail, /health check FAILED/);
  assert.match(fail, /odds_feed/);
  assert.match(fail, /occurrences: 3/);

  const recover = formatHealthRecoveryAlert({
    checkId: "odds_feed",
    detail: "odds ok games=12",
    latencyMs: 400,
  });
  assert.match(recover, /RECOVERED/);
  assert.match(recover, /odds_feed/);

  const now = Date.parse("2026-10-11T04:00:00.000Z");
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

test("health cron workflow is scheduled every ~90 minutes with secret key", () => {
  const src = readFileSync(
    join(process.cwd(), "../../.github/workflows/reliability-health-cron.yml"),
    "utf8",
  );
  assert.match(src, /schedule:/);
  assert.match(src, /0 0,3,6,9,12,15,18,21/);
  assert.match(src, /30 1,4,7,10,13,16,19,22/);
  assert.match(src, /NOTIFY_CRON_KEY/);
  assert.match(src, /reliability\/cron\/health/);
  assert.equal(src.includes("EXPO_PUBLIC_"), false);
});

test("digest cron workflow documents schedule + uses secret", () => {
  const src = readFileSync(
    join(process.cwd(), "../../.github/workflows/reliability-digest-cron.yml"),
    "utf8",
  );
  assert.match(src, /0 13 \* \* \*/);
  assert.match(src, /NOTIFY_CRON_KEY/);
  assert.match(src, /reliability\/cron\/digest/);
  assert.match(src, /default branch/);
});
