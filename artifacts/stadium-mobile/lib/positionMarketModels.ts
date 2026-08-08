// Sport → position → market analytics profiles. Profiles describe which real
// inputs are predictive for a specific prop; they never synthesize unavailable
// tracking data. CORE absence prevents a projection, while SUPPORTING and BONUS
// absence only lowers completeness/confidence.

import { impliedProb } from "./format.ts";

export type ModelFeatureTier = "core" | "supporting" | "bonus";
export type PositionMarketFeature = { key: string; tier: ModelFeatureTier; weight: number };
export type PositionMarketModel = {
  sport: string;
  position: string;
  market: string;
  features: PositionMarketFeature[];
};

export type PositionMarketEvaluation = {
  modelKey: string;
  position: string;
  projectedStat: number | null;
  projectedProbabilityOver: number | null;
  projectedProbabilityUnder: number | null;
  impliedMarketProbability: number | null;
  estimatedFairOdds: number | null;
  evPct: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  gradeScore: number | null;
  dataCompletenessPct: number;
  missingCore: string[];
  missingSupporting: string[];
  missingBonus: string[];
};

const core = (...keys: string[]): PositionMarketFeature[] => keys.map((key) => ({ key, tier: "core", weight: 1 }));
const supporting = (...keys: string[]): PositionMarketFeature[] => keys.map((key) => ({ key, tier: "supporting", weight: 0.65 }));
const bonus = (...keys: string[]): PositionMarketFeature[] => keys.map((key) => ({ key, tier: "bonus", weight: 0.35 }));

const footballCommon = [
  ...core("posted_line", "posted_odds", "simulation"),
  ...supporting("injury", "expected_playing_time", "opponent", "home_away", "rest", "weather", "coaching_tendency", "market_movement"),
];

const footballProfiles: PositionMarketModel[] = [
  {
    sport: "nfl", position: "QB", market: "player_pass_yds",
    features: [...footballCommon, ...supporting("cpoe", "epa_per_dropback", "completion_pct", "pressure_rate", "sack_rate", "time_to_throw", "adot", "air_yards", "deep_attempt_pct", "opponent_coverage", "opponent_blitz_rate", "opponent_pressure_rate", "defensive_epa"), ...bonus("red_zone_usage")],
  },
  {
    sport: "nfl", position: "QB", market: "player_pass_tds",
    features: [...footballCommon, ...supporting("epa_per_dropback", "red_zone_usage", "deep_attempt_pct", "opponent_coverage", "opponent_blitz_rate", "defensive_epa"), ...bonus("cpoe", "air_yards")],
  },
  {
    sport: "nfl", position: "QB", market: "player_rush_yds",
    features: [...footballCommon, ...supporting("scramble_rate", "designed_rush_share", "pressure_rate", "sack_rate", "opponent_pressure_rate", "red_zone_usage"), ...bonus("time_to_throw")],
  },
  {
    sport: "nfl", position: "RB", market: "player_rush_yds",
    features: [...footballCommon, ...supporting("snap_share", "opportunity_share", "carries", "yards_after_contact", "missed_tackles_forced", "explosive_run_rate", "offensive_line_matchup", "opponent_rushing_efficiency"), ...bonus("red_zone_carries", "goal_line_carries", "route_participation", "target_share")],
  },
  {
    sport: "nfl", position: "RB", market: "player_anytime_td",
    features: [...footballCommon, ...supporting("snap_share", "opportunity_share", "red_zone_carries", "goal_line_carries", "opponent_rushing_efficiency", "offensive_line_matchup"), ...bonus("target_share")],
  },
  {
    sport: "nfl", position: "WR", market: "player_reception_yds",
    features: [...footballCommon, ...supporting("target_share", "route_participation", "targets_per_route_run", "air_yard_share", "first_read_target_share", "yprr", "adot", "separation", "slot_outside_alignment", "opponent_coverage"), ...bonus("red_zone_targets")],
  },
  {
    sport: "nfl", position: "WR", market: "player_receptions",
    features: [...footballCommon, ...supporting("target_share", "route_participation", "targets_per_route_run", "first_read_target_share", "separation", "slot_outside_alignment", "opponent_coverage"), ...bonus("adot")],
  },
  {
    sport: "nfl", position: "TE", market: "player_reception_yds",
    features: [...footballCommon, ...supporting("route_participation", "target_share", "targets_per_route_run", "yprr", "red_zone_usage", "opposing_lb_s_coverage"), ...bonus("adot")],
  },
  {
    sport: "nfl", position: "TE", market: "player_receptions",
    features: [...footballCommon, ...supporting("route_participation", "target_share", "targets_per_route_run", "opposing_lb_s_coverage"), ...bonus("red_zone_usage")],
  },
];

// NCAA inherits the position-market signals and adds opponent-adjusted context.
const ncaafProfiles = footballProfiles.map((profile) => ({
  ...profile,
  sport: "ncaaf",
  features: [...profile.features, ...supporting("strength_of_schedule", "opponent_adjusted_efficiency", "pace", "garbage_time_filtered", "returning_production", "offensive_line_continuity", "transfer_new_starter_uncertainty")],
}));

export const POSITION_MARKET_MODELS: PositionMarketModel[] = [
  ...footballProfiles,
  ...ncaafProfiles,
  { sport: "mlb", position: "P", market: "pitcher_strikeouts", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("k_pct", "bb_pct", "k_minus_bb_pct", "k_per_9", "bb_per_9", "opponent_k_pct_vs_hand", "opponent_bb_pct_vs_hand", "pitcher_workload", "injury", "weather"), ...bonus("park", "market_movement")] },
  { sport: "mlb", position: "P", market: "pitcher_walks", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("bb_pct", "k_minus_bb_pct", "bb_per_9", "opponent_bb_pct_vs_hand", "pitcher_workload", "injury"), ...bonus("umpire", "market_movement")] },
  { sport: "mlb", position: "BAT", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("recent_form", "platoon", "opposing_pitcher", "lineup_position", "injury"), ...bonus("park", "weather", "market_movement")] },
  { sport: "nba", position: "*", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("minutes", "recent_form", "usage", "pace", "opponent", "injury"), ...bonus("home_away", "rest", "market_movement")] },
  { sport: "wnba", position: "*", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("minutes", "recent_form", "usage", "pace", "opponent", "injury"), ...bonus("home_away", "rest", "market_movement")] },
  { sport: "nhl", position: "SKATER", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("recent_form", "ice_time", "power_play_usage", "opponent_goalie", "injury"), ...bonus("home_away", "rest")] },
  { sport: "soccer", position: "OUTFIELD", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("minutes", "recent_form", "opponent", "injury"), ...bonus("home_away", "rest", "weather")] },
  { sport: "tennis", position: "PLAYER", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("recent_form", "surface", "opponent", "injury"), ...bonus("head_to_head", "travel")] },
  { sport: "ufc", position: "FIGHTER", market: "*", features: [...core("posted_line", "posted_odds", "simulation"), ...supporting("recent_form", "striking", "grappling", "reach", "injury"), ...bonus("camp_change", "weight_cut")] },
];

export function inferPropPosition(sport: string | null | undefined, market: string | null | undefined): string {
  const key = String(market ?? "").toLowerCase();
  if (sport === "nfl" || sport === "ncaaf") {
    if (/pass_/.test(key)) return "QB";
    if (/rush_/.test(key)) return "RB";
    if (/reception/.test(key)) return "WR";
    return "SKILL";
  }
  if (sport === "mlb") return /pitcher/.test(key) ? "P" : "BAT";
  if (sport === "nhl") return "SKATER";
  if (sport === "soccer") return "OUTFIELD";
  if (sport === "tennis") return "PLAYER";
  if (sport === "ufc" || sport === "mma") return "FIGHTER";
  return "*";
}

export function resolvePositionMarketModel(sport: string | null | undefined, position: string | null | undefined, market: string | null | undefined): PositionMarketModel | null {
  const normalizedSport = String(sport ?? "").toLowerCase();
  const normalizedPosition = String(position ?? inferPropPosition(normalizedSport, market)).toUpperCase();
  const normalizedMarket = String(market ?? "").toLowerCase();
  return POSITION_MARKET_MODELS.find((profile) =>
    profile.sport === normalizedSport &&
    (profile.position === normalizedPosition || profile.position === "*") &&
    (profile.market === normalizedMarket || profile.market === "*"),
  ) ?? null;
}

export function evaluatePositionMarketModel(input: {
  sport?: string | null; position?: string | null; market?: string | null; side?: string | null;
  line?: number | null; odds?: number | null; simHit?: number | null; featureScores?: Record<string, number | null | undefined>;
}): PositionMarketEvaluation | null {
  const position = input.position ?? inferPropPosition(input.sport, input.market);
  const profile = resolvePositionMarketModel(input.sport, position, input.market);
  if (!profile) return null;
  const values: Record<string, number | null | undefined> = {
    posted_line: input.line,
    posted_odds: input.odds,
    simulation: input.simHit != null ? input.simHit * 10 : null,
    ...input.featureScores,
  };
  const missing = (tier: ModelFeatureTier) => profile.features.filter((feature) => feature.tier === tier && values[feature.key] == null).map((feature) => feature.key);
  const missingCore = missing("core");
  const missingSupporting = missing("supporting");
  const missingBonus = missing("bonus");
  const totalWeight = profile.features.reduce((total, feature) => total + feature.weight, 0);
  const presentWeight = profile.features.filter((feature) => values[feature.key] != null).reduce((total, feature) => total + feature.weight, 0);
  const scored = profile.features.filter((feature) => typeof values[feature.key] === "number" && feature.key !== "posted_line" && feature.key !== "posted_odds");
  const modelScore = scored.length
    ? scored.reduce((total, feature) => total + Math.max(0, Math.min(10, Number(values[feature.key]))) * feature.weight, 0) / scored.reduce((total, feature) => total + feature.weight, 0)
    : null;
  const probability = input.simHit != null && Number.isFinite(input.simHit)
    ? (/under/i.test(String(input.side)) ? 1 - input.simHit : input.simHit)
    : null;
  const implied = input.odds != null ? impliedProb(input.odds) : null;
  const fairOdds = probability == null || probability <= 0 || probability >= 1 ? null : Math.round(probability >= 0.5 ? -(probability / (1 - probability)) * 100 : ((1 - probability) / probability) * 100);
  const evPct = probability != null && input.odds != null
    ? Math.round((probability * (input.odds > 0 ? input.odds / 100 : 100 / -input.odds) - (1 - probability)) * 1000) / 10
    : null;
  const completeness = totalWeight ? Math.round((presentWeight / totalWeight) * 100) : 0;
  const confidence = modelScore == null ? null : Math.max(5, Math.min(95, Math.round(50 + (modelScore - 5.5) * 8 - missingSupporting.length * 2 - missingBonus.length)));
  return {
    modelKey: `${profile.sport}:${position}:${profile.market}`,
    position,
    projectedStat: null,
    projectedProbabilityOver: input.simHit ?? null,
    projectedProbabilityUnder: input.simHit != null ? 1 - input.simHit : null,
    impliedMarketProbability: implied,
    estimatedFairOdds: fairOdds,
    evPct,
    edgePct: probability != null && implied != null ? Math.round((probability - implied) * 1000) / 10 : null,
    confidencePct: confidence,
    gradeScore: modelScore,
    dataCompletenessPct: completeness,
    missingCore,
    missingSupporting,
    missingBonus,
  };
}
