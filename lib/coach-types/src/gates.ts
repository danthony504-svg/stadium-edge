import type { CoachSportIdOrCustom } from "./sports";
import {
  coachSimDisqualifier,
  type CoachSimEvidence,
} from "./sim";

/** Ordered gate identifiers — evaluation stops at first failure. */
export const COACH_GATE_IDS = [
  "simulation",
  "positive_ev",
  "positive_edge",
  "confidence_threshold",
  "matchup",
  "trends",
  "injuries",
  "line_movement",
  "sport_specific",
  "market_sim_support",
] as const;

export type CoachGateId = (typeof COACH_GATE_IDS)[number];

export type CoachGateReasonCode =
  | "sim_incomplete"
  | "sim_iterations_insufficient"
  | "ev_not_positive"
  | "edge_not_positive"
  | "confidence_below_threshold"
  | "matchup_failed"
  | "trends_insufficient_sample"
  | "trends_failed"
  | "injury_material_absence"
  | "line_movement_against_pick"
  | "sport_market_unsupported"
  | "sport_rule_violation"
  | "market_no_sim_model"
  | "alt_line_failed"
  | "passed";

export type CoachGateResult = {
  gateId: CoachGateId;
  pass: boolean;
  reasonCode: CoachGateReasonCode;
  message: string;
  metadata?: Record<string, unknown>;
};

export type CoachGateEvaluation = {
  legFingerprint: string;
  sport: CoachSportIdOrCustom;
  results: CoachGateResult[];
  allPassed: boolean;
  failedGateId: CoachGateId | null;
};

/** Canonical G1 evaluation shared by all sport-position-market adapters. */
export function evaluateSimulationGate(
  evidence: CoachSimEvidence | null | undefined,
): CoachGateResult {
  const failure = coachSimDisqualifier(evidence);
  if (!failure && evidence) {
    return {
      gateId: "simulation",
      pass: true,
      reasonCode: "passed",
      message: `Completed ${evidence.iterations.toLocaleString()}-draw ${evidence.engineId} simulation`,
    };
  }
  return {
    gateId: "simulation",
    pass: false,
    reasonCode: failure === "iterations_insufficient" ? "sim_iterations_insufficient" : "sim_incomplete",
    message: `Simulation rejected: ${failure}`,
    metadata: { simulationFailure: failure },
  };
}
