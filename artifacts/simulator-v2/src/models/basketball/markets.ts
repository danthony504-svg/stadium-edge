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

/** NCAAB books are halves-first; reject quarter markets for ncaab. */
export function basketballPeriodAllowed(sport: BasketballSport, period: BasketballPeriod): boolean {
  if (sport === "ncaab") return period === "fg" || period === "h1" || period === "h2";
  return true;
}

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

function assertPeriod(sport: BasketballSport, period: BasketballPeriod): void {
  if (!basketballPeriodAllowed(sport, period)) {
    throw new Error(`basketball_period_unsupported:${sport}:${period}`);
  }
}

export function buildBasketballMlMarket(
  args: BuildBasketballMarketArgs & { side: "home" | "away" },
): SimV2Market {
  const period = args.period ?? "fg";
  assertPeriod(args.sport, period);
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "ml",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "h2h" : `${period}_h2h`),
    period,
    side: args.side,
    teamSide: args.side,
    settlement: rule({
      ruleId: `${args.sport}_${period}_ml_${args.side}`,
      description: `${args.sport} ${period} ML ${args.side}`,
      settlePath: p.margin,
      comparator: args.side === "home" ? "home_wins" : "away_wins",
      lineApplies: false,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildBasketballSpreadMarket(
  args: BuildBasketballMarketArgs & { side: "home" | "away"; postedSpread: number },
): SimV2Market {
  const period = args.period ?? "fg";
  assertPeriod(args.sport, period);
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  const isHome = args.side === "home";
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "spread",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "spreads" : `${period}_spreads`),
    period,
    side: args.side,
    teamSide: args.side,
    line: isHome ? -args.postedSpread : args.postedSpread,
    settlement: rule({
      ruleId: `${args.sport}_${period}_spread_${args.side}`,
      description: `${args.sport} spread ${args.side} ${args.postedSpread}`,
      settlePath: p.margin,
      comparator: isHome ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export function buildBasketballTotalMarket(
  args: BuildBasketballMarketArgs & { side: "over" | "under"; line: number },
): SimV2Market {
  const period = args.period ?? "fg";
  assertPeriod(args.sport, period);
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "total",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "totals" : `${period}_totals`),
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

export function buildBasketballTeamTotalMarket(
  args: BuildBasketballMarketArgs & {
    teamSide: "home" | "away";
    side: "over" | "under";
    line: number;
  },
): SimV2Market {
  const period = args.period ?? "fg";
  assertPeriod(args.sport, period);
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "team_total",
    providerMarketKey: args.providerMarketKey ?? "team_totals",
    period,
    side: args.side,
    teamSide: args.teamSide,
    line: args.line,
    settlement: rule({
      ruleId: `${args.sport}_${period}_tt_${args.teamSide}_${args.side}`,
      description: `${args.sport} ${args.teamSide} TT ${args.side} ${args.line}`,
      settlePath: args.teamSide === "home" ? p.home : p.away,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export type BasketballPropStat =
  | "points"
  | "rebounds"
  | "assists"
  | "threes"
  | "pra"
  | "pr"
  | "pa"
  | "ra"
  | "points_q1";

const PROP_KEYS: Record<BasketballPropStat, { main: string; alt: string | null }> = {
  points: { main: "player_points", alt: "player_points_alternate" },
  rebounds: { main: "player_rebounds", alt: "player_rebounds_alternate" },
  assists: { main: "player_assists", alt: "player_assists_alternate" },
  threes: { main: "player_threes", alt: "player_threes_alternate" },
  pra: { main: "player_points_rebounds_assists", alt: null },
  pr: { main: "player_points_rebounds", alt: null },
  pa: { main: "player_points_assists", alt: null },
  ra: { main: "player_rebounds_assists", alt: null },
  points_q1: { main: "player_points_q1", alt: null },
};

export function buildBasketballPlayerPropMarket(
  args: BuildBasketballMarketArgs & {
    playerId: string;
    stat: BasketballPropStat;
    side: "over" | "under";
    line: number;
    alternate?: boolean;
  },
): SimV2Market {
  const now = args.listedAt ?? new Date().toISOString();
  const keys = PROP_KEYS[args.stat];
  if (args.alternate && !keys.alt) throw new Error(`basketball_prop_no_alt:${args.stat}`);
  if (args.stat === "points_q1" && args.sport === "ncaab") {
    throw new Error("basketball_prop_period_unsupported:ncaab:points_q1");
  }
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport,
    family: "player_prop",
    providerMarketKey: args.providerMarketKey ?? (args.alternate ? keys.alt! : keys.main),
    period: args.stat === "points_q1" ? "q1" : "fg",
    side: args.side,
    line: args.line,
    playerId: args.playerId,
    settlement: rule({
      ruleId: `${args.sport}_player_${args.stat}_${args.side}`,
      description: `${args.sport} player ${args.stat} ${args.side} ${args.line}`,
      settlePath: `players.${args.playerId}.stats.${args.stat}`,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period: args.stat === "points_q1" ? "q1" : "fg",
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}
