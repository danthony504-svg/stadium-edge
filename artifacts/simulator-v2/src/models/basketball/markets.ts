import type { SimV2Market, SimV2MarketFamily, SimV2SettlementRule } from "../../schemas/market.js";
import type { SimV2PeriodKey } from "../../schemas/sport.js";
import type { BasketballSport } from "./priors.js";

export type BasketballPeriod = "fg" | "h1" | "h2" | "q1" | "q2" | "q3" | "q4";

export const BASKETBALL_SHADOW_FAMILIES: SimV2MarketFamily[] = [
  "ml",
  "spread",
  "total",
  "team_total",
  "player_prop",
];

function paths(period: BasketballPeriod) {
  if (period === "fg") {
    return { total: "team.totalFg", margin: "team.margin", home: "team.homeFg", away: "team.awayFg" };
  }
  return {
    total: `team.totalByPeriod.${period}`,
    margin: `team.marginByPeriod.${period}`,
    home: `team.homeByPeriod.${period}`,
    away: `team.awayByPeriod.${period}`,
  };
}

function rule(
  partial: Omit<SimV2SettlementRule, "period"> & { period: BasketballPeriod },
): SimV2SettlementRule {
  return { ...partial, period: partial.period as SimV2PeriodKey };
}

export type BuildBasketballMarketArgs = {
  marketId: string;
  eventId: string;
  sport: BasketballSport;
  period?: BasketballPeriod;
  listedAt?: string;
  providerMarketKey?: string;
};

export function buildBasketballTotalMarket(
  args: BuildBasketballMarketArgs & { side: "over" | "under"; line: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
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
      ruleId: `${args.sport}_${period}_total_${args.side}`,
      description: `${args.sport} ${period} total ${args.side} ${args.line}`,
      settlePath: p.total,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildBasketballPlayerPropMarket(
  args: BuildBasketballMarketArgs & {
    playerId: string;
    stat: "points" | "rebounds" | "assists" | "threes";
    side: "over" | "under";
    line: number;
    alternate?: boolean;
  },
): SimV2Market {
  const now = args.listedAt ?? new Date().toISOString();
  const main =
    args.stat === "threes" ? "player_threes" : `player_${args.stat}`;
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "player_prop",
    providerMarketKey:
      args.providerMarketKey ?? (args.alternate ? `${main}_alternate` : main),
    period: "fg",
    side: args.side,
    line: args.line,
    playerId: args.playerId,
    settlement: rule({
      ruleId: `${args.sport}_player_${args.stat}_${args.side}`,
      description: `${args.sport} player ${args.stat} ${args.side} ${args.line}`,
      settlePath: `players.${args.playerId}.stats.${args.stat}`,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period: "fg",
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}
