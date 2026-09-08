import assert from "node:assert/strict";
import test from "node:test";
import {
  logBuildFinished,
  logBuildStarted,
  raceBoardScanWithBudget,
} from "./coachBuildLifecycle.ts";

test("raceBoardScanWithBudget returns timed null but awaitCompletion resolves full scan", async () => {
  let inFlight = false;
  const scan = new Promise<string | null>((resolve) => {
    setTimeout(() => resolve("done"), 80);
  });
  const raced = await raceBoardScanWithBudget(scan, 10, {
    requestId: "test-race",
    onInFlightChange: (v) => {
      inFlight = v;
    },
  });
  assert.equal(raced.timedResult, null);
  assert.equal(inFlight, true);
  const full = await raced.awaitCompletion();
  assert.equal(full, "done");
  assert.equal(inFlight, false);
});

test("buildFinished timing logs run after boardScanFinished", async () => {
  const events: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown, ...rest: unknown[]) => {
    const line = [msg, ...rest].join(" ");
    if (typeof line === "string" && line.includes("[coach-build-timing]")) {
      const event = line.match(/boardScanStarted|boardScanFinished|buildStarted|buildFinished/)?.[0];
      if (event) events.push(event);
    }
    orig(msg, ...rest);
  };
  try {
    logBuildStarted("order-test");
    const raced = await raceBoardScanWithBudget(
      new Promise<string | null>((resolve) => setTimeout(() => resolve("done"), 30)),
      5,
      { requestId: "order-test" },
    );
    assert.equal(raced.timedResult, null);
    await raced.awaitCompletion();
    logBuildFinished("order-test");
    assert.deepEqual(events, [
      "buildStarted",
      "boardScanStarted",
      "boardScanFinished",
      "buildFinished",
    ]);
  } finally {
    console.log = orig;
  }
});
