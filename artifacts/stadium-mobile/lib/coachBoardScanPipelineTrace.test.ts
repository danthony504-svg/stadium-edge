import test from "node:test";
import assert from "node:assert/strict";
import {
  boardScanPipelineSnapshot,
  logBoardScanPipeline,
} from "./coachBoardScanPipelineTrace.ts";
import { startBoardScanRace } from "./coachBoardScanRace.ts";

test("logBoardScanPipeline records STOP when games filter to zero", () => {
  logBoardScanPipeline("1-scan-start", 3, { requestId: "t1", targetLegs: 3 });
  logBoardScanPipeline("3-games-filtered", 0, { requestId: "t1", gamesFiltered: 0 });
  const snap = boardScanPipelineSnapshot();
  assert.equal(snap.stopStage, "3-games-filtered");
  assert.match(snap.stopReason ?? "", /No bettable games/i);
});

test("startBoardScanRace returns null at budget but settles scan in background", async () => {
  let settled: number | null = null;
  const scan = new Promise<{ picks: { id: string }[]; scanComplete: boolean } | null>(
    (resolve) => {
      setTimeout(() => resolve({ picks: [{ id: "a" }], scanComplete: true }), 40);
    },
  );
  const race = startBoardScanRace(scan as never, 10, (result) => {
    settled = result?.picks?.length ?? 0;
  });
  const budgeted = await race.awaitBudget();
  assert.equal(budgeted, null);
  const final = await race.promise;
  assert.equal(final?.picks?.length, 1);
  assert.equal(settled, 1);
});
