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

export function buildBaseballMlMarket(
  args: BuildBaseballMarketArgs & { side: "home" | "away" },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: "mlb",
    family: "ml",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "h2h" : `${period}_h2h`),
    period,
    side: args.side,
    teamSide: args.side,
    settlement: rule({
      ruleId: `mlb_${period}_ml_${args.side}`,
      description: `MLB ${period} ML ${args.side}`,
      settlePath: p.margin,
      comparator: args.side === "home" ? "home_wins" : "away_wins",
      lineApplies: false,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

/** Run line / alt run line. */
export function buildBaseballSpreadMarket(
  args: BuildBaseballMarketArgs & { side: "home" | "away"; postedSpread: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  const isHome = args.side === "home";
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: "mlb",
    family: "spread",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "spreads" : `${period}_spreads`),
    period,
    side: args.side,
    teamSide: args.side,
    line: isHome ? -args.postedSpread : args.postedSpread,
    settlement: rule({
      ruleId: `mlb_${period}_rl_${args.side}`,
      description: `MLB run line ${args.side} ${args.postedSpread}`,
      settlePath: p.margin,
      comparator: isHome ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

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
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "totals" : `${period}_totals`),
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

export function buildBaseballTeamTotalMarket(
  args: BuildBaseballMarketArgs & {
    teamSide: "home" | "away";
    side: "over" | "under";
    line: number;
  },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period);
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: "mlb",
    family: "team_total",
    providerMarketKey: args.providerMarketKey ?? "team_totals",
    period,
    side: args.side,
    teamSide: args.teamSide,
    line: args.line,
    settlement: rule({
      ruleId: `mlb_${period}_tt_${args.teamSide}_${args.side}`,
      description: `MLB ${args.teamSide} TT ${args.side} ${args.line}`,
      settlePath: args.teamSide === "home" ? p.home : p.away,
      comparator: args.side === "over" ? "gt" : "lt",
      lineApplies: true,
      period,
    }),
    listedAt: now,
    provenance: [{ provider: "sportsbook", fetchedAt: now }],
  };
}

export type BaseballPropStat =
  | "hits"
  | "total_bases"
  | "home_runs"
  | "strikeouts"
  | "rbis"
  | "stolen_bases";

const PROP_KEYS: Record<BaseballPropStat, { main: string; alt: string | null }> = {
  hits: { main: "batter_hits", alt: "batter_hits_alternate" },
  total_bases: { main: "batter_total_bases", alt: "batter_total_bases_alternate" },
  home_runs: { main: "batter_home_runs", alt: "batter_home_runs_alternate" },
  strikeouts: { main: "pitcher_strikeouts", alt: "pitcher_strikeouts_alternate" },
  rbis: { main: "batter_rbis", alt: null },
  stolen_bases: { main: "batter_stolen_bases", alt: null },
};

export function buildBaseballPlayerPropMarket(
  args: BuildBaseballMarketArgs & {
    playerId: string;
    stat: BaseballPropStat;
    side: "over" | "under";
    line: number;
    alternate?: boolean;
  },
): SimV2Market {
  const now = args.listedAt ?? new Date().toISOString();
  const keys = PROP_KEYS[args.stat];
  if (args.alternate && !keys.alt) throw new Error(`baseball_prop_no_alt:${args.stat}`);
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: "mlb",
    family: "player_prop",
    providerMarketKey: args.providerMarketKey ?? (args.alternate ? keys.alt! : keys.main),
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
