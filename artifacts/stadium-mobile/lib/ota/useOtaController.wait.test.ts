/**
 * Tip-boot wait helper — proves we idle until startup procedure clears.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { waitForStartupProcedureIdle } from "./waitForStartupProcedureIdle.ts";

test("waitForStartupProcedureIdle returns idle immediately when not running", async () => {
  const sleeps: number[] = [];
  const result = await waitForStartupProcedureIdle(() => false, {
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(result, "idle");
  assert.deepEqual(sleeps, []);
});

test("waitForStartupProcedureIdle polls until idle", async () => {
  let running = true;
  let ticks = 0;
  const result = await waitForStartupProcedureIdle(() => running, {
    maxMs: 5_000,
    pollMs: 10,
    sleepFn: async () => {
      ticks += 1;
      if (ticks >= 3) running = false;
    },
  });
  assert.equal(result, "idle");
  assert.ok(ticks >= 3);
});

test("waitForStartupProcedureIdle times out when stuck", async () => {
  const result = await waitForStartupProcedureIdle(() => true, {
    maxMs: 30,
    pollMs: 10,
    sleepFn: async () => {},
  });
  assert.equal(result, "timeout");
});
