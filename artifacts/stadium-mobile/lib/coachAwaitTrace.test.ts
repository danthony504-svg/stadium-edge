import assert from "node:assert/strict";
import test from "node:test";

import {
  getCoachAwaitTraceRecords,
  resetCoachAwaitTraceForTests,
  traceCoachAwait,
} from "./coachAwaitTrace.ts";

test("traceCoachAwait logs resolved await with site metadata", async () => {
  resetCoachAwaitTraceForTests();
  const value = await traceCoachAwait(
    "req-1",
    { fn: "testFn", file: "coachAwaitTrace.test.ts", line: 12 },
    "unit-test-await",
    async () => 42,
    { timeoutMs: 1000 },
  );
  assert.equal(value, 42);
  const records = getCoachAwaitTraceRecords("req-1");
  assert.equal(records.length, 1);
  assert.equal(records[0]!.outcome, "resolved");
  assert.equal(records[0]!.fn, "testFn");
  assert.equal(records[0]!.file, "coachAwaitTrace.test.ts");
  assert.equal(records[0]!.line, 12);
  assert.ok((records[0]!.durationMs ?? 0) >= 0);
});

test("traceCoachAwait times out and uses fallback", async () => {
  resetCoachAwaitTraceForTests();
  const value = await traceCoachAwait(
    "req-timeout",
    { fn: "slowFn", file: "coachAwaitTrace.test.ts", line: 30 },
    "slow-network",
    () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
    { timeoutMs: 5, onTimeout: () => "fallback" },
  );
  assert.equal(value, "fallback");
  const records = getCoachAwaitTraceRecords("req-timeout");
  assert.equal(records[0]!.outcome, "timeout");
});
