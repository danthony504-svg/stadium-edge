import { failGate, passGate } from "../helpers";
import { COACH_MIN_TREND_SAMPLE, COACH_TREND_FAIL_MOMENTUM, type CoachGateTrendSlice } from "../types";

export function evaluateTrendsGate(trends: CoachGateTrendSlice | undefined) {
  if (!trends) {
    return failGate("trends", "trends_insufficient_sample", "No trend data");
  }

  const sampleSize = trends.sampleSize ?? 0;
  if (sampleSize < COACH_MIN_TREND_SAMPLE) {
    return failGate(
      "trends",
      "trends_insufficient_sample",
      `Trend sample ${sampleSize} (need ${COACH_MIN_TREND_SAMPLE})`,
      { sampleSize, minSample: COACH_MIN_TREND_SAMPLE },
    );
  }

  const momentum = trends.momentum;
  if (momentum == null || !Number.isFinite(momentum)) {
    return failGate("trends", "trends_insufficient_sample", "Trend momentum not groundable");
  }

  if (momentum < COACH_TREND_FAIL_MOMENTUM) {
    return failGate(
      "trends",
      "trends_failed",
      `Trend momentum ${momentum.toFixed(2)} against pick`,
      { momentum, sampleSize },
    );
  }

  return passGate("trends", "Trend supports pick", { momentum, sampleSize });
}
