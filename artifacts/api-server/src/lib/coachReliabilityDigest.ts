/**
 * Pure Coach reliability digest aggregation (no DB).
 * Consistent denominator = classified parlay outcomes + legacy unknown outcomes.
 */

import {
  COACH_ALERT_EVENT_TYPES,
  percentile,
  shouldAlertCoachEvent,
  type CoachReliabilityMeta,
} from "./coachReliabilitySanitize.js";

export type CoachDigestStats = {
  windowHours: number;
  totalRequests: number;
  successfulRequests: number;
  fulfillmentPct: number | null;
  underfillCount: number;
  legitimateUnderfillCount: number;
  zeroResultCount: number;
  questionFailureCount: number;
  groundingFailureCount: number;
  altMarketFailureCount: number;
  simulationFailureCount: number;
  scanFreezeCount: number;
  /**
   * Legacy / unclassified outcomes (failureReason "unknown") kept separate
   * from underfill/zero/freeze. Included in the fulfillment denominator only.
   */
  unknownOutcomeCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  topFailureReasons: Array<{ reason: string; count: number }>;
};

const CLASSIFIED_PARLAY_OUTCOME_TYPES: ReadonlySet<string> = new Set([
  "parlay_fulfilled",
  "parlay_underfilled",
  "parlay_zero_results",
  "coach_scan_freeze",
]);

/**
 * Pure digest aggregation — consistent denominator =
 * classified parlay outcomes + unknown outcomes. Numerator is successes only.
 */
export function aggregateCoachDigestStats(
  rows: Array<{ meta: CoachReliabilityMeta | null; occurrenceCount: number }>,
  windowHours: number,
): CoachDigestStats {
  let requestEventCount = 0;
  let successfulRequests = 0;
  let underfillCount = 0;
  let legitimateUnderfillCount = 0;
  let zeroResultCount = 0;
  let questionFailureCount = 0;
  let groundingFailureCount = 0;
  let altMarketFailureCount = 0;
  let simulationFailureCount = 0;
  let scanFreezeCount = 0;
  let unknownOutcomeCount = 0;
  const reasonCounts = new Map<string, number>();
  const durations: number[] = [];

  for (const row of rows) {
    const n = row.occurrenceCount ?? 1;
    const meta = row.meta;
    const type = meta?.eventType;
    if (!type) continue;

    if (type === "parlay_requested" || type === "coach_question_received") {
      requestEventCount += n;
    }
    if (type === "parlay_fulfilled") {
      successfulRequests += n;
    }
    if (type === "parlay_underfilled") {
      underfillCount += n;
      if (
        meta?.failureReason === "legitimate_underfill" ||
        meta?.failureReason === "slate_thin" ||
        meta?.failureReason === "underfilled"
      ) {
        legitimateUnderfillCount += n;
      }
    }
    if (type === "parlay_zero_results") zeroResultCount += n;
    if (type === "coach_question_failed" || type === "coach_empty_response") {
      questionFailureCount += n;
    }
    if (type === "coach_grounding_failure") groundingFailureCount += n;
    if (type === "coach_alt_market_failure") altMarketFailureCount += n;
    if (type === "coach_simulation_failure") simulationFailureCount += n;
    if (type === "coach_scan_freeze") scanFreezeCount += n;

    // Legacy unknown outcomes — separate from classified parlay buckets.
    if (
      meta?.failureReason === "unknown" &&
      !CLASSIFIED_PARLAY_OUTCOME_TYPES.has(type) &&
      type !== "parlay_requested" &&
      type !== "coach_question_received"
    ) {
      unknownOutcomeCount += n;
    }

    if (
      meta?.failureReason &&
      meta.failureReason !== "none" &&
      (COACH_ALERT_EVENT_TYPES.has(type) || shouldAlertCoachEvent(meta))
    ) {
      reasonCounts.set(
        meta.failureReason,
        (reasonCounts.get(meta.failureReason) ?? 0) + n,
      );
    }
    const samples = meta?.durationSamples?.length
      ? meta.durationSamples
      : meta?.durationMs != null
        ? [meta.durationMs]
        : [];
    for (const d of samples) {
      if (typeof d === "number" && Number.isFinite(d)) durations.push(d);
    }
  }

  const classifiedParlayOutcomes =
    successfulRequests + underfillCount + zeroResultCount + scanFreezeCount;
  // Consistent denominator: classified outcomes + legacy unknowns (not request events).
  const outcomeDenominator = classifiedParlayOutcomes + unknownOutcomeCount;
  const fulfillmentPct =
    outcomeDenominator > 0
      ? Math.round((1000 * successfulRequests) / outcomeDenominator) / 10
      : null;
  // Prefer explicit request receipts when present; otherwise the outcome denom.
  const totalRequests =
    requestEventCount > 0 ? requestEventCount : outcomeDenominator;

  durations.sort((a, b) => a - b);
  const topFailureReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    windowHours,
    totalRequests,
    successfulRequests,
    fulfillmentPct,
    underfillCount,
    legitimateUnderfillCount,
    zeroResultCount,
    questionFailureCount,
    groundingFailureCount,
    altMarketFailureCount,
    simulationFailureCount,
    scanFreezeCount,
    unknownOutcomeCount,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    topFailureReasons,
  };
}
