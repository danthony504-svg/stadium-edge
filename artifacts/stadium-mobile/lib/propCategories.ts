export type PropCategory = {
  id: string;
  label: string;
  /** Feather icon name (kept as string so this module stays UI-runtime-light). */
  icon: string;
  markets: string[];
};

/**
 * Sport → popular prop category catalog.
 *
 * Never fall back to MLB for an unknown / browse-only sport — return [].
 * Categories are further filtered against markets actually present on the board
 * via {@link availablePropCategories}.
 */
const MLB_PROP_CATEGORIES: PropCategory[] = [
  { id: "hits", label: "Hits", icon: "edit-3", markets: ["batter_hits"] },
  { id: "total_bases", label: "Total Bases", icon: "shield", markets: ["batter_total_bases"] },
  { id: "hr", label: "Home Runs", icon: "circle", markets: ["batter_home_runs"] },
  { id: "runs", label: "Runs", icon: "activity", markets: ["batter_runs_scored", "batter_runs"] },
  { id: "rbis", label: "RBIs", icon: "target", markets: ["batter_rbis"] },
  { id: "hrbi", label: "Hits+Runs+RBIs", icon: "layers", markets: ["batter_hits_runs_rbis"] },
  { id: "sb", label: "Stolen Bases", icon: "hexagon", markets: ["batter_stolen_bases"] },
  { id: "k", label: "Strikeouts (Pitchers)", icon: "disc", markets: ["pitcher_strikeouts"] },
  { id: "outs", label: "Pitcher Outs", icon: "pie-chart", markets: ["pitcher_outs"] },
];

const BASKETBALL_PROP_CATEGORIES: PropCategory[] = [
  { id: "points", label: "Points", icon: "target", markets: ["player_points"] },
  { id: "rebounds", label: "Rebounds", icon: "download", markets: ["player_rebounds"] },
  { id: "assists", label: "Assists", icon: "share-2", markets: ["player_assists"] },
  { id: "threes", label: "Threes", icon: "circle", markets: ["player_threes"] },
  {
    id: "pra",
    label: "Pts+Reb+Ast",
    icon: "layers",
    markets: ["player_points_rebounds_assists"],
  },
  { id: "dd", label: "Double-Double", icon: "award", markets: ["player_double_double"] },
];

const NCAAB_PROP_CATEGORIES: PropCategory[] = [
  { id: "points", label: "Points", icon: "target", markets: ["player_points"] },
  { id: "rebounds", label: "Rebounds", icon: "download", markets: ["player_rebounds"] },
  { id: "assists", label: "Assists", icon: "share-2", markets: ["player_assists"] },
  { id: "dd", label: "Double-Double", icon: "award", markets: ["player_double_double"] },
];

const NHL_PROP_CATEGORIES: PropCategory[] = [
  { id: "goals", label: "Goals", icon: "target", markets: ["player_goals"] },
  { id: "shots", label: "Shots on Goal", icon: "crosshair", markets: ["player_shots_on_goal"] },
  { id: "points", label: "Points", icon: "activity", markets: ["player_points"] },
  { id: "assists", label: "Assists", icon: "share-2", markets: ["player_assists"] },
];

const FOOTBALL_PROP_CATEGORIES: PropCategory[] = [
  { id: "pass_yds", label: "Pass Yards", icon: "send", markets: ["player_pass_yds"] },
  { id: "rush_yds", label: "Rush Yards", icon: "trending-up", markets: ["player_rush_yds"] },
  { id: "rec_yds", label: "Receiving Yards", icon: "inbox", markets: ["player_reception_yds"] },
  { id: "receptions", label: "Receptions", icon: "hash", markets: ["player_receptions"] },
  { id: "pass_tds", label: "Pass TDs", icon: "award", markets: ["player_pass_tds"] },
  { id: "anytime_td", label: "Anytime TD", icon: "zap", markets: ["player_anytime_td"] },
  { id: "pass_attempts", label: "Pass Attempts", icon: "repeat", markets: ["player_pass_attempts"] },
  {
    id: "completions",
    label: "Completions",
    icon: "check-circle",
    markets: ["player_pass_completions"],
  },
  {
    id: "interceptions",
    label: "INTs",
    icon: "slash",
    markets: ["player_pass_interceptions"],
  },
  { id: "rush_attempts", label: "Rush Attempts", icon: "activity", markets: ["player_rush_attempts"] },
];

const SOCCER_PROP_CATEGORIES: PropCategory[] = [
  {
    id: "anytime_goal",
    label: "Anytime Goal",
    icon: "target",
    markets: ["player_goal_scorer_anytime"],
  },
  {
    id: "first_goal",
    label: "First Goal",
    icon: "award",
    markets: ["player_first_goal_scorer"],
  },
  { id: "shots", label: "Shots", icon: "crosshair", markets: ["player_shots"] },
  {
    id: "sot",
    label: "Shots on Target",
    icon: "disc",
    markets: ["player_shots_on_target"],
  },
];

/** Catalog for a sport. Empty for browse-only / unknown — never MLB-by-default. */
export function propCategoriesForSport(sport: string): PropCategory[] {
  const s = (sport || "").toLowerCase();
  if (s === "mlb") return MLB_PROP_CATEGORIES;
  if (s === "nba" || s === "wnba") return BASKETBALL_PROP_CATEGORIES;
  if (s === "ncaab") return NCAAB_PROP_CATEGORIES;
  if (s === "nhl") return NHL_PROP_CATEGORIES;
  if (s === "nfl" || s === "ncaaf") return FOOTBALL_PROP_CATEGORIES;
  if (s === "soccer") return SOCCER_PROP_CATEGORIES;
  return [];
}

/** Unique market keys present on a props board (mains). */
export function collectBoardMarkets(
  games: ReadonlyArray<{ props: ReadonlyArray<{ market: string }> }>,
): Set<string> {
  const out = new Set<string>();
  for (const g of games) {
    for (const p of g.props) {
      if (p?.market) out.add(p.market);
    }
  }
  return out;
}

/**
 * Categories for `sport` that have at least one market actually posted on the
 * board. Unknown sports yield [] (no MLB fallback).
 */
export function availablePropCategories(
  sport: string,
  availableMarkets: Iterable<string>,
): PropCategory[] {
  const have = availableMarkets instanceof Set ? availableMarkets : new Set(availableMarkets);
  if (have.size === 0) return [];
  return propCategoriesForSport(sport).filter((cat) =>
    cat.markets.some((m) => have.has(m)),
  );
}

/**
 * True when a props page payload is safe to paint for the active sport.
 * Rejects cross-sport bleed. A stamped prior generation is only rejected when
 * the payload is not confirmed for the active league (late / unordered resolve).
 */
export function isCurrentPropsBoardReady(opts: {
  sport: string;
  gen: number;
  dataGen: number | null | undefined;
  dataSport: string | null | undefined;
  games: ReadonlyArray<{ sport?: string }> | null | undefined;
  isBrowseSport: boolean;
}): boolean {
  if (opts.isBrowseSport) return false;
  const games = opts.games;
  if (!games) return false;
  if (opts.dataSport != null && opts.dataSport !== opts.sport) return false;
  for (const g of games) {
    if (g.sport != null && g.sport !== opts.sport) return false;
  }
  // Untagged-or-wrong-gen payloads with no league stamp cannot be trusted after
  // a sport switch — drop them so a late response cannot restore the prior board.
  if (
    opts.dataGen != null &&
    opts.dataGen !== opts.gen &&
    opts.dataSport !== opts.sport
  ) {
    return false;
  }
  return true;
}
