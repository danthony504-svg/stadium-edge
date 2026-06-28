/** Shared coach intent helpers (mirrors stadium-mobile/lib/statLookup.ts). */

import { cacheGet, cacheSet } from "./store.js";

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

const MASH_SUBQUERY_TTL_MS = 120_000;

async function rememberMashSubqueries(query: string): Promise<void> {
  const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (toks.length < 4) return;
  for (let len = 2; len <= 3; len++) {
    for (let i = 0; i + len <= toks.length; i++) {
      const sub = toks.slice(i, i + len).join(" ");
      await cacheSet(`coach-mash-sub:${sub}`, "1", MASH_SUBQUERY_TTL_MS);
    }
  }
}

export async function shouldBlockPlayerSearch(
  query: string,
  rawMessage?: string,
): Promise<boolean> {
  if (rawMessage && isCoachRecommendationQuestion(rawMessage)) return true;
  const key = query.trim().toLowerCase();
  if (looksLikeComparisonNameMash(query)) {
    await rememberMashSubqueries(query);
    return true;
  }
  const blocked = await cacheGet<string>(`coach-mash-sub:${key}`);
  return blocked != null;
}
