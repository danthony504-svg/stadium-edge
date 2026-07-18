import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_SCAN_ABORT_SETTLE_MS, awaitBoardScanWithinBudget } from "./coachBoardScanRace.ts";
import {
  logCoachExecSkip,
  logCoachExecStep,
  registerCoachExecTraceSink,
  resetCoachExecTraceForTests,
} from "./coachExecutionTrace.ts";

test("awaitBoardScanWithinBudget returns scan result when it finishes before budget", async () => {
  const result = await awaitBoardScanWithinBudget(
    Promise.resolve({ picks: [], scanComplete: true } as never),
    5_000,
    () => {
      assert.fail("abort should not run");
    },
  );
  assert.equal(result?.scanComplete, true);
});

test("awaitBoardScanWithinBudget aborts and waits for settled scan after budget", async () => {
  let aborted = false;
  const scanPromise = new Promise<{ scanComplete: boolean; picks: [] }>((resolve) => {
    setTimeout(() => {
      assert.equal(aborted, true);
      resolve({ scanComplete: true, picks: [] });
    }, 20);
  });
  const result = await awaitBoardScanWithinBudget(scanPromise, 5, () => {
    aborted = true;
  });
  assert.equal(result?.scanComplete, true);
});

test("coach execution trace logs standard snapshot fields", () => {
  resetCoachExecTraceForTests();
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    registerCoachExecTraceSink(() => ({
      activeRequestId: "req-a",
      scanComplete: true,
      pickCount: 5,
      selectedCount: 0,
      finalizedRequestId: null,
      correlationRequestId: null,
      sendGeneration: 3,
    }));
    logCoachExecStep("correlation-start");
    logCoachExecSkip("correlation-start", "scan-incomplete");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /\[coach-exec-trace\] correlation-start/);
    assert.match(lines[0]!, /"activeRequestId":"req-a"/);
    assert.match(lines[0]!, /"pickCount":5/);
    assert.match(lines[1]!, /correlation-start-skipped/);
    assert.match(lines[1]!, /"condition":"scan-incomplete"/);
  } finally {
    console.log = orig;
    resetCoachExecTraceForTests();
  }
});

test("BOARD_SCAN_ABORT_SETTLE_MS is bounded", () => {
  assert.ok(BOARD_SCAN_ABORT_SETTLE_MS > 0 && BOARD_SCAN_ABORT_SETTLE_MS < 30_000);
});
