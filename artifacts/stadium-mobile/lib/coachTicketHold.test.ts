import assert from "node:assert/strict";
import test from "node:test";

import {
  coachBudgetStopNoteShouldShow,
  coachTerminalTicketIsComplete,
  filterFlushKnownStartedPicks,
  filterQualifiedFlushSeats,
  resolveCoachTerminalPicks,
  revalidateCoachTerminalDeliveryPicks,
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

test("five-leg budget terminal: before / at / after deadline completeness", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({
    isProp: false,
    id: `leg-${i}`,
    grade: "B",
    confidencePct: 58,
    startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
  }));
  const before = resolveCoachTerminalPicks({
    bufferedPicks: five,
    messagePicks: null,
    askText: "5 leg",
    requestedLegs: 5,
    propPhaseIncomplete: false,
  });
  assert.equal(before.length, 5);
  assert.equal(coachTerminalTicketIsComplete({ picks: before, requestedLegs: 5 }), true);
  assert.equal(
    coachBudgetStopNoteShouldShow({ timedOut: false, pickCount: 5, target: 5 }),
    false,
  );

  // Exactly at deadline with full revalidated buffer — still complete, no stop note.
  assert.equal(
    coachBudgetStopNoteShouldShow({ timedOut: true, pickCount: 5, target: 5 }),
    false,
  );

  const partial = resolveCoachTerminalPicks({
    bufferedPicks: five.slice(0, 3),
    messagePicks: null,
    askText: "5 leg",
    requestedLegs: 5,
  });
  assert.equal(partial.length, 3);
  assert.equal(coachTerminalTicketIsComplete({ picks: partial, requestedLegs: 5 }), false);
  assert.equal(
    coachBudgetStopNoteShouldShow({ timedOut: true, pickCount: 3, target: 5 }),
    true,
  );
});

test("absolute flush revalidates known-started, quality floor, and ALT grounding", () => {
  const started = new Date(Date.now() - 3600_000).toISOString();
  const upcoming = new Date(Date.now() + 4 * 3600_000).toISOString();
  const buffered = [
    {
      isProp: false,
      id: "started",
      market: "Spread",
      game: "Chiefs @ Bills",
      teamAbbr: "KC",
      startsAt: started,
      grade: "A",
      confidencePct: 70,
    },
    {
      isProp: false,
      id: "weak",
      market: "Alt Spread",
      ticketRole: "alt" as const,
      game: "Lakers @ Celtics",
      teamAbbr: "LAL",
      startsAt: upcoming,
      grade: "C",
      confidencePct: 40,
    },
    {
      isProp: true,
      id: "mismatch",
      market: "player_points",
      propMarketKey: "player_points",
      game: "Lakers @ Celtics",
      teamAbbr: "BOS",
      player: "LeBron James",
      startsAt: upcoming,
      grade: "B",
      confidencePct: 60,
    },
    {
      isProp: false,
      id: "ok-alt",
      market: "Alt Spread",
      ticketRole: "alt" as const,
      game: "Yankees @ Red Sox",
      teamAbbr: "NYY",
      startsAt: upcoming,
      grade: "B+",
      confidencePct: 55,
    },
    {
      isProp: false,
      id: "ok-main",
      market: "Spread",
      game: "Bruins @ Leafs",
      teamAbbr: "BOS",
      startsAt: upcoming,
      grade: "B",
      confidencePct: 58,
    },
    {
      isProp: false,
      id: "unknown-start",
      market: "Moneyline",
      game: "Aces @ Liberty",
      teamAbbr: "LV",
      // Missing startsAt must survive flush (enrichment gap ≠ started).
      grade: "B",
      confidencePct: 54,
    },
  ];

  assert.equal(filterFlushKnownStartedPicks(buffered).length, 5);
  assert.equal(filterQualifiedFlushSeats(buffered).length, 5); // drops weak C/40

  const out = revalidateCoachTerminalDeliveryPicks(buffered, { target: 5 });
  const ids = out.map((p) => p.id);
  assert.ok(!ids.includes("started"), "known-started dropped");
  assert.ok(!ids.includes("weak"), "below 52/C+ ALT dropped");
  assert.ok(!ids.includes("mismatch"), "grounding mismatch dropped");
  assert.ok(ids.includes("ok-alt"), "qualified ALT kept");
  assert.ok(ids.includes("ok-main"), "qualified main kept");
  assert.ok(ids.includes("unknown-start"), "unknown startsAt preserved");
});

test("provisional football reserved seats are not a complete five-leg ticket", () => {
  // Football mix + props pending caps GL seats — must not early-terminal as N/N.
  const buffered = Array.from({ length: 5 }, (_, i) => ({
    isProp: false,
    id: `gl-${i}`,
    grade: "B",
    confidencePct: 60,
    startsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
  }));
  const out = resolveCoachTerminalPicks({
    bufferedPicks: buffered,
    messagePicks: null,
    askText: "5 leg nfl",
    requestedLegs: 5,
    propPhaseIncomplete: true,
  });
  assert.ok(out.length < 5, "reserved-seat provisional buffer stays below target");
  assert.equal(coachTerminalTicketIsComplete({ picks: out, requestedLegs: 5 }), false);
});
