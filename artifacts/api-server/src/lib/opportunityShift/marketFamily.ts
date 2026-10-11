/**
 * Map prop market strings → Opportunity Shift family ids.
 * Aligned with stadium-mobile sportSeatingAdapters families + nonSeatable gates.
 */

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Families that must never receive a shift (unsupported / non-seatable today). */
export const NON_SEATABLE_FAMILIES: ReadonlySet<string> = new Set([
  // Soccer
  "cards",
  "yellow_cards",
  "red_cards",
  "assists", // soccer assists unsupported
  // NHL
  "saves",
  "player_saves",
  // MLB
  "walks",
  "batter_walks",
  // Tennis
  "aces",
  "double_faults",
  "set_winner",
  "games_props",
  "sets_props",
  // UFC
  "method",
  "round_winner",
  "go_the_distance",
  "significant_strikes",
  "takedowns",
  // NCAAF
  "sacks_ncaaf_blocked",
]);

const DIRECT: Record<string, string> = {
  player_pass_yds: "pass_yds",
  pass_yds: "pass_yds",
  player_pass_attempts: "pass_attempts",
  pass_attempts: "pass_attempts",
  player_pass_completions: "pass_completions",
  pass_completions: "pass_completions",
  player_pass_tds: "pass_tds",
  pass_tds: "pass_tds",
  player_pass_interceptions: "pass_interceptions",
  pass_interceptions: "pass_interceptions",
  player_pass_longest_completion: "pass_longest",
  pass_longest: "pass_longest",
  player_rush_yds: "rush_yds",
  rush_yds: "rush_yds",
  player_rush_attempts: "rush_attempts",
  rush_attempts: "rush_attempts",
  player_rush_longest: "rush_longest",
  rush_longest: "rush_longest",
  player_reception_yds: "rec_yds",
  rec_yds: "rec_yds",
  player_receptions: "receptions",
  receptions: "receptions",
  player_reception_longest: "rec_longest",
  rec_longest: "rec_longest",
  player_anytime_td: "anytime_td",
  anytime_td: "anytime_td",
  player_1st_td: "first_td",
  player_first_td: "first_td",
  first_td: "first_td",
  player_sacks: "sacks",
  sacks: "sacks",
  player_pass_rush_yds: "pass_rush_yds",
  player_rush_reception_yds: "rush_reception_yds",
  player_points: "points",
  points: "points",
  player_rebounds: "rebounds",
  rebounds: "rebounds",
  player_assists: "assists",
  assists: "assists",
  player_threes: "threes",
  threes: "threes",
  player_points_rebounds_assists: "pra",
  pra: "pra",
  player_points_rebounds: "pr",
  pr: "pr",
  player_points_assists: "pa",
  pa: "pa",
  player_rebounds_assists: "ra",
  ra: "ra",
  player_blocks: "blocks",
  blocks: "blocks",
  player_steals: "steals",
  steals: "steals",
  player_blocks_steals: "blocks_steals",
  player_turnovers: "turnovers",
  turnovers: "turnovers",
  player_double_double: "double_double",
  double_double: "double_double",
  batter_hits: "hits",
  hits: "hits",
  batter_total_bases: "total_bases",
  total_bases: "total_bases",
  batter_home_runs: "home_runs",
  home_runs: "home_runs",
  pitcher_strikeouts: "strikeouts",
  strikeouts: "strikeouts",
  batter_stolen_bases: "stolen_bases",
  stolen_bases: "stolen_bases",
  batter_hits_runs_rbis: "hits_runs_rbis",
  batter_rbis: "rbis",
  rbis: "rbis",
  batter_runs_scored: "runs",
  batter_runs: "runs",
  runs: "runs",
  pitcher_outs: "outs",
  outs: "outs",
  batter_walks: "walks",
  walks: "walks",
  player_shots_on_goal: "shots_on_goal",
  shots_on_goal: "shots_on_goal",
  player_goals: "goals",
  goals: "goals",
  player_saves: "saves",
  saves: "saves",
  player_goal_scorer_anytime: "anytime_goal",
  anytime_goal: "anytime_goal",
  player_first_goal_scorer: "first_goal",
  first_goal: "first_goal",
  player_shots_on_target: "shots_on_target",
  shots_on_target: "shots_on_target",
  player_shots: "shots",
  shots: "shots",
  yellow_cards: "yellow_cards",
  red_cards: "red_cards",
  cards: "cards",
};

export function opportunityMarketFamily(
  market: string | null | undefined,
  sport?: string | null,
): string | null {
  const raw = String(market ?? "").trim();
  if (!raw) return null;
  const key = norm(raw);
  const stripped = key.replace(/_alternate$/, "").replace(/_alt$/, "");
  let fam = DIRECT[stripped] ?? DIRECT[key] ?? null;

  if (!fam) {
    const m = raw.toLowerCase();
    if (/pass\s*yd|passing yards/.test(m)) fam = "pass_yds";
    else if (/rush\s*yd|rushing yards/.test(m)) fam = "rush_yds";
    else if (/rec(eption)?\s*yd|receiving yards/.test(m)) fam = "rec_yds";
    else if (/\breceptions?\b/.test(m)) fam = "receptions";
    else if (/rush\s*attempts?|carries/.test(m)) fam = "rush_attempts";
    else if (/pass\s*attempts?/.test(m)) fam = "pass_attempts";
    else if (/pass\s*completions?/.test(m)) fam = "pass_completions";
    else if (/anytime\s*td|touchdown/.test(m) && !/pass/.test(m)) fam = "anytime_td";
    else if (/\bpoints?\b/.test(m) && !/kicking/.test(m)) fam = "points";
    else if (/rebounds?/.test(m)) fam = "rebounds";
    else if (/assists?/.test(m)) fam = "assists";
    else if (/home\s*runs?|\bhr\b/.test(m)) fam = "home_runs";
    else if (/stolen\s*bases?/.test(m)) fam = "stolen_bases";
    else if (/shots?\s*on\s*goal/.test(m)) fam = "shots_on_goal";
    else if (/shots?\s*on\s*target/.test(m)) fam = "shots_on_target";
    else if (/\bshots?\b/.test(m)) fam = "shots";
    else if (/anytime\s*goal/.test(m)) fam = "anytime_goal";
  }

  if (!fam) return null;

  const sp = String(sport ?? "").toLowerCase();
  if (sp === "ncaaf" && fam === "sacks") return null; // non-seatable
  if (sp === "soccer" && (fam === "assists" || fam === "cards")) return null;
  if (NON_SEATABLE_FAMILIES.has(fam)) return null;
  return fam;
}

export function isFamilyShiftAllowed(
  family: string | null | undefined,
  sport?: string | null,
): boolean {
  if (!family) return false;
  const sp = String(sport ?? "").toLowerCase();
  if (sp === "tennis" || sp === "ufc" || sp === "mma") return false;
  if (sp === "ncaaf" && family === "sacks") return false;
  if (NON_SEATABLE_FAMILIES.has(family)) return false;
  return true;
}
