import type { SimV2FeatureFlags, SimV2FamilyKey } from "./featureFlags.js";
import { familyKey } from "./featureFlags.js";
import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";
import type { BinaryObservation } from "../metrics/calibration.js";
import { brierScore, expectedCalibrationError, logLoss } from "../metrics/calibration.js";
import type { LatencyStats } from "../metrics/latency.js";

/**
 * Acceptance gates before any sport/family may replace V1.
 * Thresholds must never be loosened to “pass” a weak model.
 */
export const SIM_V2_ACCEPTANCE_THRESHOLDS = {
  minOosSample: 500,
  maxEce: 0.04,
  maxIntegrityRejectRate: 0,
  minCorrectRejectLabelRate: 0.99,
  maxDeepP95Ms: 800,
  /** Fixture / phase_a models can never be accepted. */
  forbidModelIdPrefixes: ["fixture."] as const,
} as const;

export type AcceptanceEvidence = {
  sport: SimV2SportId;
  family: SimV2MarketFamily;
  modelId: string;
  modelVersion: string;
  oosObservations: BinaryObservation[];
  integrityRejectRate: number;
  correctRejectLabelRate: number;
  deepLatency: LatencyStats;
  shadowSoakComplete: boolean;
  contractTestsGreen: boolean;
};

export type AcceptanceDecision = {
  accepted: boolean;
  family: SimV2FamilyKey;
  reasons: string[];
  metrics: {
    brier: number | null;
    logLoss: number | null;
    ece: number | null;
    n: number;
  };
};

export function evaluateAcceptanceGate(evidence: AcceptanceEvidence): AcceptanceDecision {
  const key = familyKey(evidence.sport, evidence.family);
  const reasons: string[] = [];
  const n = evidence.oosObservations.length;
  const brier = brierScore(evidence.oosObservations);
  const ll = logLoss(evidence.oosObservations);
  const ece = expectedCalibrationError(evidence.oosObservations);

  if (SIM_V2_ACCEPTANCE_THRESHOLDS.forbidModelIdPrefixes.some((p) => evidence.modelId.startsWith(p))) {
    reasons.push("fixture_or_forbidden_model_id");
  }
  if (n < SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample) {
    reasons.push(`oos_sample_${n}_lt_${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}`);
  }
  if (ece == null || ece > SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce) {
    reasons.push(`ece_${ece}_gt_${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}`);
  }
  if (evidence.integrityRejectRate > SIM_V2_ACCEPTANCE_THRESHOLDS.maxIntegrityRejectRate) {
    reasons.push("integrity_reject_rate_nonzero");
  }
  if (evidence.correctRejectLabelRate < SIM_V2_ACCEPTANCE_THRESHOLDS.minCorrectRejectLabelRate) {
    reasons.push("reject_label_quality_below_gate");
  }
  if (
    evidence.deepLatency.p95Ms == null ||
    evidence.deepLatency.p95Ms > SIM_V2_ACCEPTANCE_THRESHOLDS.maxDeepP95Ms
  ) {
    reasons.push("deep_latency_p95_above_gate");
  }
  if (!evidence.shadowSoakComplete) reasons.push("shadow_soak_incomplete");
  if (!evidence.contractTestsGreen) reasons.push("contract_tests_not_green");

  return {
    accepted: reasons.length === 0,
    family: key,
    reasons,
    metrics: { brier, logLoss: ll, ece, n },
  };
}

export function isFamilyAcceptedForServe(
  flags: SimV2FeatureFlags,
  sport: SimV2SportId,
  family: SimV2MarketFamily,
): boolean {
  if (flags.forceV1Rollback) return false;
  const key = familyKey(sport, family);
  return flags.acceptedFamilies.includes(key);
}
