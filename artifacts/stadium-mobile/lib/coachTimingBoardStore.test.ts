import assert from "node:assert/strict";
import test from "node:test";
import { readCoachTimingBoards, recordCoachTimingBoard } from "./coachTimingBoardStore.ts";

test("Coach saves timing with the exact board scope, partial loads, and bounded history", async () => {
  await recordCoachTimingBoard("first", { totalMs: 500 }, { sports: ["nba"] }, "loaded");
  await recordCoachTimingBoard("second", { totalMs: 30000 }, { sports: ["nhl"] }, "partial");
  const saved = JSON.parse((await readCoachTimingBoards())!);
  assert.deepEqual(saved[0], {
    version: 1, requestId: "second", boardState: "partial",
    timing: { totalMs: 30000 }, board: { sports: ["nhl"] },
  });
  assert.deepEqual(saved[1].board, { sports: ["nba"] });
  for (let i = 0; i < 5; i++) await recordCoachTimingBoard(`empty-${i}`, {}, null, "not_loaded");
  const retained = JSON.parse((await readCoachTimingBoards())!);
  assert.equal(retained.length, 5);
  assert.equal(retained[0].board, null);
  assert.equal(retained[0].boardState, "not_loaded");
});
