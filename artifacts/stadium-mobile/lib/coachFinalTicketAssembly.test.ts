import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import {
  executeFinalTicketHandoff,
  markFinalTicketProgress100,
  resetCoachFinalHandoffForTests,
  wasFinalTicketHandoffCompleted,
} from "./coachFinalTicketAssembly.ts";
import { beginCoachRun, resetCoachRunTraceForTests } from "./coachRunTrace.ts";

const enrich = { realOdds: [], propPool: [], gameMeta: [] };

function leg(id: string, composite: number): ParsedPick {
  return {
    game: `Game ${id}`,
    market: "Points",
    pick: `Over ${id}`,
    odds: -110,
    isProp: true,
    player: `Player ${id}`,
    ticketRole: "main",
    finalAiScore: {
      composite,
      edgePct: 5,
      simHit: 0.55,
      simAligned: true,
      grade: "B+",
      recommends: true,
      confidencePct: 70,
    },
    scores: { composite },
  };
}

test("correlation complete → five cards → progress 100 handoff", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-5-final";
  beginCoachRun(requestId, 5);

  const candidates = Array.from({ length: 5 }, (_, i) => leg(`p${i}`, 100 - i));
  const result = executeFinalTicketHandoff({
    requestId,
    candidates,
    enrich,
    requestedLegs: 5,
    relaxCorrelation: true,
  });

  assert.equal(result.candidateCount, 5);
  assert.equal(result.selectedCount, 5);
  assert.equal(result.picks.length, 5);
  assert.equal(wasFinalTicketHandoffCompleted(requestId), true);

  markFinalTicketProgress100(requestId);
});

test("executeFinalTicketHandoff runs exactly once per requestId", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-once";
  beginCoachRun(requestId, 3);
  const candidates = [leg("a", 90), leg("b", 85), leg("c", 80)];

  const first = executeFinalTicketHandoff({
    requestId,
    candidates,
    enrich,
    requestedLegs: 3,
  });
  const second = executeFinalTicketHandoff({
    requestId,
    candidates,
    enrich,
    requestedLegs: 3,
  });

  assert.ok(first.picks.length >= 1);
  assert.equal(second.skipped, true);
  assert.equal(second.picks.length, 0);
});

test("never returns empty when candidates exist", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-salvage";
  beginCoachRun(requestId, 5);
  const weak = leg("w", 5);
  weak.finalAiScore = { composite: 5, edgePct: -1, simHit: 0.4, simAligned: false, grade: "D" };

  const result = executeFinalTicketHandoff({
    requestId,
    candidates: [weak],
    enrich,
    requestedLegs: 5,
  });

  assert.ok(result.picks.length >= 1);
});
