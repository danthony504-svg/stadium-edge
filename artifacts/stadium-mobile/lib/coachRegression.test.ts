import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import { finalizeCoachTicket } from "./coachFinalizeTicket.ts";
import {
  registerCoachPipelineTraceSink,
  resetCoachPipelineTraceForTests,
  tracePipelineBlocked,
  tracePipelineEnter,
} from "./coachPipelineTrace.ts";
import { canAdvanceCoachPhase } from "./coachStateMachine.ts";
import { PROP_MARKET_LABEL_MAP } from "./propMarketLabel.ts";

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

test("no unresolved merge markers in source tree", () => {
  const coachSrc = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  assert.equal(/<<<<<<<|=======|>>>>>>>/.test(coachSrc), false);
});

test("PROP_MARKET_LABEL_MAP is defined at module load", () => {
  assert.ok(Object.keys(PROP_MARKET_LABEL_MAP).length > 10);
});

test("otaUpdater exports background prefetch (not wired into Coach focus)", () => {
  const otaSrc = readFileSync(new URL("./otaUpdater.ts", import.meta.url), "utf8");
  assert.match(otaSrc, /export async function prefetchOtaInBackground/);
  const coachSrc = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  assert.equal(/prefetchAndMaybeApplyOta/.test(coachSrc), false);
  assert.equal(/prefetchOtaInBackground/.test(coachSrc), false);
});

test("coach phase machine only moves forward", () => {
  assert.equal(canAdvanceCoachPhase("correlating", "finalizing", false), true);
  assert.equal(canAdvanceCoachPhase("finalizing", "correlating", false), false);
  assert.equal(canAdvanceCoachPhase("completed", "analyzing", false), false);
  assert.equal(canAdvanceCoachPhase("idle", "loading-markets", true), true);
});

test("finalizeCoachTicket: 5 valid candidates → 5 picks", () => {
  const candidates = Array.from({ length: 5 }, (_, i) => leg(`p${i}`, 100 - i));
  const result = finalizeCoachTicket({
    requestId: "req-5",
    candidates,
    requestedLegs: 5,
    enrich,
  });
  assert.equal(result.candidateCount, 5);
  assert.equal(result.selectedCount, 5);
  assert.equal(result.picks.length, 5);
  assert.equal(result.outcome, "completed");
});

test("finalizeCoachTicket: 3 valid candidates for 5-leg → 3 picks", () => {
  const candidates = [leg("a", 95), leg("b", 90), leg("c", 85)];
  const result = finalizeCoachTicket({
    requestId: "req-3of5",
    candidates,
    requestedLegs: 5,
    enrich,
  });
  assert.equal(result.selectedCount, 3);
  assert.equal(result.picks.length, 3);
  assert.equal(result.outcome, "completed");
});

test("finalizeCoachTicket: 0 candidates → no-valid-picks", () => {
  const result = finalizeCoachTicket({
    requestId: "req-0",
    candidates: [],
    requestedLegs: 5,
    enrich,
  });
  assert.equal(result.outcome, "no-valid-picks");
  assert.equal(result.selectedCount, 0);
});

test("finalizeCoachTicket salvage never returns empty when candidates exist", () => {
  const weak = leg("w", 5);
  weak.finalAiScore = { composite: 5, edgePct: -1, simHit: 0.4, simAligned: false, grade: "D" };
  const result = finalizeCoachTicket({
    requestId: "req-salvage",
    candidates: [weak],
    requestedLegs: 5,
    enrich,
  });
  assert.ok(result.picks.length >= 1);
});

test("coach.tsx: no orphan recovery in useFocusEffect (prevents update depth loop)", () => {
  const coachSrc = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  const focusBlock = coachSrc.match(/useFocusEffect\([\s\S]*?\),\s*\);/)?.[0] ?? "";
  assert.equal(/recoverOrphanCoachThread/.test(focusBlock), false);
});

test("coach.tsx: single finalization entry (runFinalizeCoachTicket)", () => {
  const coachSrc = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  assert.match(coachSrc, /runFinalizeCoachTicket/);
  assert.match(coachSrc, /finalizedRequestIdRef/);
  assert.equal(/5s finalization deadline/.test(coachSrc), false);
  assert.equal(/dead-end-handoff/.test(coachSrc), false);
});

test("coach pipeline trace logs enter/exit snapshot fields", () => {
  resetCoachPipelineTraceForTests();
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    registerCoachPipelineTraceSink(() => ({
      activeRequestId: "req-6",
      sendGeneration: 4,
      scanComplete: false,
      pickCount: 0,
      selectedCount: 0,
      correlationRequestId: null,
      finalizedRequestId: null,
    }));
    tracePipelineEnter("runFinalizeCoachTicket");
    tracePipelineBlocked("runCorrelation", "scan-incomplete");
    assert.match(lines[0]!, /runFinalizeCoachTicket-enter/);
    assert.match(lines[0]!, /"sendGeneration":4/);
    assert.match(lines[1]!, /runCorrelation-blocked/);
    assert.match(lines[1]!, /"condition":"scan-incomplete"/);
  } finally {
    console.log = orig;
    resetCoachPipelineTraceForTests();
  }
});

test("coach.tsx: closing and reopening guarded by finalizedRequestIdRef", () => {
  const coachSrc = readFileSync(new URL("../app/(tabs)/coach.tsx", import.meta.url), "utf8");
  assert.match(coachSrc, /if \(finalizedRequestIdRef\.current === requestId\)/);
  assert.match(coachSrc, /skip-already-finalized/);
});
