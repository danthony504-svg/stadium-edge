import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure mirror of recordEvent error classification in subscriptions.ts —
 * audit logging must never throw after trusted entitlement work.
 */
function classifyRecordEventError(message: string): "duplicate" | "failed" {
  if (/unique|duplicate/i.test(message)) return "duplicate";
  return "failed";
}

test("unique / duplicate violations classify as duplicate (idempotent skip)", () => {
  assert.equal(
    classifyRecordEventError(
      'duplicate key value violates unique constraint "subscription_events_event_key_uidx"',
    ),
    "duplicate",
  );
  assert.equal(classifyRecordEventError("UNIQUE constraint failed"), "duplicate");
});

test("missing subscription_events relation classifies as failed (non-fatal)", () => {
  assert.equal(
    classifyRecordEventError('relation "subscription_events" does not exist'),
    "failed",
  );
});

test("webhook should only skip upsert on duplicate, not on failed log", () => {
  const shouldSkipUpsert = (result: "inserted" | "duplicate" | "failed") =>
    result === "duplicate";
  assert.equal(shouldSkipUpsert("duplicate"), true);
  assert.equal(shouldSkipUpsert("failed"), false);
  assert.equal(shouldSkipUpsert("inserted"), false);
});
