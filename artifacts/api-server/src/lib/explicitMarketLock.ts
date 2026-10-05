/**
 * Shared explicit-market lock — alias → canonical Odds API provider keys.
 *
 * Source of truth for which keys exist: api-server `MARKETS_BY_SPORT` /
 * `MARKETS_EXTENDED_BY_SPORT` / `MARKETS_DST_BY_SPORT` / `ALT_MARKETS_*`.
 * This module MUST NOT invent provider keys.
 *
 * Used by board-scan Coach (`parseCoachAskMarketConstraint`) and server chat
 * market-lock. Keep in sync with stadium-mobile/lib/explicitMarketLock.ts.
 */

export type ExplicitMarketLockRule = {
  /** Stable id for tests / diagnostics. */
  id: string;
  /** Human label for shortfall / reminder copy. */
  label: string;
  /** Ordered regex — first match wins after span blanking. */
  re: RegExp;
  /** Canonical provider keys (mains; `_alternate` allowed via canonicalPropMarketKey). */
  markets: readonly string[];
};

/**
 * Precedence matters: more specific phrases before bare tokens
 * (SOT before shots, SB before steals, combos before singles, etc.).
 */
export const EXPLICIT_MARKET_LOCK_RULES: readonly ExplicitMarketLockRule[] = [
  // —— MLB ——
  {
    id: "mlb_strikeouts",
    label: "pitcher strikeouts",
    re: /\b(strikeouts?|k'?s)\b/i,
    markets: ["pitcher_strikeouts"],
  },
  {
    id: "mlb_home_runs",
    label: "home runs",
    re: /\b(home\s*runs?|homers?|hrs?)\b/i,
    markets: ["batter_home_runs"],
  },
  {
    id: "mlb_hits_runs_rbis",
    label: "hits+runs+RBIs",
    re: /\bhits?\s*[\+&,]?\s*runs?\s*[\+&,]?\s*(?:and\s+)?rbis?\b|\bh\s*\+\s*r\s*\+\s*rbis?\b/i,
    markets: ["batter_hits_runs_rbis"],
  },
  {
    id: "mlb_stolen_bases",
    label: "stolen bases",
    // SB / stolen bases BEFORE NBA steals.
    re: /\b(stolen\s+bases?|steals?\s+a\s+base|\bsbs?\b)\b/i,
    markets: ["batter_stolen_bases"],
  },
  {
    id: "mlb_total_bases",
    label: "total bases",
    re: /\btotal\s+bases?\b/i,
    markets: ["batter_total_bases"],
  },
  {
    id: "mlb_rbis",
    label: "RBIs",
    re: /\brbis?\b/i,
    markets: ["batter_rbis"],
  },
  {
    id: "mlb_hits",
    label: "hits",
    re: /\bhits?\b/i,
    markets: ["batter_hits"],
  },
  {
    id: "mlb_runs",
    label: "runs",
    re: /\b(?:batter\s+)?runs?(?:\s+scored)?\b/i,
    markets: ["batter_runs"],
  },

  // —— Football yards / volume (exact families) ——
  // Contiguous "X yards" phrases. Compound "rushing and passing yards" is
  // merged in parseCoachAskMarketConstraint via yards helpers.
  {
    id: "fb_pass_yds",
    label: "passing yards",
    re: /\b(pass(?:ing)?\s+yards?|pass\s+yds?)\b/i,
    markets: ["player_pass_yds"],
  },
  {
    id: "fb_rush_yds",
    label: "rushing yards",
    re: /\b(rush(?:ing)?\s+yards?|rush\s+yds?)\b/i,
    markets: ["player_rush_yds"],
  },
  {
    id: "fb_rec_yds",
    label: "receiving yards",
    re: /\b(receiv(?:ing|e)?\s+yards?|reception\s+yards?|rec\s+yds?)\b/i,
    markets: ["player_reception_yds"],
  },
  {
    id: "fb_pass_attempts",
    label: "passing attempts",
    re: /\b(pass(?:ing)?\s+attempts?)\b/i,
    markets: ["player_pass_attempts"],
  },
  {
    id: "fb_rush_attempts",
    label: "rushing attempts",
    re: /\b(rush(?:ing)?\s+attempts?)\b/i,
    markets: ["player_rush_attempts"],
  },
  // Longest-* BEFORE bare completions/receptions — otherwise
  // \bcompletions?\b eats "completion" inside "longest completion".
  {
    id: "fb_longest_completion",
    label: "longest completion",
    re: /\b(longest\s+completions?|pass(?:ing)?\s+longest)\b/i,
    markets: ["player_pass_longest_completion"],
  },
  {
    id: "fb_longest_reception",
    label: "longest reception",
    re: /\b(longest\s+receptions?|rec(?:eiving)?\s+longest)\b/i,
    markets: ["player_reception_longest"],
  },
  {
    id: "fb_longest_rush",
    label: "longest rush",
    re: /\b(longest\s+rush(?:es)?|rush(?:ing)?\s+longest)\b/i,
    markets: ["player_rush_longest"],
  },
  {
    id: "fb_completions",
    label: "completions",
    re: /\b(pass(?:ing)?\s+completions?|completed\s+passes?|completions?)\b/i,
    markets: ["player_pass_completions"],
  },
  {
    id: "fb_receptions",
    label: "receptions",
    re: /\b(receptions?|catches?)\b/i,
    markets: ["player_receptions"],
  },
  {
    id: "fb_sacks",
    label: "sacks",
    re: /\bsacks?\b/i,
    markets: ["player_sacks"],
  },
  {
    id: "fb_pass_ints",
    label: "pass interceptions",
    re: /\b(pass(?:ing)?\s+interceptions?|interceptions?|ints?)\b/i,
    markets: ["player_pass_interceptions"],
  },
  {
    id: "fb_first_td",
    label: "first TD",
    re: /\b(?:first|1st)\s+(?:td|touchdown)\b/i,
    markets: ["player_first_td"],
  },
  {
    id: "fb_touchdowns",
    label: "touchdowns",
    re: /\b(?:anytime\s+(?:td|touchdown)|atd|touchdowns?|tds?)\b/i,
    markets: [
      "player_anytime_td",
      "player_first_td",
      "player_rush_tds",
      "player_reception_tds",
      "player_pass_tds",
    ],
  },
  // Field goals BEFORE bare "goals" so "field goals" never locks NHL/soccer goals.
  {
    id: "fb_field_goals",
    label: "field goals",
    re: /\b(field\s*goals?|\bfgs?\b)\b/i,
    markets: ["player_field_goals"],
  },

  // —— Soccer / NHL goals & shots (specific before bare) ——
  {
    id: "soccer_nhl_goal_scorer",
    label: "goal scorer",
    re: /\b(goal\s+scorer|first\s+goal|anytime\s+goal)\b/i,
    markets: ["player_goal_scorer_anytime", "player_first_goal_scorer", "player_goals"],
  },
  {
    id: "soccer_shots_on_target",
    label: "shots on target",
    re: /\b(shots?\s+on\s+target|\bsot\b)\b/i,
    markets: ["player_shots_on_target"],
  },
  {
    id: "nhl_shots_on_goal",
    label: "shots on goal",
    re: /\b(shots?\s+on\s+goal|\bsog\b)\b/i,
    markets: ["player_shots_on_goal"],
  },
  {
    id: "soccer_shots",
    label: "shots",
    re: /\bshots?\b/i,
    markets: ["player_shots"],
  },
  {
    id: "nhl_soccer_goals",
    label: "goals",
    // NHL player_goals + soccer anytime/first goal scorers (provider keys only).
    re: /\bgoals?\b/i,
    markets: [
      "player_goals",
      "player_goal_scorer_anytime",
      "player_first_goal_scorer",
    ],
  },

  // —— Basketball combos before singles ——
  {
    id: "nba_pra",
    label: "pts+reb+ast",
    re: /\b(pra\b|p\s*\+\s*r\s*\+\s*a|points?\s*\+\s*rebounds?\s*\+\s*assists?|pts?\s*\+\s*reb\s*\+\s*ast)\b/i,
    markets: ["player_points_rebounds_assists"],
  },
  {
    id: "nba_pts_reb",
    label: "pts+reb",
    re: /\b(points?\s*\+\s*rebounds?|pts?\s*\+\s*reb|p\s*\+\s*r)\b/i,
    markets: ["player_points_rebounds"],
  },
  {
    id: "nba_pts_ast",
    label: "pts+ast",
    re: /\b(points?\s*\+\s*assists?|pts?\s*\+\s*ast|p\s*\+\s*a)\b/i,
    markets: ["player_points_assists"],
  },
  {
    id: "nba_reb_ast",
    label: "reb+ast",
    re: /\b(rebounds?\s*\+\s*assists?|reb\s*\+\s*ast|r\s*\+\s*a)\b/i,
    markets: ["player_rebounds_assists"],
  },
  {
    id: "nba_combo_tab",
    label: "combo props",
    re: /(?<!\bparlay[\s-])\bcombos?\b(?!\s+(?:parlay|bet|ticket))/i,
    markets: [
      "player_points_rebounds_assists",
      "player_points_rebounds",
      "player_points_assists",
      "player_rebounds_assists",
    ],
  },
  {
    id: "nba_blocks_steals",
    label: "blocks+steals",
    re: /\b(blocks?\s*\+?\s*steals?|steals?\s*\+?\s*blocks?)\b/i,
    markets: ["player_blocks_steals"],
  },
  {
    id: "nba_rebounds",
    label: "rebounds",
    re: /\b(rebounds?|\breb\b)\b/i,
    markets: ["player_rebounds"],
  },
  {
    id: "nba_assists",
    label: "assists",
    re: /\b(assists?|\bast\b)\b/i,
    markets: ["player_assists"],
  },
  {
    id: "nba_threes",
    label: "threes",
    re: /\b(threes?|3pm|3-?pointers?|three\s+pointers?|\b3s\b)\b/i,
    markets: ["player_threes"],
  },
  {
    id: "nba_blocks",
    label: "blocks",
    re: /\b(blocks?|\bblk\b)\b/i,
    markets: ["player_blocks"],
  },
  {
    id: "nba_steals",
    label: "steals",
    re: /\b(steals?|\bstl\b)\b/i,
    markets: ["player_steals"],
  },
  {
    id: "nba_turnovers",
    label: "turnovers",
    re: /\bturnovers?\b/i,
    markets: ["player_turnovers"],
  },
  {
    id: "nba_points",
    label: "points",
    // Require nearby betting context so prose "key points" does not lock.
    re: /\b(points|pts)\b(?=[^\n]{0,40}\b(props?|prop bet|parlay|legs?|over|under|line|ticket|picks?|\d+(?:\.\d+)?)\b)|\b(props?|prop bet|parlay|legs?|over|under|line|ticket|picks?|\d+(?:\.\d+)?)\b[^\n]{0,40}\b(points|pts)\b/i,
    markets: ["player_points"],
  },
];

/** Canonicalize provider keys the same way allowlist checks do. */
export function canonicalExplicitMarketKey(
  marketKey: string | null | undefined,
): string {
  let k = String(marketKey ?? "")
    .trim()
    .toLowerCase();
  if (!k) return "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2|1h|2h|f5)$/i, "");
  if (k === "batter_runs_scored") return "batter_runs";
  if (k === "player_1st_td") return "player_first_td";
  return k;
}

export type ExplicitMarketLockMatch = {
  ids: string[];
  labels: string[];
  /** Deduped canonical provider keys for allowedMarketKeys. */
  allowedMarketKeys: string[];
};

/**
 * Detect every distinct explicit market named in the ask.
 * Blank matched spans so "shots on target" does not also match bare "shots",
 * while a separate "shots" mention elsewhere can still match.
 */
export function matchExplicitMarketLocks(
  text: string | null | undefined,
): ExplicitMarketLockMatch | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const matched: ExplicitMarketLockRule[] = [];
  let scan = raw;
  for (const rule of EXPLICIT_MARKET_LOCK_RULES) {
    const m = rule.re.exec(scan);
    if (!m) continue;
    const overlapsKept = matched.some((kept) =>
      kept.markets.some((mk) => rule.markets.includes(mk)),
    );
    if (!overlapsKept) matched.push(rule);
    // Blank the matched span so lower-precedence overlaps cannot re-hit it.
    const start = m.index ?? 0;
    const end = start + m[0]!.length;
    scan = scan.slice(0, start) + " ".repeat(m[0]!.length) + scan.slice(end);
  }
  if (!matched.length) return null;

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rule of matched) {
    for (const mk of rule.markets) {
      const canon = canonicalExplicitMarketKey(mk);
      if (!canon || seen.has(canon)) continue;
      seen.add(canon);
      keys.push(canon);
    }
  }
  if (!keys.length) return null;
  return {
    ids: matched.map((r) => r.id),
    labels: matched.map((r) => r.label),
    allowedMarketKeys: keys,
  };
}

/** True when the ask produced a non-null explicit market allowlist. */
export function askHasExplicitMarketLock(text: string | null | undefined): boolean {
  return matchExplicitMarketLocks(text) != null;
}
