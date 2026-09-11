import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { reachBoardScanEligible } from "./boardMarketScanner.ts";
import { COACH_PARLAY_KERNEL_ONLY } from "./coachParlayEngine.ts";
import { wantsPropsOnly } from "./slate.ts";
import {
  emptyCardBoardScanStallMs,
  shouldClearBusyAfterFailedStallPaint,
  shouldKeepBusyForIncompleteBoardScan,
} from "./coachBuildPhase.ts";

/**
 * End-to-end control-flow proof for "6 leg player props" under kernel-only.
 * Source asserts lock the coach.tsx wiring that previously left this ask with
 * no early board-scan and a 90s empty stall → "finished without pick cards".
 */

test("6 leg player props is props-only and board-scan eligible under kernel", () => {
  assert.equal(COACH_PARLAY_KERNEL_ONLY, true);
  assert.equal(wantsPropsOnly("6 leg player props"), true);
  assert.equal(wantsPropsOnly("6 leg player prop"), true);
  assert.equal(
    reachBoardScanEligible({
      requestedLegs: 6,
      propsOnly: true,
      kernelOnly: COACH_PARLAY_KERNEL_ONLY,
    }),
    true,
  );
});

test("empty stall and finally busy keep cannot race a 120s board scan", () => {
  assert.ok(emptyCardBoardScanStallMs(6) > 120_000);
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: false,
      displayedPickCountAfter: 0,
      incompleteScanInFlight: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 6,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
    }),
    true,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 9,
      displayedPickCount: 0,
      scanComplete: undefined,
      hasScanStash: false,
      boardScanPending: true,
    }),
    true,
  );
});

test("coach.tsx wires kernel props-only onto board-scan + keeps busy mid-scan", () => {
  const src = fs.readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  assert.match(src, /kernelOnly:\s*useParlayKernel\s*\|\|\s*COACH_PARLAY_KERNEL_ONLY/);
  assert.match(src, /propsOnly:\s*wantsPropsOnly\(trimmed\)/);
  assert.match(src, /propsOnly:\s*propsOnlyTicket/);
  assert.match(src, /shouldKeepBusyForIncompleteBoardScan\(/);
  assert.match(src, /boardScanPending:\s*boardScanPendingForActiveSend\(\)/);
  assert.match(src, /shouldSuppressEmptyTicketDeadEnd\(/);
  assert.match(src, /trackLateBoardScanJoin\(/);
  assert.match(src, /beginBoardScanAttempt\(/);
});

test("boardMarketScanner stages props-only from prop legs", () => {
  const src = fs.readFileSync(new URL("./boardMarketScanner.ts", import.meta.url), "utf8");
  assert.match(src, /const stagePool = opts\.propsOnly \? scored\.filter/);
  assert.match(src, /propsOnly: opts\.propsOnly/);
});
