import assert from "node:assert/strict";
import test from "node:test";
import { readCoachTimingBoards, recordCoachTimingBoard } from "./coachTimingBoardStore.ts";

test("Coach saves timing with the exact board scope, partial loads, and bounded history", async () => {
  await recordCoachTimingBoard("first", { totalMs: 500 }, { sports: ["nba"], userId: "private", askText: "private" } as never, "loaded");
  await recordCoachTimingBoard("second", { totalMs: 30000 }, { sports: ["nhl"] }, "partial");
  const saved = JSON.parse((await readCoachTimingBoards())!);
  assert.ok(Number.isFinite(saved[0].savedAt));
  const { savedAt: _savedAt, ...entry } = saved[0];
  assert.deepEqual(entry, {
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


test("snapshots expire after seven days on the next read", async () => {
  const original = Date.now;
  const start = original();
  try {
    Date.now = () => start;
    await recordCoachTimingBoard("expires", {}, null, "not_loaded");
    Date.now = () => start + 8 * 86400_000;
    assert.equal(await readCoachTimingBoards(), null);
  } finally { Date.now = original; }
});

test("board serialization omits injected account and prepared-context fields at every level", async () => {
  const board = {
    askText: "private-prompt", userId: "private-user",
    espnGames: [{ id: "espn", preparedContext: { privateData: "private-context" } }],
    oddsGames: [{
      id: "event", markets: [{ key: "spreads", outcomes: [{
        name: "Team", price: -110, point: 1.5, sessionToken: "private-token",
        books: [{ book: "Sportsbook", price: -110, token: "private-book-token" }],
      }] }],
    }],
    propPool: [{ player: "Athlete", odds: 100, email: "private-email" }],
  };
  await recordCoachTimingBoard("public-board", {}, board as never, "loaded");
  const output = (await readCoachTimingBoards())!;
  assert.doesNotMatch(output, /private-/);
  const [record] = JSON.parse(output);
  assert.equal(record.board.oddsGames[0].markets[0].outcomes[0].point, 1.5);
  assert.equal(record.board.propPool[0].player, "Athlete");
});
