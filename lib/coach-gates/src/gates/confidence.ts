import { COACH_MIN_CONFIDENCE_PCT, type CoachSimResult, type CoachSportAdapter } from "@workspace/coach-types";

import { failGate, passGate } from "../helpers";

export function confidenceFromSim(sim: CoachSimResult | null): number | null {
  const raw = sim?.distributionSummary?.confidenceScore;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

export function minConfidenceForAdapter(adapter: CoachSportAdapter): number {
  const floor = adapter.minConfidencePct;
  if (floor != null && Number.isFinite(floor) && floor > COACH_MIN_CONFIDENCE_PCT) {
    return floor;
  }
  return COACH_MIN_CONFIDENCE_PCT;
}

export function evaluateConfidenceGate(sim: CoachSimResult | null, adapter: CoachSportAdapter) {
  const confidence = confidenceFromSim(sim);
  const minConfidence = minConfidenceForAdapter(adapter);

  if (confidence == null) {
    return failGate(
      "confidence_threshold",
      "confidence_below_threshold",
      "No confidence score from simulation",
    );
  }

  if (confidence < minConfidence) {
    return failGate(
      "confidence_threshold",
      "confidence_below_threshold",
      `Confidence ${confidence}% (need ${minConfidence}%)`,
      { confidencePct: confidence, minConfidencePct: minConfidence },
    );
  }

  return passGate(
    "confidence_threshold",
    `Confidence ${confidence}%`,
    { confidencePct: confidence, minConfidencePct: minConfidence },
  );
}
