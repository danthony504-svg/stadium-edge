// Ordered alternate-market fallback when primary props cannot fill a fixed-leg ask.
// Every tier still requires the same AI gates (EV, confidence, sim, correlation, injury).

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltPropPick, isMainBoardPick, isMainLineGameLeg } from "./altLinePool.ts";
import { isTeamTotalMarket } from "./boardMarketPools.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

export type CoachAlternateMarketTier =
  | "mainPlayerProps"
  | "alternatePlayerLines"
  | "teamProps"
  | "gameProps"
  | "firstHalfProps"
  | "quarterPeriodProps"
  | "pitcherPropsMlb"
  | "batterPropsMlb"
  | "nflReceivingRushingPassing"
  | "nbaWnbaPraStats"
  | "nhlSoccerShots"
  | "mlbPitchingStats";

/** Search order — only return fewer legs after every tier is exhausted. */
export const ALTERNATE_MARKET_SEARCH_ORDER: CoachAlternateMarketTier[] = [
  "mainPlayerProps",
  "alternatePlayerLines",
  "teamProps",
  "gameProps",
  "firstHalfProps",
  "quarterPeriodProps",
  "pitcherPropsMlb",
  "batterPropsMlb",
  "nflReceivingRushingPassing",
  "nbaWnbaPraStats",
  "nhlSoccerShots",
  "mlbPitchingStats",
];

const PRIMARY_MARKET_TIERS = new Set<CoachAlternateMarketTier>(["mainPlayerProps"]);

export function isPrimaryMarketTier(tier: CoachAlternateMarketTier): boolean {
  return PRIMARY_MARKET_TIERS.has(tier);
}

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function sportOf(pick: ParsedPick): string {
  return norm(pick.sport ?? "");
}

function marketText(pick: ParsedPick): string {
  return norm(`${pick.market ?? ""} ${pick.propMarketKey ?? ""}`);
}

function hasPlayer(pick: ParsedPick): boolean {
  return Boolean(String(pick.player ?? "").trim());
}

function isFirstHalfMarket(market: string): boolean {
  return /\b(1h|h1|1st half|first half|f5|first five innings|1st inning)\b/.test(market);
}

function isQuarterPeriodMarket(market: string): boolean {
  if (isFirstHalfMarket(market)) return false;
  return /\b(q[1-4]|1st quarter|2nd quarter|3rd quarter|4th quarter|quarter|period|2h|h2|2nd half|second half|inning|p[1-3])\b/.test(
    market,
  );
}

function isTeamPropPick(pick: ParsedPick): boolean {
  if (!pick.isProp) return isTeamTotalMarket(pick.market);
  const m = marketText(pick);
  if (!hasPlayer(pick) && /team|race to|team total/.test(m)) return true;
  return /team total|race to/.test(m);
}

function isGamePropPick(pick: ParsedPick): boolean {
  if (!pick.isProp) return isMainLineGameLeg(pick);
  if (hasPlayer(pick)) return false;
  return !isTeamPropPick(pick);
}

function isMlbPitchingStatMarket(pick: ParsedPick): boolean {
  if (sportOf(pick) !== "mlb") return false;
  const m = marketText(pick);
  return (
    /pitcher_strikeout|pitcher_walk|pitcher_out|pitcher_hit|hits? allowed|outs? recorded/.test(m) ||
    /\b(strikeouts?|walks?|outs? recorded|hits? allowed|earned runs?)\b/.test(m)
  );
}

function isMlbPitcherProp(pick: ParsedPick): boolean {
  if (sportOf(pick) !== "mlb" || !pick.isProp) return false;
  const m = marketText(pick);
  return /pitcher_|pitcher /.test(m) || /\bpitcher\b/.test(m);
}

function isMlbBatterProp(pick: ParsedPick): boolean {
  if (sportOf(pick) !== "mlb" || !pick.isProp) return false;
  const m = marketText(pick);
  return (
    /batter_|batter /.test(m) ||
    /\b(hits?|home runs?|hrs?|total bases?|rbis?|stolen bases?|singles?|doubles?|triples?)\b/.test(m)
  );
}

function isNflSkillProp(pick: ParsedPick): boolean {
  if (sportOf(pick) !== "nfl" || !pick.isProp) return false;
  const m = marketText(pick);
  return /\b(passing|rushing|receiving|receptions?|rec yds?|rush yds?|pass yds?|anytime td|touchdowns?)\b/.test(
    m,
  );
}

function isNbaWnbaStatProp(pick: ParsedPick): boolean {
  const sport = sportOf(pick);
  if ((sport !== "nba" && sport !== "wnba") || !pick.isProp) return false;
  const m = marketText(pick);
  return (
    /\b(points?|pts|rebounds?|rebs?|assists?|asts?|threes?|3pm|3 pointers?|pra|pts\+rebs\+asts|points rebounds assists)\b/.test(
      m,
    ) || /player_points|player_rebounds|player_assists|player_threes|player_points_rebounds_assists/.test(m)
  );
}

function isNhlSoccerShotProp(pick: ParsedPick): boolean {
  const sport = sportOf(pick);
  if (sport !== "nhl" && sport !== "soccer" && !/epl|mls|liga|uefa/.test(sport)) return false;
  if (!pick.isProp) return false;
  const m = marketText(pick);
  return /\b(shots? on goal|sog|shots? on target|sot|shots?|assists?|goals?)\b/.test(m);
}

/** Assign each leg to exactly one search tier (first structural match, then sport buckets). */
export function classifyCoachAlternateMarketTier(pick: ParsedPick): CoachAlternateMarketTier {
  const market = norm(pick.market);

  if (pick.isProp && hasPlayer(pick)) {
    if (isAltPropPick(pick) || pick.propIsAlt) return "alternatePlayerLines";
    if (isFirstHalfMarket(market)) return "firstHalfProps";
    if (isQuarterPeriodMarket(market)) return "quarterPeriodProps";
    return "mainPlayerProps";
  }

  if (isTeamPropPick(pick)) return "teamProps";
  if (isFirstHalfMarket(market)) return "firstHalfProps";
  if (isQuarterPeriodMarket(market)) return "quarterPeriodProps";

  if (pick.isProp) {
    if (isMlbPitchingStatMarket(pick)) return "mlbPitchingStats";
    if (isMlbPitcherProp(pick)) return "pitcherPropsMlb";
    if (isMlbBatterProp(pick)) return "batterPropsMlb";
    if (isNflSkillProp(pick)) return "nflReceivingRushingPassing";
    if (isNbaWnbaStatProp(pick)) return "nbaWnbaPraStats";
    if (isNhlSoccerShotProp(pick)) return "nhlSoccerShots";
    if (isGamePropPick(pick)) return "gameProps";
    return "gameProps";
  }

  if (isGamePropPick(pick)) return "gameProps";
  return "gameProps";
}

export type PartitionedMarketTierPools = Record<CoachAlternateMarketTier, BoardScoredLeg[]>;

export function emptyMarketTierPools(): PartitionedMarketTierPools {
  return {
    mainPlayerProps: [],
    alternatePlayerLines: [],
    teamProps: [],
    gameProps: [],
    firstHalfProps: [],
    quarterPeriodProps: [],
    pitcherPropsMlb: [],
    batterPropsMlb: [],
    nflReceivingRushingPassing: [],
    nbaWnbaPraStats: [],
    nhlSoccerShots: [],
    mlbPitchingStats: [],
  };
}

export function partitionScoredLegsByMarketTier(scored: BoardScoredLeg[]): PartitionedMarketTierPools {
  const pools = emptyMarketTierPools();
  for (const leg of scored) {
    pools[classifyCoachAlternateMarketTier(leg.pick)].push(leg);
  }
  for (const tier of ALTERNATE_MARKET_SEARCH_ORDER) {
    pools[tier].sort((a, b) => b.rankScore - a.rankScore);
  }
  return pools;
}

export function countMarketTierPools(pools: PartitionedMarketTierPools): Record<CoachAlternateMarketTier, number> {
  const out = {} as Record<CoachAlternateMarketTier, number>;
  for (const tier of ALTERNATE_MARKET_SEARCH_ORDER) {
    out[tier] = pools[tier].length;
  }
  return out;
}

export type MarketTierQualification = {
  primaryMarketQualified: number;
  alternateMarketQualified: number;
};

export function countMarketTierQualification(scored: BoardScoredLeg[]): MarketTierQualification {
  let primaryMarketQualified = 0;
  let alternateMarketQualified = 0;
  for (const leg of scored) {
    const tier = classifyCoachAlternateMarketTier(leg.pick);
    if (isPrimaryMarketTier(tier)) primaryMarketQualified += 1;
    else alternateMarketQualified += 1;
  }
  return { primaryMarketQualified, alternateMarketQualified };
}

export function countAlternateMarketOnTicket(picks: ParsedPick[]): number {
  return picks.filter((p) => !isPrimaryMarketTier(classifyCoachAlternateMarketTier(p))).length;
}
