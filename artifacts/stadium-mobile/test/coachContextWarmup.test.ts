import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoachContextWarmer } from "../lib/coachContextWarmup.ts";
import { clearCoachContextCache, withCoachContextCache, classifyCoachContextPath } from "../lib/coachContextCache.ts";

test("foreground starts immediately and clears queued preparation without cancelling shared work", async () => {
  const warmer = createCoachContextWarmer();
  warmer.setActive(true);
  let resolve!: (value: number) => void;
  let calls = 0;
  let queuedRan = false;
  clearCoachContextCache();
  const load = () => withCoachContextCache("/sports/injuries?sport=nfl", "injuries", () => {
    calls++;
    return new Promise<number>(r => { resolve = r; });
  });
  const pass = warmer.warm([
    { key: "injuries", run: load },
    { key: "unused", run: async () => { queuedRan = true; } },
  ]);
  const release = warmer.beginForeground();
  const foreground = load();
  assert.equal(warmer.snapshot().foregroundUsers, 1);
  assert.equal(warmer.snapshot().queued, 0);
  assert.equal(calls, 1, "foreground reuses the request already in flight");
  resolve(42);
  assert.equal(await foreground, 42);
  await pass;
  assert.equal(queuedRan, false);
  release(); release();
  assert.equal(warmer.snapshot().foregroundUsers, 0);
  assert.equal(await load(), 42);
  assert.equal(calls, 1, "warm foreground context needs no new provider request");
});

test("inactive apps and overlapping foreground builds do not start warming", async () => {
  const warmer = createCoachContextWarmer();
  let calls = 0;
  const tasks = [{ key: "a", run: async () => { calls++; } }];
  await warmer.warm(tasks);
  warmer.setActive(true);
  const a = warmer.beginForeground(), b = warmer.beginForeground();
  a();
  await warmer.warm(tasks);
  assert.equal(calls, 0);
  b();
  await warmer.warm(tasks);
  assert.equal(calls, 1);
  warmer.setActive(false);
  await warmer.warm([{ ...tasks[0]!, key: "b" }]);
  assert.equal(calls, 1);
});

test("one request at a time, duplicate suppression, failure retry and eight-second pass budget", async () => {
  let clock = 0;
  const warmer = createCoachContextWarmer(() => clock);
  warmer.setActive(true);
  let calls = 0, inFlight = 0, peak = 0;
  const run = async () => { calls++; peak = Math.max(peak, ++inFlight); clock += 4000; inFlight--; };
  const tasks = ["a", "a", "b", "c"].map(key => ({ key, run }));
  await warmer.warm(tasks);
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  assert.equal(warmer.snapshot().queued, 1);
  await warmer.warm(tasks);
  assert.equal(calls, 3, "completed keys are not fetched again within one minute");
  let fail = true;
  const retry = [{ key: "retry", run: async () => { if (fail) throw new Error("offline"); calls++; } }];
  await warmer.warm(retry);
  fail = false;
  await warmer.warm(retry);
  assert.equal(warmer.snapshot().failed, 1);
  assert.equal(calls, 4);
});

test("preparation never changes live odds or simulation cache policy", () => {
  for (const path of ["/sports/odds", "/sports/props", "/sports/live-odds", "/sports/simulate/props"]) {
    assert.equal(classifyCoachContextPath(path), null);
  }
});

test("freshly discovered game context warms in the opening pass without waiting for the next timer", async () => {
  const warmer = createCoachContextWarmer();
  warmer.setActive(true);
  const order: string[] = [];
  await warmer.warm([{ key: "schedule", run: async () => { order.push("schedule"); },
    followups: () => [{ key: "injuries", run: async () => { order.push("injuries"); } }],
  }]);
  assert.deepEqual(order, ["schedule", "injuries"]);
});
