import type { SimV2Market, SimV2MarketFamily, SimV2SettlementRule } from "../../schemas/market.js";
import type { SimV2PeriodKey } from "../../schemas/sport.js";
import type { HockeySport } from "./priors.js";

export type HockeyPeriod = "fg" | "p1" | "p2" | "p3";

export const HOCKEY_SHADOW_FAMILIES: SimV2MarketFamily[] = [
  "ml",
  "spread",
  "total",
  "team_total",
  "player_prop",
];

function paths(period: HockeyPeriod) {
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
  partial: Omit<SimV2SettlementRule, "period"> & { period: HockeyPeriod },
): SimV2SettlementRule {
  return { ...partial, period: partial.period as SimV2PeriodKey };
}

export type BuildHockeyMarketArgs = {
  marketId: string;
  eventId: string;
  sport?: HockeySport;
  period?: HockeyPeriod;
  listedAt?: string;
  providerMarketKey?: string;
};

export function buildHockeyMlMarket(
  args: BuildHockeyMarketArgs & { side: "home" | "away" },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "ml",
    providerMarketKey: args.providerMarketKey ?? `${period}_h2h`,
    period,
    side: args.side,
    teamSide: args.side,
    settlement: rule({
      ruleId: `nhl_${period}_ml_${args.side}`,
      description: `NHL ${period} ML ${args.side}`,
      settlePath: p.margin,
      comparator: args.side === "home" ? "home_wins" : "away_wins",
      lineApplies: false,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildHockeyTotalMarket(
  args: BuildHockeyMarketArgs & { side: "over" | "under"; line: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "total",
    providerMarketKey: args.providerMarketKey ?? `${period}_totals`,
    period,
    side: args.side,
    line: args.line,
    settlement: rule({
      ruleId: `nhl_${period}_total_${args.side}`,
      description: `NHL ${period} total ${args.side} ${args.line}`,
      settlePath: p.total,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildHockeyPlayerPropMarket(
  args: BuildHockeyMarketArgs & {
    playerId: string;
    stat: "goals" | "assists" | "points" | "shots_on_goal";
    side: "over" | "under";
    line: number;
    alternate?: boolean;
  },
): SimV2Market {
  const now = args.listedAt ?? new Date().toISOString();
  const mainKey =
    args.stat === "shots_on_goal" ? "player_shots_on_goal" : `player_${args.stat}`;
  const altKey = `${mainKey}_alternate`;
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "player_prop",
    providerMarketKey: args.providerMarketKey ?? (args.alternate ? altKey : mainKey),
    period: "fg",
    side: args.side,
    line: args.line,
    playerId: args.playerId,
    settlement: rule({
      ruleId: `nhl_player_${args.stat}_${args.side}`,
      description: `NHL player ${args.stat} ${args.side} ${args.line}`,
      settlePath: `players.${args.playerId}.stats.${args.stat}`,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period: "fg",
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}
