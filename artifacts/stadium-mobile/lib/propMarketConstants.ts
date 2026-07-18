// Standalone prop market key ↔ label constants.
// No api, screens, contexts, navigation, or React imports.

export const PROP_MARKET_LABEL_MAP: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  player_rebounds_assists: "Reb+Ast",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_blocks_steals: "Blocks+Steals",
  player_turnovers: "Turnovers",
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
  player_anytime_td: "Anytime TD",
  player_goals: "Goals",
  player_shots_on_goal: "Shots on Goal",
  player_goal_scorer_anytime: "Anytime Goal",
  player_shots_on_target: "Shots on Target",
  player_shots: "Shots",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_hits_runs_rbis: "Hits+Runs+RBIs",
  batter_stolen_bases: "Stolen Bases",
  player_sacks: "Sacks",
  pitcher_strikeouts: "Strikeouts",
};

function normalizePropLabel(value: string): string {
  return value.trim().toLowerCase();
}

export const PROP_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(PROP_MARKET_LABEL_MAP).map(([key, label]) => [
    normalizePropLabel(String(label)),
    key,
  ]),
);

export function propMarketKeyForLabel(label: string): string | undefined {
  return PROP_LABEL_TO_KEY[normalizePropLabel(label)];
}

// Temporary verification — remove after confirming bundle loads on device.
console.log("[prop-market] constants loaded", {
  mapCount: Object.keys(PROP_MARKET_LABEL_MAP).length,
  reverseCount: Object.keys(PROP_LABEL_TO_KEY).length,
});
