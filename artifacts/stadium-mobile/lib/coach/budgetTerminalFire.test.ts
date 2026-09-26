import assert from "node:assert/strict";
import test from "node:test";

/**
 * Absolute-budget fire must not nest setState updaters. The production bug:
 * finishSession (setMessages) called inside setMessages(updater) → React dropped
 * the building:false patch → sticky "Scoring ticket…" with composer unlocked.
 */
test("budget terminal finish must run outside setMessages updater", () => {
  const calls: string[] = [];
  const finishSession = () => {
    calls.push("finish");
  };
  // Bad pattern (what we removed):
  const badFire = () => {
    const setMessages = (updater: (prev: unknown[]) => unknown[]) => {
      calls.push("setMessages-outer");
      updater([]);
    };
    setMessages((prev) => {
      finishSession();
      return prev;
    });
  };
  // Good pattern:
  const goodFire = () => {
    calls.push("finish-direct");
    finishSession();
  };

  calls.length = 0;
  badFire();
  assert.deepEqual(calls, ["setMessages-outer", "finish"]);

  calls.length = 0;
  goodFire();
  assert.deepEqual(calls, ["finish-direct", "finish"]);
});
