// Board ranking — style-aware among already-qualified legs; variety when near-equal.

import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { parlayLegKey } from "./parlayVarietyMemory.ts";
import { varietyRankKey } from "./varietySeed.ts";

/** Composite rank scores within this band may tie-break on varietySeed. */
export const NEAR_EQUAL_RANK_SCORE_BAND = 2;

/** Edge (pct points) and confidence (pct points) must both be close to rotate. */
export const NEAR_EQUAL_EDGE_PCT = 2;
export const NEAR_EQUAL_CONFIDENCE_PCT = 6;

/** EV delta (pct points) that lets value-mode prefer the higher-EV leg. */
export const VALUE_EV_LEAD_PCT = 0.25;

/** American-odds delta that lets longshot-mode prefer the longer price. */
export const LONGSHOT_ODDS_LEAD = 1;

export function boardLegsNearlyEqual(a: BoardScoredLeg, b: BoardScoredLeg): boolean {
  if (Math.abs(b.rankScore - a.rankScore) > NEAR_EQUAL_RANK_SCORE_BAND) return false;
  const edgeA = a.edgePct ?? 0;
  const edgeB = b.edgePct ?? 0;
  const confA = a.confidencePct ?? 0;
  const confB = b.confidencePct ?? 0;
  return (
    Math.abs(edgeA - edgeB) <= NEAR_EQUAL_EDGE_PCT &&
    Math.abs(confA - confB) <= NEAR_EQUAL_CONFIDENCE_PCT
  );
}

function legEvSignal(leg: BoardScoredLeg): number {
  if (leg.evPct != null && Number.isFinite(leg.evPct)) return leg.evPct;
  if (leg.edgePct != null && Number.isFinite(leg.edgePct)) return leg.edgePct;
  return Number.NEGATIVE_INFINITY;
}

function legAmericanOdds(leg: BoardScoredLeg): number {
  const odds = leg.pick.odds;
  return odds != null && Number.isFinite(odds) ? odds : Number.NEGATIVE_INFINITY;
}

/**
 * Sort legs among a shared-qualified pool.
 * - value: EV leads (Best Value shortcut)
 * - longshot: higher American odds lead (lottery payout) — chalk cannot outrank
 *   a longer price just because composite rankScore is higher
 * - safe/balanced: composite rankScore, variety when near-equal
 */
export function compareBoardLegsForRank(
  a: BoardScoredLeg,
  b: BoardScoredLeg,
  varietySeed?: string,
  ticketStyle?: CoachTicketStyle | null,
): number {
  if (ticketStyle === "value") {
    const evA = legEvSignal(a);
    const evB = legEvSignal(b);
    if (Math.abs(evB - evA) > VALUE_EV_LEAD_PCT) return evB - evA;
  }

  if (ticketStyle === "longshot") {
    const oddsA = legAmericanOdds(a);
    const oddsB = legAmericanOdds(b);
    if (Math.abs(oddsB - oddsA) >= LONGSHOT_ODDS_LEAD) return oddsB - oddsA;
  }

  const diff = b.rankScore - a.rankScore;
  if (!boardLegsNearlyEqual(a, b)) return diff;

  if (varietySeed) {
    return (
      varietyRankKey(varietySeed, parlayLegKey(a.pick)) -
      varietyRankKey(varietySeed, parlayLegKey(b.pick))
    );
  }
  return diff;
}

export function sortBoardLegsForRank(
  legs: BoardScoredLeg[],
  varietySeed?: string,
  ticketStyle?: CoachTicketStyle | null,
): BoardScoredLeg[] {
  return [...legs].sort((a, b) =>
    compareBoardLegsForRank(a, b, varietySeed, ticketStyle),
  );
}
