/**
 * Request-scoped player-history memo for Coach prop-sim fallback.
 * Lives for one board-scan / Coach request only — never cross-request.
 */

import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import type { LocalHistorySlice } from "./simulatorLocalSim.ts";

export type CoachPropSimHistoryMemoStats = {
  historyCacheHits: number;
  historyCacheMisses: number;
  historyFetches: number;
  athleteIdCacheHits: number;
  athleteIdCacheMisses: number;
  fallbackSkippedServerHit: number;
};

export type CoachPropSimHistoryMemo = {
  /** sport:athleteId → local sim slice (null = fetched empty / failed). */
  historyByAthlete: Map<string, LocalHistorySlice | null>;
  /** In-flight history fetches for coalescing within a request. */
  historyInflight: Map<string, Promise<LocalHistorySlice | null>>;
  /** sport:playerName → athleteId (null = unresolved). */
  athleteIdByPlayer: Map<string, string | null>;
  athleteIdInflight: Map<string, Promise<string | null>>;
  /** Player#athleteId slices for scoring attach. */
  playerHistory: Record<string, PlayerHistorySlice>;
  stats: CoachPropSimHistoryMemoStats;
};

export function createCoachPropSimHistoryMemo(): CoachPropSimHistoryMemo {
  return {
    historyByAthlete: new Map(),
    historyInflight: new Map(),
    athleteIdByPlayer: new Map(),
    athleteIdInflight: new Map(),
    playerHistory: {},
    stats: {
      historyCacheHits: 0,
      historyCacheMisses: 0,
      historyFetches: 0,
      athleteIdCacheHits: 0,
      athleteIdCacheMisses: 0,
      fallbackSkippedServerHit: 0,
    },
  };
}

export function historyMemoKey(sport: string, athleteId: string): string {
  return `${sport.toLowerCase()}:${athleteId}`;
}

export function athleteMemoKey(sport: string, player: string): string {
  return `${sport.toLowerCase()}:${player.trim().toLowerCase()}`;
}
