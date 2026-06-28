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
