import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import {
  coachFinalTicketNoValidPicksMessage,
  resolveCoachFinalTicketAfterCorrelation,
  resolveCoachFinalTicketFallback,
} from "./coachFinalTicketCompletion.ts";
import { resetCoachFinalHandoffForTests } from "./coachFinalTicketAssembly.ts";
import { beginCoachRun, resetCoachRunTraceForTests } from "./coachRunTrace.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { COACH_EMPTY_BOARD_SCAN_LEAD } from "./coachBoardScanDelivery.ts";

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

function scanWith(
  picks: ParsedPick[],
  requestId: string,
  requestedLegs: number,
): FullBoardScanResult {
  return {
    picks,
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 100,
    totalQualified: picks.length,
    staging: { mainQualified: picks.length, altQualified: 0 },
    note: "",
    scanComplete: true,
    requestedLegs,
    requestId,
  };
}

test("5 valid candidates → 5 cards → completed phase", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-five-cards";
  beginCoachRun(requestId, 5);
  const candidates = Array.from({ length: 5 }, (_, i) => leg(`p${i}`, 100 - i));
  const result = resolveCoachFinalTicketAfterCorrelation(
    scanWith(candidates, requestId, 5),
    enrich,
    5,
    { requestId, messageCount: 2, phase: "correlation-complete" },
  );
  assert.equal(result.candidateCount, 5);
  assert.equal(result.selectedCount, 5);
  assert.equal(result.picks.length, 5);
  assert.equal(result.outcome, "cards");
  assert.equal(result.phase, "completed");
});

test("3 valid candidates for 5-leg request → 3 cards → completed", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-three-of-five";
  beginCoachRun(requestId, 5);
  const candidates = [leg("a", 95), leg("b", 90), leg("c", 85)];
  const result = resolveCoachFinalTicketAfterCorrelation(
    scanWith(candidates, requestId, 5),
    enrich,
    5,
    { requestId, messageCount: 2, phase: "correlation-complete" },
  );
  assert.equal(result.candidateCount, 3);
  assert.equal(result.selectedCount, 3);
  assert.equal(result.picks.length, 3);
  assert.equal(result.outcome, "cards");
  assert.equal(result.phase, "completed");
});

test("0 candidates → no-valid-picks message", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-zero";
  beginCoachRun(requestId, 5);
  const result = resolveCoachFinalTicketAfterCorrelation(
    scanWith([], requestId, 5),
    enrich,
    5,
    { requestId, messageCount: 2, phase: "correlation-complete" },
  );
  assert.equal(result.candidateCount, 0);
  assert.equal(result.selectedCount, 0);
  assert.equal(result.outcome, "no-valid-picks");
  assert.equal(result.phase, "no-valid-picks");
  assert.equal(coachFinalTicketNoValidPicksMessage(), COACH_EMPTY_BOARD_SCAN_LEAD);
});

test("finalizer timeout fallback → cards → completed", () => {
  resetCoachRunTraceForTests();
  resetCoachFinalHandoffForTests();
  const requestId = "req-fallback";
  beginCoachRun(requestId, 5);
  const candidates = Array.from({ length: 5 }, (_, i) => leg(`f${i}`, 80 - i));
  const result = resolveCoachFinalTicketFallback(
    scanWith(candidates, requestId, 5),
    enrich,
    5,
    { requestId, messageCount: 2 },
  );
  assert.equal(result.selectedCount, 5);
  assert.equal(result.picks.length, 5);
  assert.equal(result.outcome, "cards");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.phase, "completed");
});
