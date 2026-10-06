/**
 * Live Coach — parse live intent (count + sport scope).
 * Independent of pregame parseAsk / isPregameBettable.
 */

import { wantsLiveCoachAsk } from "./wantsLiveCoachAsk.ts";
import type { LiveCoachSport } from "./remainingGameSim.ts";

export type LiveCoachIntent = {
  wantsLive: boolean;
  /** null = all enabled live sports (NBA + WNBA + NFL). */
  sport: LiveCoachSport | null;
  /** Requested pick count. Never pad below quality/freshness to fill. */
  count: number;
};

const DEFAULT_LIVE_COUNT = 3;
const MAX_LIVE_COUNT = 10;

/**
 * Parse Live Coach asks:
 * - "best live bets" → all live sports, 3 picks
 * - "3 live NBA picks" → nba, 3
 * - "3 live NFL picks" / "NFL live" → nfl
 * - "5 leg" / "5 leg NBA" → wantsLive false (pregame)
 */
export function parseLiveCoachIntent(text?: string | null): LiveCoachIntent {
  const raw = String(text ?? "");
  const t = raw.toLowerCase().trim();
  if (!wantsLiveCoachAsk(t)) {
    return { wantsLive: false, sport: null, count: 0 };
  }

  let sport: LiveCoachSport | null = null;
  // More specific tokens first (wnba before nba; nfl last among overlaps).
  if (/\bwnba\b/.test(t)) sport = "wnba";
  else if (/\bnba\b/.test(t)) sport = "nba";
  else if (/\bnfl\b/.test(t)) sport = "nfl";

  let count = DEFAULT_LIVE_COUNT;
  const numbered =
    t.match(/\b(\d{1,3})\s+live\b/) ||
    t.match(/\blive\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(?:live\s+)?(?:nba|wnba|nfl)\s+picks?\b/) ||
    t.match(/\b(?:nba|wnba|nfl)\s+live\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(?:live\s+)?picks?\b/) ||
    t.match(/\bgive\s+me\s+(\d{1,3})\b/);
  if (numbered) {
    const n = parseInt(numbered[1]!, 10);
    if (Number.isFinite(n) && n > 0) count = Math.min(n, MAX_LIVE_COUNT);
  }

  return { wantsLive: true, sport, count };
}
