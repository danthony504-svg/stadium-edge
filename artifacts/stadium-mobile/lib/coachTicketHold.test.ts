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

test("football absolute flush delivers scored game-line buffer when props miss", () => {
  const buffered = Array.from({ length: 9 }, (_, i) => ({
    isProp: false,
    id: `gl-${i}`,
  }));
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "10 leg nfl",
    requestedLegs: 10,
  });
  assert.equal(out.length, 9, "must not wipe scored GLs into empty ticket");
});

test("football absolute flush while props incomplete holds ≤6 game-line seats", () => {
  const buffered = Array.from({ length: 10 }, (_, i) => ({
    isProp: false,
    id: `gl-${i}`,
  }));
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "10 leg nfl",
    requestedLegs: 10,
    propPhaseIncomplete: true,
  });
  assert.equal(out.length, 6);
  assert.equal(out.filter((p) => p.isProp).length, 0);
});

test("football absolute flush after props finish delivers full GL buffer", () => {
  const buffered = Array.from({ length: 10 }, (_, i) => ({
    isProp: false,
    id: `gl-${i}`,
  }));
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "10 leg nfl",
    requestedLegs: 10,
    propPhaseIncomplete: false,
  });
  assert.equal(out.length, 10);
});

test("football absolute flush keeps props and caps game lines", () => {
  const buffered = [
    ...Array.from({ length: 8 }, (_, i) => ({ isProp: false, id: `gl-${i}` })),
    { isProp: true, id: "td-1" },
    { isProp: true, id: "pass-1" },
  ];
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "10 leg nfl",
    requestedLegs: 10,
  });
  assert.equal(out.filter((p) => p.isProp).length, 2);
  assert.ok(out.length <= 10);
  assert.ok(out.filter((p) => !p.isProp).length <= 6);
});

test("non-football absolute flush keeps full game-line buffer", () => {
  const buffered = Array.from({ length: 8 }, (_, i) => ({
    isProp: false,
    id: `gl-${i}`,
  }));
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "8 leg mlb",
    requestedLegs: 8,
  });
  assert.equal(out.length, 8);
});

test("phone 5-leg MLB absolute flush ships all buffered GLs (not seat cap 2)", () => {
  // boardScanNonPropPreviewCap(5)=2 — old preview seat-cap became the terminal
  // ticket on budget timeout. Non-football flush must keep the full buffer.
  const buffered = Array.from({ length: 5 }, (_, i) => ({
    isProp: false,
    id: `mlb-${i}`,
  }));
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "5 leg all new picks",
    requestedLegs: 5,
    propPhaseIncomplete: true,
  });
  assert.equal(out.length, 5, "must not truncate to reserved non-prop cap of 2");
});
