/**
 * Holdout-only minutesTrend attachment for prop-sim history shapes.
 *
 * Production `toPropSimHistoryShape` intentionally omits minutesTrend so MC
 * equations stay unchanged for subscribers. This helper builds a research
 * overlay for separate holdout evaluation — never invents minutes.
 */
import type { AuthoritativePlayerHistory } from "./authoritativePlayerHistory.js";
import { toEnrichmentHistory, toPropSimHistoryShape } from "./authoritativePlayerHistory.js";
import type { PlayerHistoryShape } from "./monteCarloBuild.js";

export type MinutesHoldoutHistory = PlayerHistoryShape & {
  minutesTrend: {
    l5: number | null;
    l10: number | null;
    season: number | null;
    direction: "up" | "down" | "steady";
  } | null;
};

/**
 * Research shape: propsim fields + verified minutesTrend from authoritative history.
 * Callers must not feed this into live Coach seating until holdout validation passes.
 */
export function toPropSimHistoryShapeWithMinutesHoldout(
  auth: AuthoritativePlayerHistory,
  opponentTeamId?: string,
): MinutesHoldoutHistory {
  const base = toPropSimHistoryShape(auth, opponentTeamId);
  const enrich = toEnrichmentHistory(auth, opponentTeamId);
  return {
    ...base,
    minutesTrend: enrich.minutesTrend,
  };
}

export function minutesTrendWouldAffectMean(trend: MinutesHoldoutHistory["minutesTrend"]): boolean {
  if (!trend) return false;
  if (trend.l5 != null && trend.season != null && trend.season > 5) {
    const ratio = trend.l5 / trend.season;
    return ratio < 0.999 || ratio > 1.001;
  }
  return trend.direction === "up" || trend.direction === "down";
}
