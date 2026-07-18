/**
 * 5-leg Coach correlation smoke test — includes a large scored pool.
 * Run: node --import ./test/register-hooks.mjs scripts/test-coach-correlation-5leg.ts
 */
import {
  COACH_CORRELATION_MAX_CANDIDATES,
  COACH_CORRELATION_MAX_POOL_LEGS,
  runCoachCorrelationStage,
} from "../lib/coachCorrelationPipeline.ts";
import { beginCoachScanPipeline, clearCoachScanPipeline } from "../lib/coachScanPipeline.ts";
import type { BoardScoredLeg } from "../lib/ticketStaging.ts";

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

const requestId = "test-5leg-correlation";
beginCoachScanPipeline(requestId);

const scored: BoardScoredLeg[] = Array.from({ length: 120 }, (_, i) =>
  leg(`T${i % 10} @ U${i % 10}`, `P${i}`, 95 - (i % 40)),
);

const totalStart = Date.now();
const result = await runCoachCorrelationStage(scored, 5, {
  requestId,
  varietySeed: "test-5leg-seed",
});
const totalDurationMs = Date.now() - totalStart;

console.log(
  JSON.stringify(
    {
      requestId,
      legTarget: 5,
      scoredPoolSize: scored.length,
      poolCap: COACH_CORRELATION_MAX_POOL_LEGS,
      candidateCount: result.candidateTicketCount,
      maxCandidates: COACH_CORRELATION_MAX_CANDIDATES,
      correlationsScored: result.correlationsScored,
      correlationDurationMs: result.durationMs,
      usedFallback: result.usedFallback,
      timedOut: result.timedOut,
      finalPickCount: result.outputTicketCount,
      totalRequestDurationMs: totalDurationMs,
      exceptions: result.exceptions,
    },
    null,
    2,
  ),
);

clearCoachScanPipeline(requestId);

if (result.durationMs > 15_000 && !result.timedOut) {
  console.error("FAIL: correlation exceeded 15s without timing out");
  process.exit(1);
}

if (result.outputTicketCount === 0 && scored.length >= 5) {
  console.error("FAIL: expected picks for 5-leg request");
  process.exit(1);
}

console.log("PASS: 5-leg correlation smoke test");
