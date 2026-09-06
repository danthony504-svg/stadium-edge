import type { HistoricalFantasyAnalysis } from "./fantasyNflAnalysis";
import { positionEligibleForSlot, type FantasyRosterPlayer, type FantasyRosterSlot } from "./fantasyRoster";

export type FantasyRecommendation = {
  score: number | null;
  confidence: "High" | "Medium" | "Limited recent data";
  reason: string;
};

export function fantasyRecommendation(
  analysis: HistoricalFantasyAnalysis | undefined,
  injuryStatus?: string,
): FantasyRecommendation {
  if (!analysis?.games || analysis.recentAverage == null) return { score: null, confidence: "Limited recent data", reason: "Limited recent data — no production value was assumed." };
  const usage = (analysis.targetsPerGame ?? 0) * 0.2 + (analysis.carriesPerGame ?? 0) * 0.15 + (analysis.touchesPerGame ?? 0) * 0.1;
  const injuryPenalty = injuryStatus && !/active|healthy/i.test(injuryStatus) ? 3 : 0;
  const score = analysis.recentAverage + usage + (analysis.floor ?? analysis.recentAverage) * 0.1 + (analysis.ceiling ?? analysis.recentAverage) * 0.05 - injuryPenalty;
  return { score, confidence: injuryPenalty ? "Medium" : analysis.games >= 5 ? "High" : "Medium", reason: injuryPenalty ? `Recent production is reduced for ${injuryStatus} status.` : "Ranked by recorded L10 production, usage, floor, and ceiling." };
}

export function selectFantasyStarter(
  players: FantasyRosterPlayer[],
  slot: FantasyRosterSlot,
  analysis: Record<string, HistoricalFantasyAnalysis | undefined>,
  injuries: Record<string, string | undefined>,
) {
  const ranked = players
    .filter((player) => positionEligibleForSlot(player.position, slot))
    .map((player) => ({ player, recommendation: fantasyRecommendation(analysis[player.athleteId], injuries[player.name.toLowerCase()]) }))
    .filter((row) => row.recommendation.score != null)
    .sort((a, b) => b.recommendation.score! - a.recommendation.score! || a.player.athleteId.localeCompare(b.player.athleteId));
  return { winner: ranked[0] ?? null, alternative: ranked[1] ?? null };
}
