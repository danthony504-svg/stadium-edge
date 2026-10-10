import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingTicketPicks,
  drainPendingTicketPicks,
} from "./pendingTicketPicks.ts";

type FakePick = { game: string; pick: string; odds: number };

test("drainPendingTicketPicks returns raw buffer then clears (absolute terminal)", () => {
  const buf = {
    current: [
      { game: "Lakers @ Celtics", pick: "Lakers -3.5", odds: -110 },
      { game: "A @ B", pick: "Over 220.5", odds: -105 },
    ] as FakePick[],
  };
  const drained = drainPendingTicketPicks(buf);
  assert.equal(drained.length, 2);
  assert.equal(drained[0]!.game, "Lakers @ Celtics");
  assert.deepEqual(buf.current, []);
  // Second drain is empty — no stale identity left for a later flush.
  assert.deepEqual(drainPendingTicketPicks(buf), []);
});

test("clearPendingTicketPicks empties buffer on unmount path", () => {
  const buf = {
    current: [{ game: "Yankees @ Red Sox", pick: "Yankees", odds: -130 }] as FakePick[],
  };
  clearPendingTicketPicks(buf);
  assert.deepEqual(buf.current, []);
  clearPendingTicketPicks(buf);
  assert.deepEqual(buf.current, []);
});

test("new session cannot see prior request picks after drain/clear", () => {
  const buf: { current: FakePick[] } = { current: [] };

  // Request A fills the buffer, then absolute-terminal drains it.
  buf.current = [{ game: "Secret @ Game", pick: "Secret ML", odds: 150 }];
  const fromA = drainPendingTicketPicks(buf);
  assert.equal(fromA[0]!.pick, "Secret ML");
  assert.deepEqual(buf.current, []);

  // Unmount-style clear is idempotent.
  clearPendingTicketPicks(buf);
  assert.deepEqual(buf.current, []);

  // Request B starts (same as send() clearing the ref) — must be empty.
  clearPendingTicketPicks(buf);
  assert.deepEqual(buf.current, []);
  buf.current = [{ game: "New @ Match", pick: "New -1.5", odds: -120 }];
  assert.equal(buf.current.length, 1);
  assert.equal(buf.current[0]!.game, "New @ Match");
  assert.ok(!buf.current.some((p) => p.game.includes("Secret")));
});
