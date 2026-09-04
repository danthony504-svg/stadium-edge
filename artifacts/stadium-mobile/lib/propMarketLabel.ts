const PROP_MARKET_LABELS: Record<string, string> = {
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

export function propMarketLabel(key: string | null | undefined): string {
  if (!key) return "Prop";
  let k = key;
  let suffix = "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  if (k.endsWith("_q1")) {
    suffix = " (Q1)";
    k = k.slice(0, -3);
  } else if (k.endsWith("_h1")) {
    suffix = " (1H)";
    k = k.slice(0, -3);
  }
  const base =
    PROP_MARKET_LABELS[k] ??
    k.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
  return base + suffix;
}

// Reverse of propMarketLabel for the base (non-period) labels: resolve a human
// market label ("Strikeouts") back to its raw Odds API key ("pitcher_strikeouts")
// so a stored bet-slip leg — which keeps only the label — can open the right
// market on the prop stats page. Returns null for labels we don't recognize
// (e.g. period-suffixed ones), so callers fail closed instead of guessing.
const PROP_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(PROP_MARKET_LABELS).map(([k, v]) => [v.toLowerCase(), k]),
);

export function propMarketKeyForLabel(label: string): string | null {
  return PROP_LABEL_TO_KEY[label.trim().toLowerCase()] ?? null;
}
