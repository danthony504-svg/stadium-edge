/**
 * Football market builders — preserve sportsbook settlement definitions.
 * Odds are never invented here; callers attach SimV2Odds separately.
 */

import type { SimV2Market, SimV2MarketFamily, SimV2SettlementRule } from "../../schemas/market.js";
import type { SimV2PeriodKey } from "../../schemas/sport.js";
import type { FootballSport } from "./priors.js";

export type FootballPeriod = "fg" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2";

function periodSettlePaths(period: FootballPeriod): {
  home: string;
  away: string;
  total: string;
  margin: string;
} {
  if (period === "fg") {
    return {
      home: "team.homeFg",
      away: "team.awayFg",
      total: "team.totalFg",
      margin: "team.margin",
    };
  }
  return {
    home: `team.homeByPeriod.${period}`,
    away: `team.awayByPeriod.${period}`,
    total: `team.totalByPeriod.${period}`,
    margin: `team.marginByPeriod.${period}`,
  };
}

function rule(
  partial: Omit<SimV2SettlementRule, "period"> & { period: FootballPeriod },
): SimV2SettlementRule {
  return { ...partial, period: partial.period as SimV2PeriodKey };
}

export type BuildFootballMarketArgs = {
  marketId: string;
  eventId: string;
  sport: FootballSport;
  period?: FootballPeriod;
  listedAt?: string;
  providerMarketKey?: string;
};

/**
 * Moneyline — home or away wins (no push in sim; ties count as miss for both).
 */
export function buildFootballMlMarket(
  args: BuildFootballMarketArgs & { side: "home" | "away" },
): SimV2Market {
  const period = args.period ?? "fg";
  const paths = periodSettlePaths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "ml",
    providerMarketKey: args.providerMarketKey ?? `${period}_h2h`,
    period,
    side: args.side,
    teamSide: args.side,
    settlement: rule({
      ruleId: `${period}_ml_${args.side}`,
      description: `${period.toUpperCase()} moneyline ${args.side}`,
      settlePath: paths.margin,
      comparator: args.side === "home" ? "home_wins" : "away_wins",
      lineApplies: false,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

/**
 * Spread / alt spread. `postedSpread` is the book line for the chosen side
 * (e.g. home -3.5 → postedSpread = -3.5). Covers when score + postedSpread > opponent.
 * Implemented as margin ? -postedSpread (home) or -margin ? -postedSpread (away).
 */
export function buildFootballSpreadMarket(
  args: BuildFootballMarketArgs & { side: "home" | "away"; postedSpread: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const paths = periodSettlePaths(period);
  const now = args.listedAt ?? new Date().toISOString();
  // home covers S when margin > -S; away covers S when -margin > -S i.e. margin < S? 
  // away +3.5: away + 3.5 > home → -margin > -3.5 → margin < 3.5.
  // For away postedSpread = +3.5: use margin with lt and line = postedSpread.
  // For home postedSpread = -3.5: use margin with gt and line = -postedSpread.
  const isHome = args.side === "home";
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "spread",
    providerMarketKey: args.providerMarketKey ?? `${period}_spreads`,
    period,
    side: args.side,
    teamSide: args.side,
    line: isHome ? -args.postedSpread : args.postedSpread,
    settlement: rule({
      ruleId: `${period}_spread_${args.side}`,
      description: `${period.toUpperCase()} spread ${args.side} ${args.postedSpread}`,
      settlePath: paths.margin,
      comparator: isHome ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildFootballTotalMarket(
  args: BuildFootballMarketArgs & { side: "over" | "under"; line: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const paths = periodSettlePaths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "total",
    providerMarketKey: args.providerMarketKey ?? `${period}_totals`,
    period,
    side: args.side,
    line: args.line,
    settlement: rule({
      ruleId: `${period}_total_${args.side}`,
      description: `${period.toUpperCase()} total ${args.side} ${args.line}`,
      settlePath: paths.total,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildFootballTeamTotalMarket(
  args: BuildFootballMarketArgs & {
    teamSide: "home" | "away";
    side: "over" | "under";
    line: number;
  },
): SimV2Market {
  const period = args.period ?? "fg";
  const paths = periodSettlePaths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "team_total",
    providerMarketKey: args.providerMarketKey ?? `${period}_team_total`,
    period,
    side: args.side,
    teamSide: args.teamSide,
    line: args.line,
    settlement: rule({
      ruleId: `${period}_team_total_${args.teamSide}_${args.side}`,
      description: `${period.toUpperCase()} ${args.teamSide} team total ${args.side} ${args.line}`,
      settlePath: args.teamSide === "home" ? paths.home : paths.away,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export const PHASE_B_FOOTBALL_FAMILIES: SimV2MarketFamily[] = [
  "ml",
  "spread",
  "total",
  "team_total",
];
