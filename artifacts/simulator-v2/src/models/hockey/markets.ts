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

function paths(period: HockeyPeriod, finalGame: boolean) {
  if (period === "fg") {
    // Regulation FG (includeOtSo=false) uses homeFg; final includes OT/SO.
    if (finalGame) {
      return {
        home: "team.nhlFinalHome",
        away: "team.nhlFinalAway",
        total: "team.nhlFinalTotal",
        margin: "team.nhlFinalMargin",
      };
    }
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
  /** When true (default for fg), settle on regulation+OT+SO final. */
  includeOtSo?: boolean;
};

export function buildHockeyMlMarket(
  args: BuildHockeyMarketArgs & { side: "home" | "away" },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period, args.includeOtSo !== false && period === "fg");
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "ml",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "h2h" : `${period}_h2h`),
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

/** Puck line / alt puck line. */
export function buildHockeySpreadMarket(
  args: BuildHockeyMarketArgs & { side: "home" | "away"; postedSpread: number },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period, args.includeOtSo !== false && period === "fg");
  const now = args.listedAt ?? new Date().toISOString();
  const isHome = args.side === "home";
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "spread",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "spreads" : `${period}_spreads`),
    period,
    side: args.side,
    teamSide: args.side,
    line: isHome ? -args.postedSpread : args.postedSpread,
    settlement: rule({
      ruleId: `nhl_${period}_puck_${args.side}`,
      description: `NHL puck line ${args.side} ${args.postedSpread}`,
      settlePath: p.margin,
      comparator: isHome ? "gt" : "lt",
      lineApplies: true,
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
  const p = paths(period, args.includeOtSo !== false && period === "fg");
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "total",
    providerMarketKey: args.providerMarketKey ?? (period === "fg" ? "totals" : `${period}_totals`),
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

export function buildHockeyTeamTotalMarket(
  args: BuildHockeyMarketArgs & {
    teamSide: "home" | "away";
    side: "over" | "under";
    line: number;
  },
): SimV2Market {
  const period = args.period ?? "fg";
  const p = paths(period, args.includeOtSo !== false && period === "fg");
  const now = args.listedAt ?? new Date().toISOString();
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "team_total",
    providerMarketKey: args.providerMarketKey ?? "team_totals",
    period,
    side: args.side,
    teamSide: args.teamSide,
    line: args.line,
    settlement: rule({
      ruleId: `nhl_${period}_tt_${args.teamSide}_${args.side}`,
      description: `NHL ${args.teamSide} team total ${args.side} ${args.line}`,
      settlePath: args.teamSide === "home" ? p.home : p.away,
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
    stat: "goals" | "assists" | "points" | "shots_on_goal" | "saves";
    side: "over" | "under";
    line: number;
    alternate?: boolean;
  },
): SimV2Market {
  const now = args.listedAt ?? new Date().toISOString();
  const mainKey =
    args.stat === "shots_on_goal"
      ? "player_shots_on_goal"
      : args.stat === "saves"
        ? "player_total_saves"
        : `player_${args.stat}`;
  const altKey =
    args.stat === "saves"
      ? null
      : args.stat === "goals"
        ? null
        : `${mainKey}_alternate`;
  if (args.alternate && !altKey) {
    throw new Error(`hockey_prop_no_alt:${args.stat}`);
  }
  return {
    marketId: args.marketId,
    eventId: args.eventId,
    sport: args.sport ?? "nhl",
    family: "player_prop",
    providerMarketKey: args.providerMarketKey ?? (args.alternate ? altKey! : mainKey),
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
