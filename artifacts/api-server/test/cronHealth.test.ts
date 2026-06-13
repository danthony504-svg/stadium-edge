import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRON_STALE_AFTER_MS,
  deriveCronHealth,
} from "../src/lib/cronHealth.ts";

// Fixed "now" so age math is deterministic.
const NOW = Date.parse("2026-06-13T12:00:00.000Z");

test("never-run: no heartbeat => everRan=false, stale=true, nulls", () => {
  for (const hb of [undefined, null]) {
    const h = deriveCronHealth(hb, NOW);
    assert.equal(h.everRan, false, "everRan must be false when nothing ran");
    assert.equal(h.stale, true, "missing heartbeat must read as stale");
    assert.equal(h.lastRunAt, null);
    assert.equal(h.ageMs, null);
    assert.equal(h.ageMinutes, null);
    assert.equal(h.summary, null);
  }
});

test("malformed heartbeat (no numeric `at`) is treated as never-run", () => {
  const h = deriveCronHealth({ at: undefined as unknown as number, summary: {} }, NOW);
  assert.equal(h.everRan, false);
  assert.equal(h.stale, true);
  assert.equal(h.lastRunAt, null);
});

test("fresh run: recent heartbeat => everRan=true, stale=false", () => {
  const at = NOW - 5 * 60 * 1000; // 5 min ago, well inside the window
  const h = deriveCronHealth({ at, summary: { sent: 3, coachSwept: 1 } }, NOW);
  assert.equal(h.everRan, true);
  assert.equal(h.stale, false, "a run inside CRON_STALE_AFTER_MS is healthy");
  assert.equal(h.lastRunAt, new Date(at).toISOString());
  assert.equal(h.ageMs, 5 * 60 * 1000);
  assert.equal(h.ageMinutes, 5);
  assert.deepEqual(h.summary, { sent: 3, coachSwept: 1 });
});

test("stale run: heartbeat older than CRON_STALE_AFTER_MS => stale=true, everRan=true", () => {
  const at = NOW - (CRON_STALE_AFTER_MS + 60 * 1000); // 1 min past the window
  const h = deriveCronHealth({ at, summary: {} }, NOW);
  assert.equal(h.everRan, true, "a real run was recorded — not a never-run");
  assert.equal(h.stale, true, "older than the stale window must flag stale");
  assert.equal(h.ageMs, CRON_STALE_AFTER_MS + 60 * 1000);
});

test("boundary: exactly CRON_STALE_AFTER_MS old is NOT yet stale (strict >)", () => {
  const atEdge = deriveCronHealth({ at: NOW - CRON_STALE_AFTER_MS, summary: {} }, NOW);
  assert.equal(atEdge.stale, false, "at the boundary is still healthy");

  const justPast = deriveCronHealth(
    { at: NOW - (CRON_STALE_AFTER_MS + 1), summary: {} },
    NOW,
  );
  assert.equal(justPast.stale, true, "1ms past the boundary is stale");
});

test("missing summary on an otherwise-valid heartbeat normalizes to null", () => {
  const h = deriveCronHealth(
    { at: NOW, summary: undefined as unknown as Record<string, number> },
    NOW,
  );
  assert.equal(h.everRan, true);
  assert.equal(h.summary, null);
});
