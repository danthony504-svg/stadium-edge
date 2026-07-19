// Longshot scan engine — bias board search toward plus-money, alts, and upside props.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";
import { isAltPropPick, isAlternateOrPeriodMarket } from "./altLinePool.ts";
import { quickPropPrescore } from "./boardPropPrescore.ts";

export type LongshotScanContext = {
  ticketStyle?: CoachTicketStyle;
  longshotAsk?: boolean;
  targetLegs?: number;
};

export function isLongshotScan(ctx: LongshotScanContext): boolean {
  if (ctx.longshotAsk) return true;
  if (ctx.ticketStyle === "longshot") return true;
  return (ctx.targetLegs ?? 0) >= 15;
}

const LONGSHOT_PROP_MARKETS: Array<{ re: RegExp; bonus: number }> = [
  { re: /home\s*run|\bhr\b/i, bonus: 20 },
  { re: /2\+?\s*hits?|hits?\s*2\+|2\+\s*hits?/i, bonus: 16 },
  { re: /\bhits?\b/i, bonus: 9 },
  { re: /2\+?\s*rbi|rbi.*2\+|2\+\s*rbi/i, bonus: 16 },
  { re: /\brbi/i, bonus: 7 },
  { re: /3\+?\s*(?:strike|k)|strikeout.*3\+|3\+\s*(?:strike|k)/i, bonus: 16 },
  { re: /strikeout|\bks?\b|k's/i, bonus: 9 },
  { re: /stolen|steals?/i, bonus: 18 },
  { re: /total\s*bases?/i, bonus: 11 },
  { re: /\bwalk|\bbb\b/i, bonus: 7 },
];

/** Bonus points added to prescore rank for longshot-favored markets. */
export function longshotMarketBonus(pick: ParsedPick): number {
  const market = String(pick.market ?? pick.propMarketKey ?? "");
  let bonus = 0;

  if (pick.isProp) {
    if (isAltPropPick(pick) || pick.propIsAlt) bonus += 24;
    if (pick.odds != null && pick.odds >= 100) bonus += 10;
    if (pick.odds != null && pick.odds >= 300) bonus += 8;
    if (pick.odds != null && pick.odds >= 600) bonus += 6;
    for (const { re, bonus: b } of LONGSHOT_PROP_MARKETS) {
      if (re.test(market)) {
        bonus += b;
        break;
      }
    }
    return bonus;
  }

  if (isAlternateOrPeriodMarket(market)) bonus += 22;
  if (/1st inning/i.test(market)) bonus += 20;
  if (/alt\s*(?:spread|total|run)/i.test(market)) bonus += 8;
  if (pick.odds != null && pick.odds >= 120) bonus += 14;
  if (/^moneyline$/i.test(market.trim()) && (pick.odds ?? 0) < 0) bonus -= 30;
  return bonus;
}

/** Combined prescore rank: quick EV/matchup/odds + optional longshot bias. */
export function boardScanPrescoreRank(
  pick: ParsedPick,
  baseRank: number,
  ctx: LongshotScanContext,
): number {
  const quick = quickPropPrescore(pick);
  let rank = baseRank + quick.total;
  if (isLongshotScan(ctx)) rank += longshotMarketBonus(pick);
  return rank;
}
