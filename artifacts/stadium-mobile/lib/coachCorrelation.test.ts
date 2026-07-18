import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.ts";
import {
  COACH_CORRELATION_TIMEOUT_MS,
  greedyCorrelatedPicks,
  maxCorrelationCandidates,
  resetCoachCorrelationForTests,
  runCoachCorrelation,
  runCoachCorrelationSync,
} from "./coachCorrelation.ts";

function leg(id: string, composite: number, game = "Away @ Home"): ParsedPick {
  return {
    game,
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

test("maxCorrelationCandidates caps pool by requested legs", () => {
  assert.equal(maxCorrelationCandidates(3), 12);
  assert.equal(maxCorrelationCandidates(5), 20);
  assert.equal(maxCorrelationCandidates(9), 30);
  assert.equal(maxCorrelationCandidates(15), 40);
});

test("normal correlation completes with five picks for 5-leg request", () => {
  resetCoachCorrelationForTests();
  const candidates = Array.from({ length: 8 }, (_, i) =>
    leg(`p${i}`, 100 - i, `Game ${i} @ Host ${i}`),
  );
  const result = runCoachCorrelationSync({
    requestId: "req-normal",
    candidates,
    requestedLegs: 5,
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.outputCount, 5);
  assert.equal(result.picks.length, 5);
});

test("async correlation completes under the 5 second deadline", async () => {
  resetCoachCorrelationForTests();
  const candidates = Array.from({ length: 10 }, (_, i) =>
    leg(`a${i}`, 95 - i, `Team${i} @ Opp${i}`),
  );
  const result = await runCoachCorrelation({
    requestId: "req-async",
    candidates,
    requestedLegs: 5,
  });
  assert.ok(result.durationMs < COACH_CORRELATION_TIMEOUT_MS);
  assert.equal(result.picks.length, 5);
  assert.equal(result.outcome, "completed");
});

test("timeout fallback still produces five cards when enough candidates exist", () => {
  resetCoachCorrelationForTests();
  const candidates = Array.from({ length: 10 }, (_, i) =>
    leg(`f${i}`, 95 - i, `Team${i} @ Opp${i}`),
  );
  const picks = greedyCorrelatedPicks(candidates, 5);
  assert.equal(picks.length, 5);
});

test("duplicate candidates do not create a loop", () => {
  resetCoachCorrelationForTests();
  const base = leg("dup", 99);
  const candidates = [base, { ...base }, { ...base }, leg("b", 90), leg("c", 85), leg("d", 80)];
  const picks = greedyCorrelatedPicks(candidates, 5);
  const fps = picks.map((p) => `${p.player}|${p.market}|${p.pick}`);
  assert.equal(new Set(fps).size, picks.length);
  assert.ok(picks.length <= 5);
});

test("empty candidate list returns explicit empty outcome", () => {
  resetCoachCorrelationForTests();
  const result = runCoachCorrelationSync({
    requestId: "req-empty",
    candidates: [],
    requestedLegs: 5,
  });
  assert.equal(result.outcome, "empty");
  assert.equal(result.outputCount, 0);
  assert.equal(result.picks.length, 0);
});

test("correlation runs only once per requestId", async () => {
  resetCoachCorrelationForTests();
  const candidates = [leg("a", 95), leg("b", 90), leg("c", 85)];
  const first = await runCoachCorrelation({
    requestId: "req-once",
    candidates,
    requestedLegs: 3,
  });
  const second = await runCoachCorrelation({
    requestId: "req-once",
    candidates,
    requestedLegs: 3,
  });
  assert.equal(first.outputCount, second.outputCount);
  assert.deepEqual(
    first.picks.map((p) => p.player),
    second.picks.map((p) => p.player),
  );
});
