/**
 * Regression: 5-leg ask → partial 2 → partial 4 → budget race miss → delayed
 * final 5 must replace the "scan continues" ticket (completion handoff only).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyBoardScanToUiSnapshot,
  awaitLateBoardScanAfterBudget,
  boardScanUiShowsContinues,
  resolveScanAfterBudgetRace,
  runBoardScanBudgetHandoffTimeline,
  type BudgetHandoffScan,
} from "./coachBoardScanBudgetHandoff.ts";
import { boardScanIsComplete, boardScanReadyForDelivery } from "./coachScanPolicy.ts";

function mockScan(
  pickCount: number,
  opts: { requestedLegs: number; requestId: string; scanComplete: boolean },
): BudgetHandoffScan {
  return {
    picks: { length: pickCount },
    requestedLegs: opts.requestedLegs,
    requestId: opts.requestId,
    scanComplete: opts.scanComplete,
  };
}

test("budget race with incomplete latestRef does not adopt the 4-pick partial as final", () => {
  const partial4 = mockScan(4, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: false,
  });
  const adopted = resolveScanAfterBudgetRace(null, partial4, 5);
  assert.equal(adopted, null);
  assert.equal(boardScanReadyForDelivery(partial4, 5), false);
  assert.equal(boardScanIsComplete(partial4), false);
});

test("request 5 → partial 2 → partial 4 → delayed final 5 replaces continues UI", async () => {
  const partial2 = mockScan(2, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: false,
  });
  const partial4 = mockScan(4, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: false,
  });
  const final5 = mockScan(5, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: true,
  });

  // Simulate Promise.race budget win while scan is still mid-flight.
  const raceWinner: BudgetHandoffScan | null = null;
  const latestAtRaceEnd = partial4;
  assert.equal(resolveScanAfterBudgetRace(raceWinner, latestAtRaceEnd, 5), null);

  const timeline = runBoardScanBudgetHandoffTimeline({
    requestedLegs: 5,
    partials: [partial2, partial4],
    raceWinner,
    latestAtRaceEnd,
    lateFinal: null,
  });
  assert.equal(timeline.uiAfterPartials.pickCount, 4);
  assert.equal(timeline.uiAfterPartials.boardScanComplete, false);
  assert.equal(timeline.showsContinuesAfterRace, true, "idle + incomplete 4 must show continues");
  assert.equal(timeline.uiAfterRace.pickCount, 4);

  // Floating scan settles after/near budget — join must adopt complete 5.
  let active = true;
  const late = await awaitLateBoardScanAfterBudget(
    Promise.resolve(final5),
    { legTarget: 5, stillActive: () => active },
  );
  assert.equal(late, final5);
  assert.equal(boardScanReadyForDelivery(late!, 5), true);

  const afterLate = applyBoardScanToUiSnapshot(timeline.uiAfterRace, late);
  assert.equal(afterLate.pickCount, 5);
  assert.equal(afterLate.boardScanComplete, true);
  assert.equal(boardScanUiShowsContinues(afterLate), false);

  // End-to-end timeline including late final attachment.
  const full = runBoardScanBudgetHandoffTimeline({
    requestedLegs: 5,
    partials: [partial2, partial4],
    raceWinner: null,
    latestAtRaceEnd: partial4,
    lateFinal: final5,
  });
  assert.equal(full.showsContinuesAfterRace, true);
  assert.equal(full.uiAfterLateFinal.pickCount, 5);
  assert.equal(full.uiAfterLateFinal.boardScanComplete, true);
  assert.equal(full.showsContinuesAfterLateFinal, false);

  // Stale request must not adopt a late final.
  active = false;
  const stale = await awaitLateBoardScanAfterBudget(Promise.resolve(final5), {
    legTarget: 5,
    stillActive: () => active,
  });
  assert.equal(stale, null);
});

test("late final with 5+ eligible picks maps selected → delivered → rendered to 5", () => {
  const final5 = mockScan(5, {
    requestedLegs: 5,
    requestId: "req-5",
    scanComplete: true,
  });
  // selected (scan.picks) → delivered (ready-for-delivery complete) → rendered (UI snapshot)
  assert.equal(final5.picks?.length, 5, "selected");
  assert.equal(boardScanReadyForDelivery(final5, 5), true, "delivered gate");
  const rendered = applyBoardScanToUiSnapshot(
    {
      requestedLegs: 5,
      pickCount: 4,
      boardScanComplete: false,
      buildIdle: true,
    },
    final5,
  );
  assert.equal(rendered.pickCount, 5, "rendered");
  assert.equal(rendered.boardScanComplete, true);
  assert.equal(boardScanUiShowsContinues(rendered), false);
});

test("coach.tsx retains in-flight scan promise after budget Promise.race", () => {
  const coachPath = join(dirname(fileURLToPath(import.meta.url)), "../app/(tabs)/coach.tsx");
  const src = readFileSync(coachPath, "utf8");

  // Reach path must keep the promise so a late complete can still attach.
  assert.match(src, /reachScanPromise\s*=\s*tryReachFullBoardScan\(/);
  assert.match(src, /awaitLateBoardScanAfterBudget\(/);
  assert.match(src, /Promise\.race\(\[\s*reachScanPromise/s);

  // Dead earlyReachBoardScanRef assignment gap must not be the only late path.
  assert.match(src, /awaitLateBoardScanAfterBudget/);
});
