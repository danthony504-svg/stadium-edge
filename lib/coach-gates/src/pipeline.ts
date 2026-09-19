import type { CoachGateEvaluation, CoachGateId, CoachGateResult } from "@workspace/coach-types";
import { COACH_GATE_IDS } from "@workspace/coach-types";

import { evaluateConfidenceGate } from "./gates/confidence";
import { evaluateInjuriesGate } from "./gates/injuries";
import { evaluateLineMovementGate } from "./gates/lineMovement";
import { evaluateMarketSimSupportGate } from "./gates/marketSimSupport";
import { evaluateMatchupGate } from "./gates/matchup";
import { evaluatePositiveEdgeGate, evaluatePositiveEvGate } from "./gates/positiveEv";
import { evaluateSimulationGate } from "./gates/simulation";
import { evaluateTrendsGate } from "./gates/trends";
import type { CoachGateEvaluateInput } from "./types";

export type CoachGatePipelineResult = CoachGateEvaluation;

/**
 * Fail-closed gate pipeline — evaluates gates in policy order and stops at
 * the first failure. Alt lines use the same gates as main lines.
 */
export function evaluateCoachGates(input: CoachGateEvaluateInput): CoachGatePipelineResult {
  const { candidate, sim, context, adapter, sportContext } = input;
  const results: CoachGateResult[] = [];

  const steps: Array<() => CoachGateResult> = [
    () => evaluateSimulationGate(sim),
    () => evaluatePositiveEvGate(sim),
    () => evaluatePositiveEdgeGate(sim),
    () => evaluateConfidenceGate(sim, adapter),
    () => evaluateMatchupGate(candidate, context.matchup),
    () => evaluateTrendsGate(context.trends),
    () => evaluateInjuriesGate(context.injuries),
    () => evaluateLineMovementGate(context.lineMovement),
    () => adapter.evaluateSportSpecific(candidate, sportContext),
    () => evaluateMarketSimSupportGate(candidate, adapter),
  ];

  if (steps.length !== COACH_GATE_IDS.length) {
    throw new Error(`Gate pipeline length ${steps.length} !== ${COACH_GATE_IDS.length}`);
  }

  let failedGateId: CoachGateId | null = null;

  for (let i = 0; i < steps.length; i += 1) {
    const result = steps[i]();
    if (result.gateId !== COACH_GATE_IDS[i]) {
      throw new Error(`Gate order mismatch at index ${i}: expected ${COACH_GATE_IDS[i]}, got ${result.gateId}`);
    }
    results.push(result);
    if (!result.pass) {
      failedGateId = result.gateId;
      break;
    }
  }

  return {
    legFingerprint: candidate.legFingerprint,
    sport: candidate.sport,
    results,
    allPassed: failedGateId == null,
    failedGateId,
  };
}

export function summarizeRejectionBreakdown(
  evaluations: CoachGateEvaluation[],
): Partial<Record<import("@workspace/coach-types").CoachGateReasonCode, number>> {
  const out: Partial<Record<import("@workspace/coach-types").CoachGateReasonCode, number>> = {};
  for (const ev of evaluations) {
    if (ev.allPassed) continue;
    const failed = ev.results.find((r) => !r.pass);
    if (!failed) continue;
    out[failed.reasonCode] = (out[failed.reasonCode] ?? 0) + 1;
  }
  return out;
}
