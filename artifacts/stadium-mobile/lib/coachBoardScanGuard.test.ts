import assert from "node:assert/strict";
import test from "node:test";

import {
  abortCoachBoardScan,
  isCoachBoardScanAborted,
  mergeAbortSignals,
  resetCoachBoardScanGuardForTests,
  runExclusiveCoachBoardScan,
} from "./coachBoardScanGuard.ts";

test("runExclusiveCoachBoardScan allows only one active scan per requestId", async () => {
  resetCoachBoardScanGuardForTests();
  let starts = 0;
  let propSimStarts = 0;

  const scan = async (signal: AbortSignal) => {
    starts += 1;
    propSimStarts += 1;
    await new Promise((r) => setTimeout(r, 40));
    if (signal.aborted) return { stage: "aborted", starts };
    return { stage: "complete", starts };
  };

  const p1 = runExclusiveCoachBoardScan("req-dup", scan);
  const p2 = runExclusiveCoachBoardScan("req-dup", scan);
  const p3 = runExclusiveCoachBoardScan("req-dup", scan);

  const [a, b, c] = await Promise.all([p1, p2, p3]);
  assert.equal(starts, 1, "duplicate callers must join the in-flight scan");
  assert.equal(propSimStarts, 1, "prop_sim must not start twice for one request");
  assert.equal(a.stage, "complete");
  assert.equal(b.stage, "complete");
  assert.equal(c.stage, "complete");
});

test("late work cannot continue after request_terminal abort", async () => {
  resetCoachBoardScanGuardForTests();
  let batchesAfterTerminal = 0;
  let sawAbort = false;

  const scanPromise = runExclusiveCoachBoardScan("req-term", async (signal) => {
    for (let i = 0; i < 5; i++) {
      if (signal.aborted) {
        sawAbort = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
      if (signal.aborted) {
        sawAbort = true;
        break;
      }
      batchesAfterTerminal += 1;
    }
    return { batchesAfterTerminal, sawAbort };
  });

  await new Promise((r) => setTimeout(r, 25));
  abortCoachBoardScan("req-term", "request_terminal");
  assert.equal(isCoachBoardScanAborted("req-term"), true);

  const result = await scanPromise;
  assert.equal(result.sawAbort, true);
  assert.ok(result.batchesAfterTerminal < 5, "must stop remaining async batches after terminal");

  await assert.rejects(
    () =>
      runExclusiveCoachBoardScan("req-term", async () => {
        batchesAfterTerminal += 100;
        return "should-not-run";
      }),
    (err: unknown) => err instanceof Error && err.name === "AbortError",
  );
  assert.ok(batchesAfterTerminal < 100, "new scan after terminal must be rejected");
});

test("mergeAbortSignals aborts when either signal fires", async () => {
  const a = new AbortController();
  const b = new AbortController();
  const merged = mergeAbortSignals(a.signal, b.signal);
  assert.ok(merged);
  assert.equal(merged!.aborted, false);
  b.abort();
  assert.equal(merged!.aborted, true);
});
