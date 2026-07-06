// Sport-specific evaluation factor catalogs — advisory + future rubric wiring.
// Factors without live feeds stay qualitative in propFactors / teamFactors cards.

export type EvalFactorTier = "critical" | "important" | "useful";

export type SportEvalFactor = {
  key: string;
  label: string;
  tier: EvalFactorTier;
  /** Prop-only, game/team-only, or both */
  scope: "prop" | "team" | "both";
};

export type SportEvalCatalog = {
  sport: string;
  label: string;
  teamFactors: SportEvalFactor[];
  propFactors: SportEvalFactor[];
  propMarkets?: string[];
};

const team = (key: string, label: string, tier: EvalFactorTier = "important"): SportEvalFactor => ({
  key,
  label,
  tier,
  scope: "team",
});

const prop = (key: string, label: string, tier: EvalFactorTier = "important"): SportEvalFactor => ({
  key,
  label,
  tier,
  scope: "prop",
});

const both = (key: string, label: string, tier: EvalFactorTier = "important"): SportEvalFactor => ({
  key,
  label,
  tier,
  scope: "both",
});

export const SOCCER_EVAL: SportEvalCatalog = {
  sport: "soccer",
  label: "Soccer / World Cup",
  teamFactors: [
    team("elo", "Team ELO rating", "important"),
    team("xg", "Expected Goals (xG)", "critical"),
    team("xa", "Expected Assists (xA)", "important"),
    team("shots_on_target", "Shots on target", "important"),
    team("big_chances", "Big chances created / allowed", "important"),
    team("possession", "Possession %", "useful"),
    team("ppda", "Pressing (PPDA)", "useful"),
    team("home_away_form", "Home vs away form", "important"),
    team("rest", "Rest days", "important"),
    team("injuries", "Injuries and suspensions", "critical"),
    team("travel", "Travel distance", "useful"),
    team("weather", "Weather", "useful"),
    team("h2h", "Head-to-head history", "important"),
    team("motivation", "Motivation (must-win, group, knockout)", "important"),
    team("lineup", "Starting lineup confirmation", "critical"),
    team("line_movement", "Live betting market movement", "important"),
  ],
  propFactors: [
    prop("goals", "Goals"),
    prop("assists", "Assists"),
    prop("shots", "Shots"),
    prop("shots_on_target", "Shots on target"),
    prop("passes", "Passes"),
    prop("tackles", "Tackles"),
    prop("saves", "Saves"),
    prop("corners", "Corners"),
    prop("cards", "Cards"),
    both("set_pieces", "Set-piece role", "critical"),
    both("penalty_taker", "Penalty taker", "critical"),
  ],
};

export const TENNIS_EVAL: SportEvalCatalog = {
  sport: "tennis",
  label: "Tennis",
  teamFactors: [
    team("surface", "Surface (grass, clay, hard)", "critical"),
    team("h2h", "Head-to-head", "important"),
    team("hold_pct", "Hold %", "important"),
    team("break_pct", "Break %", "important"),
    team("first_serve", "First serve %", "important"),
    team("first_serve_won", "First serve points won", "important"),
    team("second_serve_won", "Second serve points won", "important"),
    team("aces", "Aces", "useful"),
    team("double_faults", "Double faults", "useful"),
    team("return_won", "Return points won", "important"),
    team("tiebreak", "Tie-break record", "useful"),
    team("form", "Recent form", "important"),
    team("fatigue", "Fatigue (hours played)", "critical"),
    team("rest", "Days of rest", "important"),
    team("indoor_outdoor", "Indoor vs outdoor", "useful"),
    team("injury", "Injury history", "critical"),
    team("handedness", "Lefty vs righty", "useful"),
    team("elo", "Elo rating", "important"),
    team("line_movement", "Live line movement", "important"),
  ],
  propFactors: [
    prop("match_winner", "Match winner", "critical"),
    prop("games", "Games"),
    prop("sets", "Sets"),
    prop("aces", "Aces"),
    prop("double_faults", "Double faults"),
    prop("breaks", "Breaks of serve"),
  ],
};

export const BASKETBALL_EVAL: SportEvalCatalog = {
  sport: "basketball",
  label: "NBA / WNBA",
  teamFactors: [
    team("pace", "Pace", "important"),
    team("usage", "Usage rate", "critical"),
    team("minutes", "Minutes projection", "critical"),
    team("matchup_defender", "Matchup defender", "critical"),
    team("def_rating", "Defensive rating", "important"),
    team("off_rating", "Offensive rating", "important"),
    team("reb_pct", "Rebounding %", "important"),
    team("ast_pct", "Assist %", "important"),
    team("injury_usage", "Injury usage bump", "critical"),
    team("b2b", "Back-to-back games", "important"),
    team("rest", "Rest", "important"),
    team("blowout", "Blowout risk", "important"),
    team("referee", "Referee tendencies", "useful"),
    team("home_away", "Home/away splits", "important"),
  ],
  propFactors: [
    prop("points", "Points"),
    prop("rebounds", "Rebounds"),
    prop("assists", "Assists"),
    prop("threes", "3-pointers"),
    prop("pra", "Pts+Reb+Ast combos"),
  ],
};

export const MLB_EVAL: SportEvalCatalog = {
  sport: "mlb",
  label: "MLB",
  teamFactors: [
    team("pitch_mix", "Pitch mix", "critical"),
    team("exit_velo", "Exit velocity", "important"),
    team("barrel", "Barrel %", "important"),
    team("hard_hit", "Hard-hit %", "important"),
    team("launch_angle", "Launch angle", "useful"),
    team("xba", "xBA / xSLG / xwOBA", "important"),
    team("vs_pitch_type", "Batter vs pitch type", "critical"),
    team("bullpen", "Bullpen strength", "important"),
    team("wind", "Wind", "important"),
    team("park", "Park factor", "important"),
    team("umpire", "Umpire tendencies", "useful"),
    team("lineup_protection", "Lineup protection", "important"),
    team("sb_opportunity", "Stolen base opportunities", "useful"),
    team("catcher_pop", "Catcher pop time", "useful"),
  ],
  propFactors: [
    prop("hits", "Hits"),
    prop("home_runs", "Home runs"),
    prop("total_bases", "Total bases"),
    prop("strikeouts", "Strikeouts"),
    prop("stolen_bases", "Stolen bases"),
  ],
};

export const NFL_EVAL: SportEvalCatalog = {
  sport: "nfl",
  label: "NFL",
  teamFactors: [
    team("target_share", "Target share", "critical"),
    team("air_yards", "Air yards", "important"),
    team("snap_pct", "Snap %", "critical"),
    team("route_part", "Route participation", "important"),
    team("rz_usage", "Red-zone usage", "critical"),
    team("pressure", "Pressure rate", "important"),
    team("coverage", "Coverage matchup", "critical"),
    team("weather", "Weather", "important"),
    team("pace", "Pace", "important"),
    team("injuries", "Injuries", "critical"),
    team("oline_dline", "OL vs DL matchup", "important"),
  ],
  propFactors: [
    prop("pass_yards", "Pass yards"),
    prop("rush_yards", "Rush yards"),
    prop("rec_yards", "Receiving yards"),
    prop("touchdowns", "Touchdowns"),
    prop("receptions", "Receptions"),
  ],
};

export const NHL_EVAL: SportEvalCatalog = {
  sport: "nhl",
  label: "NHL",
  teamFactors: [
    team("xg", "Expected goals (xG)", "critical"),
    team("corsi", "Corsi", "important"),
    team("fenwick", "Fenwick", "important"),
    team("pp_pct", "Power-play %", "important"),
    team("pk_pct", "Penalty kill %", "important"),
    team("goalie_sv", "Goalie save %", "critical"),
    team("high_danger", "High-danger chances", "important"),
    team("rest", "Rest", "important"),
    team("travel", "Travel", "useful"),
    team("b2b", "Back-to-back games", "important"),
  ],
  propFactors: [
    prop("goals", "Goals"),
    prop("assists", "Assists"),
    prop("shots", "Shots"),
    prop("saves", "Saves"),
    prop("points", "Points"),
  ],
};

export const SPORT_EVAL_CATALOGS: SportEvalCatalog[] = [
  SOCCER_EVAL,
  TENNIS_EVAL,
  BASKETBALL_EVAL,
  MLB_EVAL,
  NFL_EVAL,
  NHL_EVAL,
];

export function evalCatalogForSport(sport: string | null | undefined): SportEvalCatalog | null {
  const s = String(sport ?? "")
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (s === "soccer" || s === "fifa" || s.includes("world cup")) return SOCCER_EVAL;
  if (s === "tennis" || s === "atp" || s === "wta") return TENNIS_EVAL;
  if (s === "nba" || s === "wnba" || s === "ncaab" || s === "basketball") return BASKETBALL_EVAL;
  if (s === "mlb" || s === "baseball") return MLB_EVAL;
  if (s === "nfl" || s === "ncaaf" || s === "football") return NFL_EVAL;
  if (s === "nhl" || s === "hockey") return NHL_EVAL;
  return null;
}

/** Critical + important factor labels for a sport (Coach context / advisory headers). */
export function headlineEvalFactors(sport: string | null | undefined): string[] {
  const cat = evalCatalogForSport(sport);
  if (!cat) return [];
  return [...cat.teamFactors, ...cat.propFactors]
    .filter((f) => f.tier === "critical" || f.tier === "important")
    .map((f) => f.label);
}
