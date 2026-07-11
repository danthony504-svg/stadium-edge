// Pure helpers for grouping spread/total/period alt rungs — no React imports.

import type { RealOddsEntry } from "./api.ts";

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

/** True for alt spreads/totals, period markets, team totals, F5 run lines — not main ML/spread/total. */
export function isAlternateOrPeriodMarket(market: string): boolean {
  const m = market.trim().toLowerCase();
  if (/^moneyline$/i.test(m)) return false;
  if (/^spread$/i.test(m)) return false;
  if (/^total$/i.test(m)) return false;
  if (/\balt\b/i.test(m)) return true;
  if (/team total/i.test(m)) return true;
  if (/\b(1h|2h|q1|q2|q3|q4|f5|1st inning)\b/i.test(m)) return true;
  if (/run line|puck line/i.test(m)) return true;
  return false;
}
