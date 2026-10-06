/**
 * Live Coach — parse live intent (count + sport scope).
 * Independent of pregame parseAsk / isPregameBettable.
 */

import { wantsLiveCoachAsk } from "./wantsLiveCoachAsk.ts";
import type { LiveCoachSport } from "./remainingGameSim.ts";

export type LiveCoachIntent = {
  wantsLive: boolean;
  /** null = all enabled live sports (NBA + WNBA + NFL + NHL). */
  sport: LiveCoachSport | null;
  /** Requested pick count. Never pad below quality/freshness to fill. */
  count: number;
};

const DEFAULT_LIVE_COUNT = 3;
/** Same supported range as overall Coach legs (2–15). */
const MIN_LIVE_COUNT = 2;
const MAX_LIVE_COUNT = 15;

/**
 * Clamp an explicit requested count into the supported Coach leg range.
 * Default (no explicit number) stays DEFAULT_LIVE_COUNT and is not clamped here.
 */
function clampLiveCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIVE_COUNT;
  return Math.max(MIN_LIVE_COUNT, Math.min(MAX_LIVE_COUNT, Math.floor(n)));
}

/**
 * Parse Live Coach asks:
 * - "best live bets" / "live bets" → all sports, default 3
 * - "5 leg live" / "5 live legs" / "5 live picks" → count 5
 * - "3 live NHL picks" → nhl, 3
 * - "5 leg NHL" → wantsLive false (pregame)
 *
 * Explicit requested counts always win over the default.
 */
export function parseLiveCoachIntent(text?: string | null): LiveCoachIntent {
  const raw = String(text ?? "");
  const t = raw.toLowerCase().trim();
  if (!wantsLiveCoachAsk(t)) {
    return { wantsLive: false, sport: null, count: 0 };
  }

  let sport: LiveCoachSport | null = null;
  // More specific tokens first (wnba before nba).
  if (/\bwnba\b/.test(t)) sport = "wnba";
  else if (/\bnba\b/.test(t)) sport = "nba";
  else if (/\bnfl\b/.test(t)) sport = "nfl";
  else if (/\bnhl\b/.test(t)) sport = "nhl";

  let count = DEFAULT_LIVE_COUNT;
  // Order: more specific "N leg(s) live" / "N live leg(s)" before bare "N live".
  const numbered =
    t.match(/\b(\d{1,3})\s+legs?\s+live\b/) ||
    t.match(/\b(\d{1,3})\s+live\s+legs?\b/) ||
    t.match(/\b(\d{1,3})\s+live\b/) ||
    t.match(/\blive\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(?:live\s+)?(?:nba|wnba|nfl|nhl)\s+picks?\b/) ||
    t.match(/\b(?:nba|wnba|nfl|nhl)\s+live\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(?:live\s+)?picks?\b/) ||
    t.match(/\bgive\s+me\s+(\d{1,3})\b/);
  if (numbered) {
    count = clampLiveCount(parseInt(numbered[1]!, 10));
  }

  return { wantsLive: true, sport, count };
}
