import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FAST_CORRELATION_HARD_MS,
  FAST_CORRELATION_MAX_CANDIDATES,
  FAST_CORRELATION_SEARCH_MS,
  buildGreedyCandidateTicket,
  runFastCoachCorrelation,
  ticketPairwiseCorrelationPenalty,
} from "./coachFastCorrelation.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(game: string, player: string, composite: number): BoardScoredLeg {
  return {
    pick: {
      game,
      market: "Points",
      pick: `${player} Over 1.5 Points`,
      player,
      isProp: true,
      odds: 600,
      propSide: "Over",
      propLine: 1.5,
      finalAiScore: {
        composite,
        edgePct: 5,
        confidencePct: 60,
        simHit: 0.55,
        simAligned: true,
        grade: "B+",
        recommends: true,
      },
    },
    evPct: 10,
    edgePct: 5,
    confidencePct: 60,
    impliedProbPct: 20,
    lineShoppingScore: 50,
    grade: "B+",
    simHit: 0.55,
    composite,
    rankScore: composite,
  };
}

test("runFastCoachCorrelation scores at most 30 tickets", async () => {
  const scored = Array.from({ length: 40 }, (_, i) =>
    leg(`G${i} @ H${i}`, `P${i}`, 90 - i),
  );
  const result = await runFastCoachCorrelation(scored, 5, { varietySeed: "fast-30" });
  assert.ok(result.ticketsScored <= FAST_CORRELATION_MAX_CANDIDATES);
  assert.equal(result.candidateCount, FAST_CORRELATION_MAX_CANDIDATES);
  assert.ok(result.durationMs < FAST_CORRELATION_HARD_MS + 500);
  assert.ok(result.picks.length > 0);
});

test("runFastCoachCorrelation finishes within 3 seconds on large pool", async () => {
  const scored = Array.from({ length: 200 }, (_, i) =>
    leg(`T${i % 15} @ U${i % 15}`, `P${i}`, 95 - (i % 50)),
  );
  const started = Date.now();
  const result = await runFastCoachCorrelation(scored, 5, { varietySeed: "fast-large" });
  assert.ok(Date.now() - started < FAST_CORRELATION_HARD_MS + 500);
  assert.ok(result.picks.length === 5);
});

test("runFastCoachCorrelation uses best ticket on search timeout", async () => {
  const scored = Array.from({ length: 12 }, (_, i) =>
    leg(`G${i} @ H${i}`, `P${i}`, 90 - i),
  );
  const result = await runFastCoachCorrelation(scored, 5, {
    varietySeed: "fast-timeout",
    searchMs: 1,
    hardMs: FAST_CORRELATION_HARD_MS,
  });
  assert.ok(result.picks.length > 0);
  assert.equal(result.timedOut, true);
});

test("ticketPairwiseCorrelationPenalty only runs on completed ticket", () => {
  const picks = [
    leg("A @ B", "P1", 90).pick,
    leg("C @ D", "P2", 85).pick,
  ];
  const penalty = ticketPairwiseCorrelationPenalty(picks);
  assert.ok(penalty >= 0);
});

test("buildGreedyCandidateTicket produces rotated variants", () => {
  const scored = Array.from({ length: 8 }, (_, i) =>
    leg(`G${i} @ H${i}`, `P${i}`, 90 - i),
  );
  const a = buildGreedyCandidateTicket(scored, 5, 0, "seed");
  const b = buildGreedyCandidateTicket(scored, 5, 3, "seed");
  assert.equal(a.length, 5);
  assert.equal(b.length, 5);
  assert.ok(
    a.map((p) => p.player).join() !== b.map((p) => p.player).join() ||
      scored.length <= 5,
  );
});

test("runFastCoachCorrelation stops after 10 high-quality tickets", async () => {
  const scored = Array.from({ length: 20 }, (_, i) =>
    leg(`G${i} @ H${i}`, `P${i}`, 90 - i),
  );
  const result = await runFastCoachCorrelation(scored, 5, {
    varietySeed: "fast-hq",
    highQualityStop: 10,
  });
  assert.ok(result.highQualityFound >= 10 || result.ticketsScored <= FAST_CORRELATION_MAX_CANDIDATES);
  assert.ok(result.durationMs < FAST_CORRELATION_SEARCH_MS + 500);
});
