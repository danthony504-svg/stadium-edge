import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import { finalizeCoachPipelineTickets } from "./coachPipelineFinalize.ts";
import {
  beginCoachRun,
  isActiveCoachRun,
  logCoachRun,
  resetCoachRunTraceForTests,
} from "./coachRunTrace.ts";

const enrich = { realOdds: [], propPool: [], gameMeta: [] };

function leg(
  id: string,
  composite: number,
  role: "main" | "alt" = "main",
  overrides: Partial<ParsedPick> = {},
): ParsedPick {
  return {
    game: `Game ${id}`,
    market: "Points",
    pick: `Over ${id}`,
    odds: -110,
    isProp: true,
    player: `Player ${id}`,
    ticketRole: role,
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
    ...overrides,
  };
}

function runPipeline(
  candidates: ParsedPick[],
  requestedLegs: number,
  requestId = "req-test",
): ReturnType<typeof finalizeCoachPipelineTickets> {
  return finalizeCoachPipelineTickets({
    requestId,
    candidates,
    enrich,
    requestedLegs,
    relaxCorrelation: true,
  });
}

test("3-leg request returns up to 3 picks when candidates exist", () => {
  const candidates = [leg("a", 95), leg("b", 90), leg("c", 85), leg("d", 80)];
  const result = runPipeline(candidates, 3);
  assert.equal(result.selectedCount, 3);
  assert.equal(result.picks.length, 3);
});

test("5-leg request returns 5 when enough candidates exist", () => {
  const candidates = Array.from({ length: 8 }, (_, i) => leg(`p${i}`, 100 - i));
  const result = runPipeline(candidates, 5);
  assert.equal(result.selectedCount, 5);
});

test("15-leg request returns 15 when enough candidates exist", () => {
  const candidates = Array.from({ length: 20 }, (_, i) => leg(`p${i}`, 120 - i));
  const result = runPipeline(candidates, 15);
  assert.equal(result.selectedCount, 15);
});

test("strict filter shortage still renders at least one card", () => {
  const weak = leg("w", 10);
  weak.finalAiScore = { composite: 10, edgePct: -1, simHit: 0.4, simAligned: false, grade: "D" };
  const result = runPipeline([weak], 5);
  assert.ok(result.selectedCount >= 1, "must render at least one pick");
});

test("correlation relaxed path still fills from ranked pool", () => {
  const candidates = [leg("a", 95), leg("b", 90, "alt"), leg("c", 85)];
  const result = finalizeCoachPipelineTickets({
    requestId: "corr",
    candidates,
    enrich,
    requestedLegs: 3,
    relaxCorrelation: true,
  });
  assert.equal(result.selectedCount, 3);
});

test("duplicate candidates dedupe and continue building", () => {
  const a = leg("dup", 95);
  const b = { ...leg("dup", 90), odds: -105 };
  const c = leg("other", 88);
  const result = runPipeline([a, b, c], 2);
  assert.ok(result.selectedCount >= 1);
  assert.ok(result.selectedCount <= 2);
});

test("alt-line replacement fills shortfall from alt pool", () => {
  const mains = [leg("m1", 70), leg("m2", 65)];
  for (const p of mains) {
    p.finalAiScore = { composite: 10, edgePct: -1, simHit: 0.4, simAligned: false, grade: "D" };
  }
  const alts = [leg("a1", 92, "alt"), leg("a2", 88, "alt"), leg("a3", 84, "alt")];
  const result = runPipeline([...mains, ...alts], 3);
  assert.ok(result.selectedCount >= 1);
});

test("stale requestId is detectable", () => {
  resetCoachRunTraceForTests();
  beginCoachRun("req-a", 5);
  assert.equal(isActiveCoachRun("req-a"), true);
  assert.equal(isActiveCoachRun("req-b"), false);
  assert.equal(logCoachRun("candidates-created", { requestId: "req-b", count: 3 }), false);
});

test("zero candidates returns empty without salvage", () => {
  const result = runPipeline([], 5);
  assert.equal(result.selectedCount, 0);
  assert.equal(result.salvageUsed, false);
});
