/**
 * Live Coach intent — independent of isPregameBettable / pregame routing.
 * Phase 1: detect only; does not open live tickets.
 */

/**
 * True when the user explicitly asks for LIVE / in-progress bets.
 * Bare N-leg and sport-scoped N-leg stay pregame (false).
 */
export function wantsLiveCoachAsk(text?: string | null): boolean {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t) return false;

  // Explicit live / in-play / in-progress phrasing.
  if (/\blive\s+bets?\b/.test(t)) return true;
  if (/\bbest\s+live\b/.test(t)) return true;
  if (/\blive\s+picks?\b/.test(t)) return true;
  if (/\blive\s+(?:nba|nfl|nhl|mlb|wnba|ncaaf|ncaab|soccer|tennis|ufc)\b/.test(t)) {
    return true;
  }
  if (/\b(?:nba|nfl|nhl|mlb|wnba|ncaaf|ncaab|soccer|tennis|ufc)\s+live\b/.test(t)) {
    return true;
  }
  if (/\b\d{1,3}\s+live\b/.test(t)) return true;
  if (/\blive\s+\d{1,3}\b/.test(t)) return true;
  if (/\bin[-\s]?play\b/.test(t)) return true;
  if (/\bin[-\s]?progress\s+(?:bets?|picks?|games?|odds|lines?)\b/.test(t)) {
    return true;
  }
  if (/\b(?:bets?|picks?|odds|lines?)\s+in[-\s]?progress\b/.test(t)) return true;

  // Lone "live" with betting/pick cues (not "live scores" browse alone).
  if (
    /\blive\b/.test(t) &&
    /\b(bets?|betting|picks?|parlay|legs?|props?|moneylines?|spreads?|totals?)\b/.test(t)
  ) {
    return true;
  }

  return false;
}
