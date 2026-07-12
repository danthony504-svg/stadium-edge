// Pure helpers for grouping spread/total/period alt rungs — no React imports.

import type { RealOddsEntry } from "./api.ts";

export type AltLadderTierLabel = "Safest" | "Best" | "Best Value" | "High Risk";

/** Max plus-money alt rung on pool ladder chips before deep sim (skip junk +40000 lines). */
export const MAX_POOL_LADDER_PLUS_ODDS = 2500;

export function isPostablePoolLadderOdds(odds: number): boolean {
  return Number.isFinite(odds) && odds > -1000 && odds <= MAX_POOL_LADDER_PLUS_ODDS;
}

/** Lowest posted line = Safest; highest = High Risk (Over and Under). */
export function ladderTierForSiblingIndex(i: number, n: number): AltLadderTierLabel {
  if (n <= 1) return "Best";
  if (i === 0) return "Safest";
  if (i === n - 1) return "High Risk";
  if (i === Math.floor(n / 2)) return "Best Value";
  return "Best";
}

export type PoolLadderChampion = { index: number; tierLabel: AltLadderTierLabel };

/** Up to four representative rung indices from a sorted sibling ladder (Safest → High Risk). */
export function poolLadderChampionIndices(n: number): PoolLadderChampion[] {
  if (n <= 0) return [];
  if (n === 1) return [{ index: 0, tierLabel: "Best" }];

  const byIndex = new Map<number, AltLadderTierLabel>();
  const assign = (index: number, tierLabel: AltLadderTierLabel) => {
    if (!byIndex.has(index)) byIndex.set(index, tierLabel);
  };

  assign(0, "Safest");
  assign(n - 1, "High Risk");
  assign(Math.floor(n / 2), "Best Value");

  let bestIdx = Math.max(1, Math.min(n - 2, Math.floor(n * 0.25)));
  while (byIndex.has(bestIdx) && bestIdx < n - 1) bestIdx++;
  if (!byIndex.has(bestIdx)) assign(bestIdx, "Best");

  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, tierLabel]) => ({ index, tierLabel }));
}

export type AltPoolPick = {
  game: string;
  market: string;
  pick: string;
};

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Period-aware market family (mirrors PickCard.marketFamily without React). */
export function marketFamily(s: string): string {
  const m = norm(s);
  const pm = m.match(/\b(1h|2h|h1|h2|q1|q2|q3|q4|f5)\b/);
  let period = pm ? `${pm[1].replace("h1", "1h").replace("h2", "2h")}:` : "";
  if (!period && /\b1st inning\b/.test(m)) period = "1i:";
  let fam: string;
  if (/spread|run ?line|puck ?line/.test(m)) fam = "spread";
  else if (/total|over|under|o\/u/.test(m)) fam = "total";
  else if (/money|h2h|\bml\b/.test(m)) fam = "moneyline";
  else fam = m;
  return period + fam;
}

function baseFamily(market: string): "spread" | "total" | "moneyline" | "other" {
  const fam = marketFamily(market);
  if (fam.endsWith("spread")) return "spread";
  if (fam.endsWith("total")) return "total";
  if (fam.endsWith("moneyline")) return "moneyline";
  return "other";
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  return nick(a).length > 2 && nick(a) === nick(b);
}

export function sameSideAsPick(entry: RealOddsEntry, pick: AltPoolPick): boolean {
  const ep = entry.pick;
  const pp = pick.pick;
  if (/\bover\b/i.test(pp)) return /\bover\b/i.test(ep);
  if (/\bunder\b/i.test(pp)) return /\bunder\b/i.test(ep);
  const pt = pickTeamName(pp);
  const et = pickTeamName(ep);
  if (pt && et) return teamsMatch(pt, et);
  return norm(ep) === norm(pp);
}

/** Spread / total families include main + alt + period rungs for full-ladder analysis. */
export function poolMatchesPickFamily(entry: RealOddsEntry, pick: AltPoolPick): boolean {
  const pickBase = baseFamily(pick.market);
  const entryBase = baseFamily(entry.market);
  if (pickBase === "other" || entryBase === "other") {
    return marketFamily(entry.market) === marketFamily(pick.market);
  }
  return pickBase === entryBase;
}

export function gameAltPoolForPick(pick: AltPoolPick, evalLines: RealOddsEntry[]): RealOddsEntry[] {
  return evalLines.filter(
    (e) => e.game === pick.game && poolMatchesPickFamily(e, pick) && sameSideAsPick(e, pick),
  );
}

function hasPeriodSegment(market: string): boolean {
  const m = market.trim().toLowerCase();
  if (/\b(1h|2h|h1|h2|q1|q2|q3|q4|f5)\b/i.test(m)) return true;
  if (/\b(1st|first)\s+(half|quarter|inning)\b/i.test(m)) return true;
  if (/\b(2nd|second)\s+half\b/i.test(m)) return true;
  if (/\b(3rd|third|4th|fourth)\s+quarter\b/i.test(m)) return true;
  if (/\bfirst\s+five\s+innings\b/i.test(m)) return true;
  return false;
}

/** True for alt spreads/totals, period markets, team totals, F5 run lines — not main ML/spread/total. */
export function isAlternateOrPeriodMarket(market: string): boolean {
  const m = market.trim().toLowerCase();
  if (/^moneyline$|^ml$|^h2h$|money line/.test(m)) return false;
  if (/^spread$/i.test(m)) return false;
  if (/^total$/i.test(m)) return false;
  if (/\balt\b/i.test(m)) return true;
  if (/team total/i.test(m)) return true;
  if (hasPeriodSegment(m)) return true;
  if (/run line|puck line/i.test(m)) return true;
  return false;
}

/** Posted main line for a period segment (1H ML, F5 Total, etc.) — not an alt ladder rung. */
export function isPeriodMainMarket(market: string): boolean {
  const m = market.trim().toLowerCase();
  if (/\balt\b/i.test(m)) return false;
  if (/team total/i.test(m)) return false;
  if (!hasPeriodSegment(m)) return false;
  if (/money|h2h|\bml\b|money line/.test(m)) return true;
  if (/spread|run ?line|puck ?line/.test(m)) return true;
  if (/total|over|under|o\/u/.test(m)) return true;
  return false;
}

/** Main full-game ML / spread / total (incl. picks ending in " ML") — never backup "alt" cards. */
export function isMainLineGameLeg(pick: {
  market: string;
  pick: string;
  isProp?: boolean;
}): boolean {
  if (pick.isProp) return false;
  if (isPeriodMainMarket(pick.market)) return true;
  if (isAlternateOrPeriodMarket(pick.market)) return false;
  const m = pick.market.trim().toLowerCase();
  if (/^moneyline$|^ml$|^h2h$|money line/.test(m)) return true;
  if (/^spread$/i.test(m)) return true;
  if (/^total$/i.test(m)) return true;
  if (/\bml\b/i.test(pick.pick) && !/\balt\b/i.test(m)) return true;
  return false;
}

/** Game-line backup cards must be true alt/period rungs — never main-board ML/spread/total. */
export function isQualifyingBackupGameLine(pick: {
  market: string;
  pick: string;
  isProp?: boolean;
}): boolean {
  if (pick.isProp) return false;
  if (isMainLineGameLeg(pick)) return false;
  return isAlternateOrPeriodMarket(pick.market);
}

/** True for alternate-ladder prop rungs (flagged alt in the prop pool). */
export function isAltPropPick(pick: {
  market: string;
  isProp?: boolean;
  propIsAlt?: boolean;
}): boolean {
  if (!pick.isProp) return false;
  if (pick.propIsAlt) return true;
  return /\balt\b/i.test(pick.market);
}

/** Main full-game or main posted prop line — highest priority when filling a ticket. */
export function isMainBoardPick(pick: {
  market: string;
  pick: string;
  isProp?: boolean;
  propIsAlt?: boolean;
}): boolean {
  if (pick.isProp) return !isAltPropPick(pick);
  return isMainLineGameLeg(pick);
}

/** Alt spread/total/period rung or alternate prop — second stage when reach-N is short. */
export function isAltBoardPick(pick: {
  market: string;
  pick: string;
  isProp?: boolean;
  propIsAlt?: boolean;
}): boolean {
  if (pick.isProp) return isAltPropPick(pick);
  if (isMainLineGameLeg(pick)) return false;
  return isQualifyingBackupGameLine(pick);
}
