/** Shared coach intent helpers (mirrors stadium-mobile/lib/statLookup.ts). */

export function isCoachRecommendationQuestion(raw: string): boolean {
  const t = String(raw || "").trim();
  const low = t.toLowerCase();
  if (!t) return false;
  if (
    /\b or \b/i.test(t) &&
    /\b(hit|hr|home runs?|homers?|score|get|have|reach|strikeouts?|touchdowns?|goals?|points?|pts|better|more likely)\b/.test(
      low,
    )
  )
    return true;
  if (
    /\b(which|who|compare|better|versus|vs\.?)\b/.test(low) &&
    /\b(hit|hr|bet|pick|play|take|score|get)\b/.test(low)
  )
    return true;
  return false;
}

/** Name-mash left when a comparison ask is parsed as a stat lookup ("willy adames heliot ramos"). */
export function looksLikeComparisonNameMash(query: string): boolean {
  const toks = query.trim().split(/\s+/).filter(Boolean);
  return toks.length >= 4;
}

// When a 4+ token mash is blocked, remember its 2–3 token sub-spans briefly so
// the mobile stat-card span-search fallback (old builds) cannot bind the first
// player and stop before the AI coach path runs.
const MASH_SUBQUERY_TTL_MS = 120_000;
const mashSubqueryBlocks = new Map<string, number>();

function rememberMashSubqueries(query: string): void {
  const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (toks.length < 4) return;
  const now = Date.now();
  for (let len = 2; len <= 3; len++) {
    for (let i = 0; i + len <= toks.length; i++) {
      mashSubqueryBlocks.set(toks.slice(i, i + len).join(" "), now + MASH_SUBQUERY_TTL_MS);
    }
  }
}

function isBlockedMashSubquery(query: string): boolean {
  const key = query.trim().toLowerCase();
  const exp = mashSubqueryBlocks.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    mashSubqueryBlocks.delete(key);
    return false;
  }
  return true;
}

export function shouldBlockPlayerSearch(query: string, rawMessage?: string): boolean {
  if (rawMessage && isCoachRecommendationQuestion(rawMessage)) return true;
  if (looksLikeComparisonNameMash(query)) {
    rememberMashSubqueries(query);
    return true;
  }
  return isBlockedMashSubquery(query);
}
