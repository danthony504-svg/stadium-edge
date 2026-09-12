import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCoachTerminalPicks,
  shouldPublishCoachTicketPicks,
} from "./coachTicketHold.ts";

test("hold pick cards while building — status may update, cards must not", () => {
  assert.equal(shouldPublishCoachTicketPicks("building"), false);
});

test("publish pick cards only at terminal (ready / shortfall / budget)", () => {
  assert.equal(shouldPublishCoachTicketPicks("terminal"), true);
});

test("absolute budget flush uses buffered picks so the UI never hangs empty", () => {
  const buffered = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(
    resolveCoachTerminalPicks({ bufferedPicks: buffered, messagePicks: [] }),
    buffered,
  );
  assert.deepEqual(
    resolveCoachTerminalPicks({
      bufferedPicks: [],
      messagePicks: [{ id: "painted" }],
    }),
    [{ id: "painted" }],
  );
  assert.deepEqual(
    resolveCoachTerminalPicks({ bufferedPicks: null, messagePicks: null }),
    [],
  );
});

test("stop / error terminal also prefers buffer over blank ticket", () => {
  // Same resolver used when the user hits Stop mid-hold.
  assert.deepEqual(
    resolveCoachTerminalPicks({
      bufferedPicks: [{ id: "held-ml" }, { id: "held-prop" }],
      messagePicks: undefined,
    }),
    [{ id: "held-ml" }, { id: "held-prop" }],
  );
});
