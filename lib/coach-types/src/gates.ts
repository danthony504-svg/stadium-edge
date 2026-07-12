import type { CoachSportIdOrCustom } from "./sports";

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
