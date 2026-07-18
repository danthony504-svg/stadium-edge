/**
 * 5-leg Coach correlation smoke test.
 * Run: node --import ./test/register-hooks.mjs scripts/test-coach-correlation-5leg.ts
 */
import {
  COACH_CORRELATION_MAX_CANDIDATES,
  runCoachCorrelationStage,
} from "../lib/coachCorrelationPipeline.ts";
import { FAST_CORRELATION_HARD_MS } from "../lib/coachFastCorrelation.ts";
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
      candidateCount: result.candidateTicketCount,
      maxCandidates: COACH_CORRELATION_MAX_CANDIDATES,
      ticketsScored: result.correlationsScored,
      correlationDurationMs: result.correlationDurationMs,
      usedFallback: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
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

if (result.durationMs > FAST_CORRELATION_HARD_MS && !result.timedOut) {
  console.error(`FAIL: correlation exceeded ${FAST_CORRELATION_HARD_MS}ms without timing out`);
  process.exit(1);
}

if (result.outputTicketCount === 0 && scored.length >= 5) {
  console.error("FAIL: expected picks for 5-leg request");
  process.exit(1);
}

console.log("PASS: 5-leg correlation smoke test");

// Forced timeout — must still return 5 legs via pre-correlation fallback.
const timeoutRequestId = "test-5leg-correlation-timeout";
beginCoachScanPipeline(timeoutRequestId);
const timeoutStart = Date.now();
const timeoutResult = await runCoachCorrelationStage(scored, 5, {
  requestId: timeoutRequestId,
  varietySeed: "test-5leg-seed-timeout",
  timeoutMs: 1,
});
const timeoutDurationMs = Date.now() - timeoutStart;

console.log(
  JSON.stringify(
    {
      requestId: timeoutRequestId,
      legTarget: 5,
      candidateCount: timeoutResult.candidateCount,
      ticketsScored: timeoutResult.ticketsScored,
      correlationDurationMs: timeoutResult.correlationDurationMs,
      usedFallback: timeoutResult.fallbackUsed,
      fallbackReason: timeoutResult.fallbackReason,
      finalPickCount: timeoutResult.outputTicketCount,
      totalRequestDurationMs: timeoutDurationMs,
    },
    null,
    2,
  ),
);

clearCoachScanPipeline(timeoutRequestId);

if (!timeoutResult.fallbackUsed || timeoutResult.fallbackReason !== "correlation-timeout") {
  console.error("FAIL: forced timeout must set fallbackUsed and correlation-timeout reason");
  process.exit(1);
}

if (timeoutResult.outputTicketCount !== 5) {
  console.error(`FAIL: forced timeout expected 5 picks, got ${timeoutResult.outputTicketCount}`);
  process.exit(1);
}

console.log("PASS: 5-leg correlation forced-timeout fallback");
