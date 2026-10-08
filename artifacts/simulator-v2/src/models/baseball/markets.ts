import type { SimV2Market, SimV2MarketFamily, SimV2SettlementRule } from "../../schemas/market.js";
import type { SimV2PeriodKey } from "../../schemas/sport.js";

export type BaseballPeriod = "fg" | "f5" | "i1";

export const BASEBALL_SHADOW_FAMILIES: SimV2MarketFamily[] = [
  "ml",
  "spread",
  "total",
  "team_total",
  "player_prop",
];

function paths(period: BaseballPeriod) {
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
  partial: Omit<SimV2SettlementRule, "period"> & { period: BaseballPeriod },
): SimV2SettlementRule {
  return { ...partial, period: partial.period as SimV2PeriodKey };
}

export type BuildBaseballMarketArgs = {
  marketId: string;
  eventId: string;
  period?: BaseballPeriod;
  listedAt?: string;
  providerMarketKey?: string;
};

export function buildBaseballTotalMarket(
  args: BuildBaseballMarketArgs & { side: "over" | "under"; line: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: "mlb",
    family: "total",
    providerMarketKey: args.providerMarketKey ?? `${period}_totals`,
    period,
    side: args.side,
    line: args.line,
    settlement: rule({
      ruleId: `mlb_${period}_total_${args.side}`,
      description: `MLB ${period} total ${args.side} ${args.line}`,
      settlePath: p.total,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildBaseballPlayerPropMarket(
  args: BuildBaseballMarketArgs & {
    playerId: string;
    stat: "hits" | "total_bases" | "home_runs" | "strikeouts" | "rbis";
    side: "over" | "under";
    line: number;
    alternate?: boolean;
  },
): SimV2Market {
  const now = args.listedAt ?? new Date().toISOString();
  const main =
    args.stat === "strikeouts"
      ? "pitcher_strikeouts"
      : args.stat === "home_runs"
        ? "batter_home_runs"
        : args.stat === "total_bases"
          ? "batter_total_bases"
          : args.stat === "rbis"
            ? "batter_rbis"
            : "batter_hits";
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: "mlb",
    family: "player_prop",
    providerMarketKey:
      args.providerMarketKey ?? (args.alternate ? `${main}_alternate` : main),
    period: "fg",
    side: args.side,
    line: args.line,
    playerId: args.playerId,
    settlement: rule({
      ruleId: `mlb_player_${args.stat}_${args.side}`,
      description: `MLB ${args.stat} ${args.side} ${args.line}`,
      settlePath: `players.${args.playerId}.stats.${args.stat}`,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period: "fg",
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}
