/**
 * Live Coach Phase 2A — parse live intent (count + sport scope).
 * Independent of pregame parseAsk / isPregameBettable.
 */

import { wantsLiveCoachAsk } from "./wantsLiveCoachAsk.ts";
import type { LiveBasketballSport } from "./remainingGameSim.ts";

export type LiveCoachIntent = {
  wantsLive: boolean;
  /** null = both NBA + WNBA Phase 2A sports. */
  sport: LiveBasketballSport | null;
  /** Requested pick count. Never pad below quality/freshness to fill. */
  count: number;
};

const DEFAULT_LIVE_COUNT = 3;
const MAX_LIVE_COUNT = 10;

/**
 * Parse Live Coach asks:
 * - "best live bets" → both sports, 3 picks
 * - "3 live NBA picks" → nba, 3
 * - "3 live WNBA picks" → wnba, 3
 * - "5 leg" / "5 leg NBA" → wantsLive false (pregame)
 */
export function parseLiveCoachIntent(text?: string | null): LiveCoachIntent {
  const raw = String(text ?? "");
  const t = raw.toLowerCase().trim();
  if (!wantsLiveCoachAsk(t)) {
    return { wantsLive: false, sport: null, count: 0 };
  }

  let sport: LiveBasketballSport | null = null;
  if (/\bwnba\b/.test(t)) sport = "wnba";
  else if (/\bnba\b/.test(t)) sport = "nba";

  let count = DEFAULT_LIVE_COUNT;
  const numbered =
    t.match(/\b(\d{1,3})\s+live\b/) ||
    t.match(/\blive\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(?:live\s+)?(?:nba|wnba)\s+picks?\b/) ||
    t.match(/\b(?:nba|wnba)\s+live\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(?:live\s+)?picks?\b/) ||
    t.match(/\bgive\s+me\s+(\d{1,3})\b/);
  if (numbered) {
    const n = parseInt(numbered[1]!, 10);
    if (Number.isFinite(n) && n > 0) count = Math.min(n, MAX_LIVE_COUNT);
  }

  return { wantsLive: true, sport, count };
}
