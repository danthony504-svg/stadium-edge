import type { PlayerHistoryShape } from "./monteCarloBuild.js";
import {
  loadAuthoritativePlayerHistory,
  toPropSimHistoryShape,
} from "./authoritativePlayerHistory.js";

/**
 * Fetch ESPN game log for propsim — Phase 2.3 routes through the authoritative
 * shared history loader (single-flight + 30m TTL) so Coach enrich can reuse the
 * same underlying fetch without a second provider call.
 */
export async function fetchEspnPlayerHistory(
  sport: string,
  athleteId: string,
  opponentTeamId?: string,
): Promise<PlayerHistoryShape | null> {
  const { history } = await loadAuthoritativePlayerHistory(sport, athleteId);
  if (!history) return null;
  return toPropSimHistoryShape(history, opponentTeamId);
}
