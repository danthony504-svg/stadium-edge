/**
 * Deterministic cleanup proofs for Coach scan Promise.race paths.
 * Uses a controllable clock — no real wall waits.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createCoachRequestTiming,
  getActiveCoachRaceCountForTests,
  markCoachPhase,
  raceWithTimeoutAndAbort,
  resetActiveCoachRaceCountForTests,
  type CoachRaceClock,
} from "./coachRequestDeadline.ts";

type TimerFn = () => void;

function createFakeClock() {
  let nextId = 1;
  const timers = new Map<number, { due: number; fn: TimerFn }>();
  let now = 0;
  const clock: CoachRaceClock = {
    setTimeout: ((fn: TimerFn, ms?: number) => {
      const id = nextId++;
      timers.set(id, { due: now + Math.max(0, Number(ms) || 0), fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: ((id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number);
    }) as typeof clearTimeout,
  };
  return {
    clock,
    get pendingCount() {
      return timers.size;
    },
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.due <= now)
        .sort((a, b) => a[1].due - b[1].due);
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        t.fn();
      }
    },
    async flushMicrotasks() {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function trackAbortListeners(signal: AbortSignal) {
  const realAdd = signal.addEventListener.bind(signal);
  const realRemove = signal.removeEventListener.bind(signal);
  let active = 0;
  signal.addEventListener = ((type, listener, options) => {
    if (type === "abort") active += 1;
    return realAdd(type, listener as EventListener, options);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type, listener, options) => {
    if (type === "abort") active = Math.max(0, active - 1);
    return realRemove(type, listener as EventListener, options);
  }) as typeof signal.removeEventListener;
  return {
    get activeAbortListeners() {
      return active;
    },
  };
}

beforeEach(() => {
  resetActiveCoachRaceCountForTests();
});

test("success settles — timer and abort listeners cleared immediately", async () => {
  const fake = createFakeClock();
  const ac = new AbortController();
  const tracked = trackAbortListeners(ac.signal);
  let resolveScan!: (v: string) => void;
  const scan = new Promise<string>((r) => {
    resolveScan = r;
  });

  const pending = raceWithTimeoutAndAbort({
    promise: scan,
    timeoutMs: 5_000,
    signals: [ac.signal],
    onTimeout: () => "timeout",
    clock: fake.clock,
  });
  await fake.flushMicrotasks();
  assert.equal(getActiveCoachRaceCountForTests(), 1);
  assert.equal(fake.pendingCount, 1);
  assert.equal(tracked.activeAbortListeners, 1);

  resolveScan("ok");
  await fake.flushMicrotasks();
  const result = await pending;
  assert.equal(result, "ok");
  assert.equal(fake.pendingCount, 0);
  assert.equal(tracked.activeAbortListeners, 0);
  assert.equal(getActiveCoachRaceCountForTests(), 0);

  // Advancing past the original timeout must not fire a second branch.
  fake.advance(10_000);
  await fake.flushMicrotasks();
  assert.equal(fake.pendingCount, 0);
});

test("timeout settles — listeners cleared; late promise ignored", async () => {
  const fake = createFakeClock();
  const ac = new AbortController();
  const tracked = trackAbortListeners(ac.signal);
  let resolveScan!: (v: string) => void;
  const scan = new Promise<string>((r) => {
    resolveScan = r;
  });

  const pending = raceWithTimeoutAndAbort({
    promise: scan,
    timeoutMs: 1_000,
    signals: [ac.signal],
    onTimeout: () => "timeout",
    clock: fake.clock,
  });
  await fake.flushMicrotasks();
  fake.advance(1_000);
  await fake.flushMicrotasks();
  assert.equal(await pending, "timeout");
  assert.equal(fake.pendingCount, 0);
  assert.equal(tracked.activeAbortListeners, 0);
  assert.equal(getActiveCoachRaceCountForTests(), 0);

  resolveScan("late");
  await fake.flushMicrotasks();
  assert.equal(getActiveCoachRaceCountForTests(), 0);
});

test("cancellation settles — timer cleared", async () => {
  const fake = createFakeClock();
  const ac = new AbortController();
  const tracked = trackAbortListeners(ac.signal);
  const scan = new Promise<string>(() => {
    /* never */
  });

  const pending = raceWithTimeoutAndAbort({
    promise: scan,
    timeoutMs: 10_000,
    signals: [ac.signal],
    onTimeout: () => "timeout",
    onAbort: () => "cancelled",
    clock: fake.clock,
  });
  await fake.flushMicrotasks();
  assert.equal(fake.pendingCount, 1);
  ac.abort();
  await fake.flushMicrotasks();
  assert.equal(await pending, "cancelled");
  assert.equal(fake.pendingCount, 0);
  assert.equal(tracked.activeAbortListeners, 0);
  assert.equal(getActiveCoachRaceCountForTests(), 0);
});

test("rejection settles — timer and listeners cleared", async () => {
  const fake = createFakeClock();
  const ac = new AbortController();
  const tracked = trackAbortListeners(ac.signal);
  let rejectScan!: (e: Error) => void;
  const scan = new Promise<string>((_, rej) => {
    rejectScan = rej;
  });

  const pending = raceWithTimeoutAndAbort({
    promise: scan,
    timeoutMs: 8_000,
    signals: [ac.signal],
    onTimeout: () => "timeout",
    clock: fake.clock,
  });
  await fake.flushMicrotasks();
  rejectScan(new Error("scan_failed"));
  await fake.flushMicrotasks();
  await assert.rejects(pending, /scan_failed/);
  assert.equal(fake.pendingCount, 0);
  assert.equal(tracked.activeAbortListeners, 0);
  assert.equal(getActiveCoachRaceCountForTests(), 0);
});

test("20 consecutive races leave zero active timers and listeners", async () => {
  const fake = createFakeClock();
  const controllers: AbortController[] = [];
  const trackers: Array<ReturnType<typeof trackAbortListeners>> = [];

  for (let i = 0; i < 20; i++) {
    const ac = new AbortController();
    controllers.push(ac);
    trackers.push(trackAbortListeners(ac.signal));
    const mode = i % 4;
    if (mode === 0) {
      // success
      const p = Promise.resolve(`ok-${i}`);
      assert.equal(
        await raceWithTimeoutAndAbort({
          promise: p,
          timeoutMs: 5_000,
          signals: [ac.signal],
          onTimeout: () => "timeout",
          clock: fake.clock,
        }),
        `ok-${i}`,
      );
    } else if (mode === 1) {
      // timeout
      const p = new Promise<string>(() => undefined);
      const pending = raceWithTimeoutAndAbort({
        promise: p,
        timeoutMs: 100,
        signals: [ac.signal],
        onTimeout: () => "timeout",
        clock: fake.clock,
      });
      await fake.flushMicrotasks();
      fake.advance(100);
      await fake.flushMicrotasks();
      assert.equal(await pending, "timeout");
    } else if (mode === 2) {
      // cancel
      const p = new Promise<string>(() => undefined);
      const pending = raceWithTimeoutAndAbort({
        promise: p,
        timeoutMs: 5_000,
        signals: [ac.signal],
        onTimeout: () => "timeout",
        onAbort: () => "cancelled",
        clock: fake.clock,
      });
      await fake.flushMicrotasks();
      ac.abort();
      await fake.flushMicrotasks();
      assert.equal(await pending, "cancelled");
    } else {
      // error
      const p = Promise.reject(new Error(`err-${i}`));
      await assert.rejects(
        raceWithTimeoutAndAbort({
          promise: p,
          timeoutMs: 5_000,
          signals: [ac.signal],
          onTimeout: () => "timeout",
          clock: fake.clock,
        }),
        new RegExp(`err-${i}`),
      );
    }
    await fake.flushMicrotasks();
    assert.equal(getActiveCoachRaceCountForTests(), 0, `active races after #${i}`);
    assert.equal(fake.pendingCount, 0, `pending timers after #${i}`);
    assert.equal(
      trackers[i]!.activeAbortListeners,
      0,
      `abort listeners after #${i}`,
    );
  }

  assert.equal(getActiveCoachRaceCountForTests(), 0);
  assert.equal(fake.pendingCount, 0);
  assert.equal(
    trackers.reduce((n, t) => n + t.activeAbortListeners, 0),
    0,
  );
});

test("grace-style race cleans up the same way as the primary scan race", async () => {
  const fake = createFakeClock();
  const ac = new AbortController();
  const tracked = trackAbortListeners(ac.signal);
  const scan = Promise.resolve({ scan: { picks: [1] } });
  const grace = await raceWithTimeoutAndAbort({
    promise: scan,
    timeoutMs: 20_000,
    signals: [ac.signal],
    onTimeout: () => ({ scan: null }),
    clock: fake.clock,
  });
  assert.deepEqual(grace, { scan: { picks: [1] } });
  assert.equal(fake.pendingCount, 0);
  assert.equal(tracked.activeAbortListeners, 0);
});

test("buildParlay wires raceWithTimeoutAndAbort for scan, grace, and drain", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "buildParlay.ts"),
    "utf8",
  );
  const races = src.match(/raceWithTimeoutAndAbort\s*\(/g) ?? [];
  assert.ok(races.length >= 3, "scan + grace + drain must use helper");
  // Raw Promise.race with setTimeout+addEventListener must not remain on scan path.
  const scanBlockStart = src.indexOf("const scanPromise = tryReachFullBoardScan");
  const finStart = src.indexOf("markCoachPending(timing, \"finalization\")");
  assert.ok(scanBlockStart >= 0 && finStart > scanBlockStart);
  const block = src.slice(scanBlockStart, finStart);
  assert.equal(block.includes("Promise.race(["), false);
  assert.match(block, /deliveryTerminalized\s*=\s*true/);
});

test("cold first-ticket load / context / scan durations stay separate", () => {
  // Structural measurement: phase markers remain independent after cleanup work.
  const timing = createCoachRequestTiming({
    requestStartedAtMs: 0,
    budgetMs: 90_000,
  });
  markCoachPhase(timing, "load", 12_400);
  markCoachPhase(timing, "context", 3_100);
  markCoachPhase(timing, "scan", 28_700);
  assert.equal(timing.loadMs, 12_400);
  assert.equal(timing.contextMs, 3_100);
  assert.equal(timing.scanMs, 28_700);
  // Sum of phases is not collapsed into one opaque total.
  assert.equal(
    (timing.loadMs ?? 0) + (timing.contextMs ?? 0) + (timing.scanMs ?? 0),
    44_200,
  );
});

test("fake-timer probe: sequential load→context→scan walls recorded separately", async () => {
  const fake = createFakeClock();
  const timing = createCoachRequestTiming({
    requestStartedAtMs: 0,
    budgetMs: 90_000,
  });

  async function runPhase(
    name: "load" | "context" | "scan",
    durationMs: number,
  ): Promise<void> {
    const started = fake.now;
    const pending = raceWithTimeoutAndAbort({
      promise: new Promise<string>((resolve) => {
        fake.clock.setTimeout(() => resolve(name), durationMs);
      }),
      timeoutMs: 90_000,
      onTimeout: () => "timeout",
      clock: fake.clock,
    });
    await fake.flushMicrotasks();
    fake.advance(durationMs);
    await fake.flushMicrotasks();
    assert.equal(await pending, name);
    markCoachPhase(timing, name, fake.now - started);
    assert.equal(fake.pendingCount, 0);
    assert.equal(getActiveCoachRaceCountForTests(), 0);
  }

  await runPhase("load", 5_000);
  await runPhase("context", 2_000);
  await runPhase("scan", 9_000);

  assert.equal(timing.loadMs, 5_000);
  assert.equal(timing.contextMs, 2_000);
  assert.equal(timing.scanMs, 9_000);
  assert.equal(
    (timing.loadMs ?? 0) + (timing.contextMs ?? 0) + (timing.scanMs ?? 0),
    16_000,
  );
});
