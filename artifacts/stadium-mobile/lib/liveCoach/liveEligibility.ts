/**
 * Live Coach — mandatory safety gate.
 * Unknown / unsafe state → no recommendation.
 */

import type { NormalizedLiveMarket } from "./types.ts";
import {
  hasUsableLiveClock,
  isEndOfRegulationTransition,
  isExplicitOvertimeState,
  isExplicitShootoutState,
  isFinalState,
  isLiveCoachSport,
  overtimePeriodNumber,
  parseEndOfPeriodLabel,
  type LiveCoachSport,
} from "./remainingGameSim.ts";
import { resolveNhlLiveMarketSettlement } from "./nhlMarketSettlement.ts";

/** Phase 2A + 2B + 3A live sports (mains only). */
export const LIVE_PHASE2A_SPORTS = new Set<LiveCoachSport>(["nba", "wnba"]);
export const LIVE_PHASE2B_SPORTS = new Set<LiveCoachSport>(["nfl"]);
export const LIVE_PHASE3A_SPORTS = new Set<LiveCoachSport>(["nhl"]);
export const LIVE_COACH_SPORTS = new Set<LiveCoachSport>(["nba", "wnba", "nfl", "nhl"]);

/** Full-game live mains only — no props, alts, periods. */
export function isLivePhase2aMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "").trim().toLowerCase();
  if (!m) return false;
  if (
    /\b(alt|alternate|q[1-4]|p[123]|1h|2h|1st|2nd|3rd|4th|half|quarter|period|prop|player)\b/.test(
      m,
    )
  ) {
    return false;
  }
  return (
    m === "moneyline" ||
    m === "spread" ||
    m === "total" ||
    m === "puck line" ||
    m === "puckline"
  );
}

export function isLivePhase2aSport(sport: string | null | undefined): sport is LiveCoachSport {
  return isLiveCoachSport(sport);
}

export type LiveEligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

/**
 * Mandatory safety gate for a normalized live market.
 * All conditions must pass — never substitute a pregame price.
 */
export function evaluateLiveRecommendationEligibility(
  m: NormalizedLiveMarket,
): LiveEligibilityResult {
  const reasons: string[] = [];
  const sport = String(m.sport ?? "").trim().toLowerCase() as LiveCoachSport;

  if (!isLiveCoachSport(m.sport)) {
    reasons.push("sport_not_live_coach");
  }
  if (!isLivePhase2aMarket(m.market)) {
    reasons.push("market_not_live_main");
  }

  const state = String(m.state ?? "").toLowerCase();
  if (state !== "in" && state !== "live") {
    reasons.push("event_not_live");
  }

  if (isFinalState(m.periodLabel)) {
    reasons.push("event_final");
  }

  if (m.awayScore == null || !Number.isFinite(m.awayScore)) {
    reasons.push("missing_away_score");
  }
  if (m.homeScore == null || !Number.isFinite(m.homeScore)) {
    reasons.push("missing_home_score");
  }
  if (m.period == null || !Number.isFinite(m.period) || m.period < 1) {
    reasons.push("missing_period");
  }
  if (!hasUsableLiveClock(m.clock, m.periodLabel, isLiveCoachSport(sport) ? sport : undefined)) {
    reasons.push("missing_usable_clock");
  }

  // End of regulation → OT transition: fail closed unless explicitly in OT/SO.
  if (
    isLiveCoachSport(sport) &&
    isEndOfRegulationTransition(m.period, m.periodLabel, sport)
  ) {
    reasons.push("end_of_regulation_awaiting_ot");
  }

  // Period transitions without a genuine provider timestamp cannot prove the
  // sportsbook quote still matches the board (fetchedAt ≠ provider sync).
  if (
    parseEndOfPeriodLabel(m.periodLabel) &&
    (m.providerLastUpdate == null || String(m.providerLastUpdate).trim() === "")
  ) {
    reasons.push("transition_unsynchronized_quote");
  }

  // Explicit OT required for overtime-period recommendations.
  if (isLiveCoachSport(sport)) {
    const otPeriod = overtimePeriodNumber(sport);
    if (
      m.period != null &&
      m.period >= otPeriod &&
      !isExplicitOvertimeState(m.period, m.periodLabel, sport) &&
      !isExplicitShootoutState(m.period, m.periodLabel)
    ) {
      reasons.push("ot_state_not_explicit");
    }
  }

  // NHL shootout: totals / puck lines exclude SO goals — reject those markets.
  if (
    sport === "nhl" &&
    isExplicitShootoutState(m.period, m.periodLabel)
  ) {
    const market = String(m.market ?? "").toLowerCase();
    if (market === "total" || market === "spread" || market === "puck line" || market === "puckline") {
      reasons.push("nhl_shootout_excludes_total_spread");
    }
  }

  // NHL settlement must be determinable for the specific market.
  if (sport === "nhl" && isLivePhase2aMarket(m.market)) {
    const settlement = resolveNhlLiveMarketSettlement({
      market: m.market,
      pick: m.pick,
    });
    if (!settlement.ok) {
      reasons.push(settlement.reason);
    }
  }

  const market = String(m.market ?? "").toLowerCase();
  if (
    market === "spread" ||
    market === "total" ||
    market === "puck line" ||
    market === "puckline"
  ) {
    if (m.line == null || !Number.isFinite(m.line)) {
      reasons.push("missing_live_line");
    }
  }
  if (m.price == null || !Number.isFinite(m.price) || m.price === 0) {
    reasons.push("missing_live_price");
  }

  if (!String(m.eventId ?? "").trim()) {
    reasons.push("missing_event_id");
  }

  if (m.freshness === "stale") reasons.push("stale_quote");
  if (m.freshness === "unknown") reasons.push("unknown_freshness");

  if (m.gameStateAdvanced) reasons.push("game_state_advanced");

  if (m.marketStatus === "suspended") reasons.push("suspended");
  if (m.marketStatus === "closed") reasons.push("closed");
  if (m.marketStatus === "unknown") reasons.push("unknown_market_status");
  if (m.marketStatus !== "open") {
    if (
      !reasons.includes("suspended") &&
      !reasons.includes("closed") &&
      !reasons.includes("unknown_market_status")
    ) {
      reasons.push("market_not_open");
    }
  }

  if (m.unsafe) {
    for (const r of m.unsafeReasons) {
      if (!reasons.includes(r)) reasons.push(r);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

export function isLiveRecommendationEligible(m: NormalizedLiveMarket): boolean {
  return evaluateLiveRecommendationEligibility(m).eligible;
}
