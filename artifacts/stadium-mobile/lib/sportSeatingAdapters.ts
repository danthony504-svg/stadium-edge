/**
 * Sport-specific seating adapters for single-event Coach tickets.
 *
 * A family is seatable ONLY when it is currently supported through the real
 * feed + normalization + grading/simulation path. Unsupported sportsbook
 * concepts stay explicitly non-seatable (never fabricated).
 */

export type MarketFamilyId = string;

export type SportSeatingAdapter = {
  sport: string;
  supportsParticipantProps: boolean;
  /** Soft hint for honest shortfall messaging — not a hard seat budget. */
  maxIndependentFamiliesHint: number;
  participantPropFamilies: ReadonlySet<MarketFamilyId>;
  teamGameEventFamilies: ReadonlySet<MarketFamilyId>;
  periodFamilies: ReadonlySet<MarketFamilyId>;
  altFamilies: ReadonlySet<MarketFamilyId>;
  /** Canonical market string → family id (O(1) after normalize). */
  familyByMarketKey: ReadonlyMap<string, MarketFamilyId>;
  /** Explicit non-seatable families (documented, never seated). */
  nonSeatableFamilies: ReadonlySet<MarketFamilyId>;
};

const normKey = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function buildFamilyMap(
  entries: Array<[string | string[], MarketFamilyId]>,
): ReadonlyMap<string, MarketFamilyId> {
  const m = new Map<string, MarketFamilyId>();
  for (const [keys, fam] of entries) {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      m.set(normKey(k), fam);
    }
  }
  return m;
}

function setOf(...ids: MarketFamilyId[]): ReadonlySet<MarketFamilyId> {
  return new Set(ids);
}

/** Resolve a pick market string to a seating family id, or null if unknown. */
export function resolveMarketFamilyId(
  adapter: SportSeatingAdapter,
  market: string,
  opts?: { isProp?: boolean; propIsAlt?: boolean },
): MarketFamilyId | null {
  const raw = String(market ?? "");
  const key = normKey(raw);
  const direct = adapter.familyByMarketKey.get(key);
  if (direct) return direct;

  // Strip common alt / period suffixes for prop keys.
  const stripped = key
    .replace(/_alternate$/, "")
    .replace(/_alt$/, "")
    .replace(/_q[1-4]$/, "")
    .replace(/_h[12]$/, "");
  const fromStrip = adapter.familyByMarketKey.get(stripped);
  if (fromStrip) {
    if (opts?.propIsAlt || /\balt\b/i.test(raw) || /_alternate/.test(key)) {
      const altId = `${fromStrip}_alt`;
      if (adapter.altFamilies.has(altId) || adapter.altFamilies.has(fromStrip)) return altId;
    }
    return fromStrip;
  }

  // Human labels → families (UI markets after normalization).
  const m = raw.toLowerCase();
  if (opts?.isProp) {
    if (/pass\s*yd|passing yards/.test(m)) return "pass_yds";
    if (/rush\s*yd|rushing yards/.test(m)) return "rush_yds";
    if (/rec(eption)?\s*yd|receiving yards/.test(m)) return "rec_yds";
    if (/\breceptions?\b/.test(m)) return "receptions";
    if (/anytime\s*td|anytime touchdown/.test(m)) return "anytime_td";
    if (/first\s*td|1st\s*td/.test(m)) return "first_td";
    if (/\bsacks?\b/.test(m)) return "sacks";
    if (/pass\s*td|passing touchdown/.test(m)) return "pass_tds";
    if (/\bpoints?\b/.test(m) && !/team/.test(m)) return "points";
    if (/\brebounds?\b/.test(m)) return "rebounds";
    if (/\bassists?\b/.test(m)) return "assists";
    if (/three|3pm|threes/.test(m)) return "threes";
    if (/\bsteals?\b/.test(m)) return "steals";
    if (/\bblocks?\b/.test(m)) return "blocks";
    if (/double[\s_-]*double/.test(m)) return "double_double";
    if (/triple[\s_-]*double/.test(m)) return "triple_double";
    if (/\bhits?\b/.test(m) && !/runs/.test(m)) return "hits";
    if (/total bases/.test(m)) return "total_bases";
    if (/home\s*runs?|\bhr\b/.test(m)) return "home_runs";
    if (/\brbis?\b/.test(m)) return "rbis";
    if (/\bruns?\b/.test(m) && !/hits/.test(m)) return "runs";
    if (/stolen bases?/.test(m)) return "stolen_bases";
    if (/strikeouts?|\bk\b/.test(m)) return "strikeouts";
    if (/\bouts?\b/.test(m)) return "outs";
    if (/shots on (goal|target)/.test(m)) return "shots_on_goal";
    if (/\bshots?\b/.test(m)) return "shots";
    if (/\bgoals?\b/.test(m) && !/anytime|first/.test(m)) return "goals";
    if (/anytime.*scorer|goal scorer anytime/.test(m)) return "anytime_goal";
    if (/first.*scorer|first goal/.test(m)) return "first_goal";
    return null;
  }

  if (/team total/.test(m)) return "team_total";
  if (/alt\s*spread|alternate\s*spread/.test(m)) return "alt_spread";
  if (/alt\s*total|alternate\s*total|alt total rounds/.test(m)) return "alt_total";
  if (/total rounds/.test(m)) return "total_rounds";
  if (/f5|first\s*5|1st\s*5/.test(m) && /run\s*line|spread/.test(m)) return "f5_spread";
  if (/f5|first\s*5|1st\s*5/.test(m) && /total/.test(m)) return "f5_total";
  if (/f5|first\s*5|1st\s*5/.test(m) && /money|ml/.test(m)) return "f5_ml";
  if (/\b(q1|q2|q3|q4|1h|2h|1st half|2nd half|1st quarter|p1|p2|p3)\b/.test(m)) {
    if (/spread|run line|puck line|handicap/.test(m)) return "period_spread";
    if (/total/.test(m)) return "period_total";
    if (/money|ml/.test(m)) return "period_ml";
  }
  if (/spread|run line|puck line|handicap/.test(m)) return "spread";
  if (/total/.test(m)) return "total";
  if (/money|h2h|\bml\b/.test(m)) return "ml";
  return null;
}

export function isFamilySeatable(
  adapter: SportSeatingAdapter,
  familyId: MarketFamilyId | null,
): boolean {
  if (!familyId) return false;
  if (adapter.nonSeatableFamilies.has(familyId)) return false;
  return (
    adapter.participantPropFamilies.has(familyId) ||
    adapter.teamGameEventFamilies.has(familyId) ||
    adapter.periodFamilies.has(familyId) ||
    adapter.altFamilies.has(familyId)
  );
}

export function isParticipantPropFamily(
  adapter: SportSeatingAdapter,
  familyId: MarketFamilyId | null,
): boolean {
  if (!familyId) return false;
  return (
    adapter.participantPropFamilies.has(familyId) ||
    (adapter.altFamilies.has(familyId) && familyId.endsWith("_alt") &&
      adapter.participantPropFamilies.has(familyId.replace(/_alt$/, "")))
  );
}

export function isGameEventFamily(
  adapter: SportSeatingAdapter,
  familyId: MarketFamilyId | null,
): boolean {
  if (!familyId) return false;
  if (isParticipantPropFamily(adapter, familyId)) return false;
  return (
    adapter.teamGameEventFamilies.has(familyId) ||
    adapter.periodFamilies.has(familyId) ||
    adapter.altFamilies.has(familyId)
  );
}

const NFL_PROP = setOf(
  "pass_yds",
  "pass_attempts",
  "pass_completions",
  "pass_tds",
  "pass_interceptions",
  "pass_longest",
  "rush_yds",
  "rush_attempts",
  "rush_longest",
  "rec_yds",
  "receptions",
  "rec_longest",
  "anytime_td",
  "first_td",
  "sacks",
  "field_goals",
  "pass_rush_yds",
  "rush_reception_yds",
  "kicking_points",
  "tackles_assists",
  "solo_tackles",
  "defensive_interceptions",
);

const NFL_PERIOD_PROP = setOf(
  "pass_yds_q1",
  "pass_tds_q1",
  "rush_yds_q1",
  "rec_yds_q1",
  "pass_yds_h1",
  "rush_yds_h1",
  "rec_yds_h1",
);

const NCAAF_PROP = setOf(
  "pass_yds",
  "pass_attempts",
  "pass_completions",
  "pass_tds",
  "pass_interceptions",
  "pass_longest",
  "rush_yds",
  "rush_attempts",
  "rush_longest",
  "rec_yds",
  "receptions",
  "rec_longest",
  "anytime_td",
  "first_td",
  "field_goals",
  "pass_rush_yds",
  "rush_reception_yds",
);

const NCAAF_PERIOD_PROP = setOf(
  "pass_yds_q1",
  "rush_yds_q1",
  "rec_yds_q1",
  "pass_yds_h1",
  "rush_yds_h1",
  "rec_yds_h1",
);

const BASKETBALL_PROP = setOf(
  "points",
  "rebounds",
  "assists",
  "threes",
  "pra",
  "pr",
  "pa",
  "ra",
  "blocks",
  "steals",
  "blocks_steals",
  "turnovers",
  "double_double",
  "triple_double",
);

const MLB_PROP = setOf(
  "hits",
  "total_bases",
  "home_runs",
  "strikeouts",
  "stolen_bases",
  "hits_runs_rbis",
  "rbis",
  "runs",
  "outs",
);

const NHL_PROP = setOf("points", "goals", "assists", "shots_on_goal");

const SOCCER_PROP = setOf("anytime_goal", "first_goal", "shots_on_target", "shots");

const GAME_CORE = setOf("ml", "spread", "total", "team_total");
const PERIOD_GAME = setOf("period_ml", "period_spread", "period_total");
const ALT_GAME = setOf("alt_spread", "alt_total");
const MLB_INNINGS = setOf("f5_ml", "f5_spread", "f5_total", "1i_total");

function footballFamilyMap(includeSacks: boolean): ReadonlyMap<string, MarketFamilyId> {
  const rows: Array<[string | string[], MarketFamilyId]> = [
    [["player_pass_yds", "pass yds", "passing yards"], "pass_yds"],
    [["player_pass_attempts"], "pass_attempts"],
    [["player_pass_completions"], "pass_completions"],
    [["player_pass_tds", "pass tds", "passing touchdowns"], "pass_tds"],
    [["player_pass_interceptions"], "pass_interceptions"],
    [["player_pass_longest_completion"], "pass_longest"],
    [["player_rush_yds", "rush yds", "rushing yards"], "rush_yds"],
    [["player_rush_attempts"], "rush_attempts"],
    [["player_rush_longest"], "rush_longest"],
    [["player_reception_yds", "rec yds", "receiving yards"], "rec_yds"],
    [["player_receptions", "receptions"], "receptions"],
    [["player_reception_longest"], "rec_longest"],
    [["player_anytime_td", "anytime td"], "anytime_td"],
    [["player_1st_td", "player_first_td", "first td"], "first_td"],
    [["player_field_goals"], "field_goals"],
    [["player_pass_rush_yds"], "pass_rush_yds"],
    [["player_rush_reception_yds"], "rush_reception_yds"],
    [["player_pass_yds_q1"], "pass_yds_q1"],
    [["player_pass_tds_q1"], "pass_tds_q1"],
    [["player_rush_yds_q1"], "rush_yds_q1"],
    [["player_reception_yds_q1"], "rec_yds_q1"],
    [["player_pass_yds_h1"], "pass_yds_h1"],
    [["player_rush_yds_h1"], "rush_yds_h1"],
    [["player_reception_yds_h1"], "rec_yds_h1"],
    [["moneyline", "ml", "h2h"], "ml"],
    [["spread", "spreads"], "spread"],
    [["total", "totals"], "total"],
    [["team total", "team_totals"], "team_total"],
    [["alt spread", "alternate_spreads"], "alt_spread"],
    [["alt total", "alternate_totals"], "alt_total"],
  ];
  if (includeSacks) {
    rows.push([["player_sacks", "sacks"], "sacks"]);
    rows.push([["player_kicking_points"], "kicking_points"]);
    rows.push([["player_tackles_assists"], "tackles_assists"]);
    rows.push([["player_solo_tackles"], "solo_tackles"]);
    rows.push([["player_defensive_interceptions"], "defensive_interceptions"]);
  }
  return buildFamilyMap(rows);
}

function basketballFamilyMap(): ReadonlyMap<string, MarketFamilyId> {
  return buildFamilyMap([
    [["player_points", "points"], "points"],
    [["player_rebounds", "rebounds"], "rebounds"],
    [["player_assists", "assists"], "assists"],
    [["player_threes", "threes", "3pm"], "threes"],
    [["player_points_rebounds_assists", "pra"], "pra"],
    [["player_points_rebounds", "pr"], "pr"],
    [["player_points_assists", "pa"], "pa"],
    [["player_rebounds_assists", "ra"], "ra"],
    [["player_blocks", "blocks"], "blocks"],
    [["player_steals", "steals"], "steals"],
    [["player_blocks_steals"], "blocks_steals"],
    [["player_turnovers", "turnovers"], "turnovers"],
    [["player_double_double", "double double"], "double_double"],
    [["player_triple_double", "triple double"], "triple_double"],
    [["player_points_q1"], "points"],
    [["player_rebounds_q1"], "rebounds"],
    [["player_assists_q1"], "assists"],
    [["moneyline", "ml", "h2h"], "ml"],
    [["spread", "spreads"], "spread"],
    [["total", "totals"], "total"],
    [["team total", "team_totals"], "team_total"],
    [["alt spread", "alternate_spreads"], "alt_spread"],
    [["alt total", "alternate_totals"], "alt_total"],
  ]);
}

const ADAPTERS: Record<string, SportSeatingAdapter> = {
  nfl: {
    sport: "nfl",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 14,
    participantPropFamilies: new Set([...NFL_PROP, ...NFL_PERIOD_PROP]),
    teamGameEventFamilies: GAME_CORE,
    periodFamilies: PERIOD_GAME,
    altFamilies: new Set([
      ...ALT_GAME,
      "pass_yds_alt",
      "rush_yds_alt",
      "rec_yds_alt",
      "receptions_alt",
      "pass_tds_alt",
    ]),
    familyByMarketKey: footballFamilyMap(true),
    nonSeatableFamilies: setOf(),
  },
  ncaaf: {
    sport: "ncaaf",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 12,
    participantPropFamilies: new Set([...NCAAF_PROP, ...NCAAF_PERIOD_PROP]),
    teamGameEventFamilies: GAME_CORE,
    periodFamilies: PERIOD_GAME,
    altFamilies: new Set([...ALT_GAME, "pass_yds_alt", "rush_yds_alt", "rec_yds_alt"]),
    familyByMarketKey: footballFamilyMap(false),
    nonSeatableFamilies: setOf("sacks"),
  },
  nba: {
    sport: "nba",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 14,
    participantPropFamilies: BASKETBALL_PROP,
    teamGameEventFamilies: GAME_CORE,
    periodFamilies: PERIOD_GAME,
    altFamilies: new Set([...ALT_GAME, "points_alt", "rebounds_alt", "assists_alt", "threes_alt"]),
    familyByMarketKey: basketballFamilyMap(),
    nonSeatableFamilies: setOf(),
  },
  wnba: {
    sport: "wnba",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 12,
    participantPropFamilies: BASKETBALL_PROP,
    teamGameEventFamilies: GAME_CORE,
    periodFamilies: PERIOD_GAME,
    altFamilies: new Set([...ALT_GAME, "points_alt", "rebounds_alt", "assists_alt", "threes_alt"]),
    familyByMarketKey: basketballFamilyMap(),
    nonSeatableFamilies: setOf(),
  },
  mlb: {
    sport: "mlb",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 12,
    participantPropFamilies: MLB_PROP,
    teamGameEventFamilies: new Set([...GAME_CORE, ...MLB_INNINGS]),
    periodFamilies: setOf("f5_ml", "f5_spread", "f5_total", "1i_total"),
    altFamilies: new Set([
      ...ALT_GAME,
      "hits_alt",
      "total_bases_alt",
      "home_runs_alt",
      "strikeouts_alt",
      "hits_runs_rbis_alt",
      "rbis_alt",
      "runs_alt",
      "outs_alt",
    ]),
    familyByMarketKey: buildFamilyMap([
      [["batter_hits", "hits"], "hits"],
      [["batter_total_bases", "total bases"], "total_bases"],
      [["batter_home_runs", "home runs", "hr"], "home_runs"],
      [["pitcher_strikeouts", "strikeouts"], "strikeouts"],
      [["batter_stolen_bases", "stolen bases"], "stolen_bases"],
      [["batter_hits_runs_rbis"], "hits_runs_rbis"],
      [["batter_rbis", "rbis"], "rbis"],
      [["batter_runs_scored", "batter_runs", "runs"], "runs"],
      [["pitcher_outs", "outs"], "outs"],
      [["moneyline", "ml", "h2h"], "ml"],
      [["spread", "run line", "spreads"], "spread"],
      [["total", "totals"], "total"],
      [["team total", "team_totals"], "team_total"],
      [["f5 moneyline", "h2h_1st_5_innings"], "f5_ml"],
      [["f5 run line", "spreads_1st_5_innings"], "f5_spread"],
      [["f5 total", "totals_1st_5_innings"], "f5_total"],
      [["1st inning total", "totals_1st_1_innings"], "1i_total"],
      [["alt spread", "alternate_spreads"], "alt_spread"],
      [["alt total", "alternate_totals"], "alt_total"],
    ]),
    // Walks are not in the current props allowlist — non-seatable until feed+grade exist.
    nonSeatableFamilies: setOf("walks", "batter_walks"),
  },
  nhl: {
    sport: "nhl",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 10,
    participantPropFamilies: NHL_PROP,
    teamGameEventFamilies: GAME_CORE,
    periodFamilies: PERIOD_GAME,
    altFamilies: new Set([...ALT_GAME, "points_alt", "assists_alt", "shots_on_goal_alt"]),
    familyByMarketKey: buildFamilyMap([
      [["player_points", "points"], "points"],
      [["player_goals", "goals"], "goals"],
      [["player_assists", "assists"], "assists"],
      [["player_shots_on_goal", "shots on goal"], "shots_on_goal"],
      [["moneyline", "ml", "h2h"], "ml"],
      [["spread", "puck line", "spreads"], "spread"],
      [["total", "totals"], "total"],
      [["team total", "team_totals"], "team_total"],
      [["alt spread", "alternate_spreads"], "alt_spread"],
      [["alt total", "alternate_totals"], "alt_total"],
    ]),
    // Saves not in current allowlist.
    nonSeatableFamilies: setOf("saves", "player_saves"),
  },
  soccer: {
    sport: "soccer",
    supportsParticipantProps: true,
    maxIndependentFamiliesHint: 8,
    participantPropFamilies: SOCCER_PROP,
    teamGameEventFamilies: setOf("ml", "spread", "total", "team_total", "btts"),
    periodFamilies: setOf("period_ml", "period_spread", "period_total"),
    altFamilies: ALT_GAME,
    familyByMarketKey: buildFamilyMap([
      [["player_goal_scorer_anytime", "anytime goal"], "anytime_goal"],
      [["player_first_goal_scorer", "first goal"], "first_goal"],
      [["player_shots_on_target", "shots on target"], "shots_on_target"],
      [["player_shots", "shots"], "shots"],
      [["moneyline", "ml", "h2h"], "ml"],
      [["spread", "handicap", "spreads"], "spread"],
      [["total", "totals"], "total"],
      [["team total", "team_totals"], "team_total"],
      [["btts", "both teams to score"], "btts"],
      [["alt spread", "alternate_spreads"], "alt_spread"],
      [["alt total", "alternate_totals"], "alt_total"],
    ]),
    nonSeatableFamilies: setOf("cards", "yellow_cards", "red_cards", "assists"),
  },
  tennis: {
    sport: "tennis",
    supportsParticipantProps: false,
    maxIndependentFamiliesHint: 3,
    participantPropFamilies: setOf(),
    teamGameEventFamilies: setOf("ml", "spread", "total"),
    periodFamilies: setOf(),
    altFamilies: ALT_GAME,
    familyByMarketKey: buildFamilyMap([
      [["moneyline", "ml", "h2h"], "ml"],
      [["spread", "game handicap", "spreads"], "spread"],
      [["total", "totals"], "total"],
      [["alt spread", "alternate_spreads"], "alt_spread"],
      [["alt total", "alternate_totals"], "alt_total"],
    ]),
    // Aces / DF / set winner not on Odds API path Coach uses today.
    nonSeatableFamilies: setOf(
      "aces",
      "double_faults",
      "set_winner",
      "games_props",
      "sets_props",
    ),
  },
  ufc: {
    sport: "ufc",
    supportsParticipantProps: false,
    maxIndependentFamiliesHint: 2,
    participantPropFamilies: setOf(),
    teamGameEventFamilies: setOf("ml", "total_rounds"),
    periodFamilies: setOf(),
    altFamilies: setOf("alt_total"),
    familyByMarketKey: buildFamilyMap([
      [["moneyline", "ml", "h2h"], "ml"],
      [["total", "totals", "total rounds"], "total_rounds"],
      [["alt total", "alt total rounds", "alternate_totals"], "alt_total"],
    ]),
    nonSeatableFamilies: setOf(
      "method",
      "round_winner",
      "go_the_distance",
      "significant_strikes",
      "takedowns",
    ),
  },
};

// MMA alias shares UFC adapter.
ADAPTERS.mma = { ...ADAPTERS.ufc!, sport: "mma" };

/** NCAAB uses basketball families with a thinner prop set (feed-backed). */
ADAPTERS.ncaab = {
  sport: "ncaab",
  supportsParticipantProps: true,
  maxIndependentFamiliesHint: 8,
  participantPropFamilies: setOf("points", "rebounds", "assists", "double_double", "triple_double"),
  teamGameEventFamilies: GAME_CORE,
  periodFamilies: PERIOD_GAME,
  altFamilies: new Set([...ALT_GAME, "points_alt", "rebounds_alt", "assists_alt"]),
  familyByMarketKey: basketballFamilyMap(),
  nonSeatableFamilies: setOf("threes", "steals", "blocks"),
};

export function getSportSeatingAdapter(sport: string | null | undefined): SportSeatingAdapter {
  const key = String(sport ?? "")
    .toLowerCase()
    .trim();
  if (key === "cfb") return ADAPTERS.ncaaf!;
  if (key === "cbb") return ADAPTERS.ncaab!;
  return ADAPTERS[key] ?? ADAPTERS.nfl!;
}

export function listSportSeatingAdapterSports(): string[] {
  return Object.keys(ADAPTERS);
}
