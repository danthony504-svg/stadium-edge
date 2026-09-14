/**
 * Parse market constraints from Coach asks so "rushing and passing yards"
 * cannot stage rush attempts, receptions-count, INTs, or game totals.
 *
 * Sport scoping stays elsewhere. This module is market-only and does not
 * change hold / delivery / UI — only which markets may enter the scan pool
 * and survive final ticket selection.
 */

export type CoachAskMarketConstraint = {
  /** Stage props only — no ML / spread / total game lines. */
  propsOnly: boolean;
  /**
   * Allowed Odds API market keys (canonical, without `_alternate` / period suffix).
   * Empty array = no market allowlist (all props OK when propsOnly).
   * null = no market constraint at all.
   */
  allowedMarketKeys: string[] | null;
};

const RUSH_YARDS_KEYS = ["player_rush_yds"] as const;
const REC_YARDS_KEYS = ["player_reception_yds"] as const;
const PASS_YARDS_KEYS = ["player_pass_yds"] as const;

/** Broader skill-prop families when the ask says "props" (not yards-only). */
const RUSH_PROP_KEYS = [
  "player_rush_yds",
  "player_rush_attempts",
  "player_rush_tds",
] as const;
const REC_PROP_KEYS = [
  "player_reception_yds",
  "player_receptions",
  "player_reception_tds",
] as const;
const PASS_PROP_KEYS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_interceptions",
  "player_pass_attempts",
  "player_pass_completions",
] as const;

/** MLB home-run prop family (mains + alts via canonical key). */
const HOME_RUN_PROP_KEYS = ["batter_home_runs"] as const;

/** First-TD / anytime-TD / FG / combo asks. */
const TD_PROP_KEYS = ["player_anytime_td", "player_first_td", "player_rush_tds", "player_reception_tds"] as const;
const FIRST_TD_PROP_KEYS = ["player_first_td"] as const;
const FG_PROP_KEYS = ["player_field_goals"] as const;
const FOOTBALL_COMBO_PROP_KEYS = [
  "player_pass_rush_yds",
  "player_rush_reception_yds",
  "player_rush_reception_tds",
  "player_pass_rush_reception_yds",
  "player_pass_rush_reception_tds",
] as const;
const MLB_BATTER_STAT_KEYS = [
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs",
  "batter_stolen_bases",
  "batter_hits_runs_rbis",
] as const;
const MLB_PITCHER_STAT_KEYS = ["pitcher_strikeouts", "pitcher_outs"] as const;
const NBA_COMBO_PROP_KEYS = [
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_points_assists",
  "player_rebounds_assists",
  "player_double_double",
] as const;
const SOCCER_SPECIAL_LINE_KEYS = ["btts", "draw_no_bet", "double_chance"] as const;

/** Strip alternate / period suffixes so allowlist checks stay stable. */
export function canonicalPropMarketKey(marketKey: string | null | undefined): string {
  let k = String(marketKey ?? "").trim().toLowerCase();
  if (!k) return "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2|1h|2h|f5)$/i, "");
  if (k === "batter_runs_scored") return "batter_runs";
  if (k === "player_1st_td") return "player_first_td";
  return k;
}

/**
 * Pair skill words that share a trailing "yards" (or each name yards).
 * Does NOT treat "rushing yards and passing TDs" as pass-yards — yards must
 * bind to the skill word, not merely appear somewhere in the ask.
 */
function yardsScopesBothSidesOfAnd(t: string, left: RegExp, right: RegExp): boolean {
  const L = left.source;
  const R = right.source;
  // "rushing and passing yards" / "passing and receiving yards"
  const shared = new RegExp(
    `(?:${L})(?:\\s+\\w+){0,2}\\s+and\\s+(?:${R})(?:\\s+\\w+){0,2}\\s+yards?\\b`,
    "i",
  );
  const sharedRev = new RegExp(
    `(?:${R})(?:\\s+\\w+){0,2}\\s+and\\s+(?:${L})(?:\\s+\\w+){0,2}\\s+yards?\\b`,
    "i",
  );
  // "rushing yards and passing yards"
  const both = new RegExp(
    `(?:${L})\\s+yards?\\b[\\s\\S]{0,32}\\band\\b[\\s\\S]{0,32}(?:${R})\\s+yards?\\b`,
    "i",
  );
  const bothRev = new RegExp(
    `(?:${R})\\s+yards?\\b[\\s\\S]{0,32}\\band\\b[\\s\\S]{0,32}(?:${L})\\s+yards?\\b`,
    "i",
  );
  return shared.test(t) || sharedRev.test(t) || both.test(t) || bothRev.test(t);
}

/** "rushing, passing, and receiving yards" list form. */
function yardsFamilyListFlags(t: string): {
  rush: boolean;
  pass: boolean;
  rec: boolean;
} | null {
  const m = t.match(
    /\b((?:rush(?:ing)?|pass(?:ing)?|receiv\w*)(?:\s*,\s*(?:rush(?:ing)?|pass(?:ing)?|receiv\w*))+(?:\s*,?\s*and\s+(?:rush(?:ing)?|pass(?:ing)?|receiv\w*))?)\s+yards?\b/i,
  );
  if (!m) return null;
  const chunk = m[1].toLowerCase();
  return {
    rush: /rush/.test(chunk),
    pass: /pass/.test(chunk),
    rec: /receiv/.test(chunk),
  };
}

function hasRushYardsAsk(t: string): boolean {
  if (
    /\brush(?:ing)?\s+yards?\b/i.test(t) ||
    /\brush(?:ing)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  const list = yardsFamilyListFlags(t);
  if (list?.rush) return true;
  return (
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i) ||
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\bpass(?:ing)?\b/i)
  );
}

function hasRecYardsAsk(t: string): boolean {
  if (
    /\breceiv(?:ing|e)?\s+yards?\b/i.test(t) ||
    /\breception\s+yards?\b/i.test(t) ||
    /\brec(?:eiving)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  const list = yardsFamilyListFlags(t);
  if (list?.rec) return true;
  return (
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i) ||
    yardsScopesBothSidesOfAnd(t, /\bpass(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i)
  );
}

function hasPassYardsAsk(t: string): boolean {
  if (
    /\bpass(?:ing)?\s+yards?\b/i.test(t) ||
    /\bpass(?:ing)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  const list = yardsFamilyListFlags(t);
  if (list?.pass) return true;
  return (
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\bpass(?:ing)?\b/i) ||
    yardsScopesBothSidesOfAnd(t, /\bpass(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i)
  );
}

/**
 * "rushing receiving and passing props" / "pass + rush props" — skill families
 * named with an explicit props ask. Does not fire on generic "5 leg NFL parlay".
 */
function skillPropFamilyFlags(t: string): {
  rush: boolean;
  pass: boolean;
  rec: boolean;
} | null {
  if (!/\bprops?\b/i.test(t)) return null;
  const rush = /\brush(?:ing)?\b/i.test(t);
  const pass = /\bpass(?:ing)?\b/i.test(t);
  const rec = /\breceiv(?:ing|e|er)?\b|\breceptions?\b/i.test(t);
  if (!rush && !pass && !rec) return null;
  return { rush, pass, rec };
}

/**
 * "3 leg home run" / "6 home run hitters" / "HR props" — MLB HR prop ticket.
 * Must not fill with spreads, strikeouts, or other prop families.
 */
function hasHomeRunPropAsk(t: string): boolean {
  if (/\bhome\s*runs?\b/i.test(t)) return true;
  if (/\bhomers?\b/i.test(t)) return true;
  // Standalone HR token ("3 leg hr", "hr props") — not "throw" / "three".
  if (/\bhrs?\b/i.test(t)) return true;
  return false;
}

function hasFirstTdAsk(t: string): boolean {
  return /\b(?:first|1st)\s+(?:td|touchdown)\b/i.test(t);
}

function hasAnytimeTdAsk(t: string): boolean {
  return /\banytime\s+(?:td|touchdown)\b/i.test(t) || /\batd\b/i.test(t);
}

function hasFieldGoalPropAsk(t: string): boolean {
  return /\bfield\s*goals?\b/i.test(t) || /\bfgs?\b/i.test(t);
}

function hasFootballComboPropAsk(t: string): boolean {
  return (
    /\bpass(?:ing)?\s*\+\s*rush/i.test(t) ||
    /\brush(?:ing)?\s*\+\s*rec/i.test(t) ||
    /\b(?:pass|rush|rec(?:eiving)?).{0,12}(?:combo|combined)\b/i.test(t) ||
    /\bcombo\s+props?\b/i.test(t)
  );
}

function hasDoubleDoubleAsk(t: string): boolean {
  return /\bdouble[-\s]?doubles?\b/i.test(t) || /\bdds?\b/i.test(t);
}

function hasPraAsk(t: string): boolean {
  return /\bpra\b/i.test(t) || /\bpoints?\s*\+\s*reb(?:ounds?)?\s*\+\s*ast/i.test(t);
}

function hasSoccerSpecialAsk(t: string): boolean {
  return (
    /\bbtts\b/i.test(t) ||
    /\bboth\s+teams?\s+to\s+score\b/i.test(t) ||
    /\bdraw\s*no\s*bet\b/i.test(t) ||
    /\bdnb\b/i.test(t) ||
    /\bdouble\s+chance\b/i.test(t)
  );
}

/**
 * Market allowlist + props-only flag for a Coach ask.
 * Example: "10 lag rushing and passing yards"
 * → propsOnly + player_rush_yds + player_pass_yds (alts included via canonical key).
 * Example: "9 leg nfl rushing receiving and passing props"
 * → propsOnly + rush/rec/pass skill prop families (no spreads/totals).
 * Example: "3 leg home run"
 * → propsOnly + batter_home_runs (no spreads / strikeouts).
 */
export function parseCoachAskMarketConstraint(
  text: string | null | undefined,
): CoachAskMarketConstraint {
  const t = String(text ?? "").trim();
  if (!t) return { propsOnly: false, allowedMarketKeys: null };

  const rushYds = hasRushYardsAsk(t);
  const recYds = hasRecYardsAsk(t);
  const passYds = hasPassYardsAsk(t);

  if (rushYds || recYds || passYds) {
    const keys: string[] = [];
    if (rushYds) keys.push(...RUSH_YARDS_KEYS);
    if (recYds) keys.push(...REC_YARDS_KEYS);
    if (passYds) keys.push(...PASS_YARDS_KEYS);
    // Naming yards families means a yards-prop ticket — keep game lines out so
    // F5/TOTAL/ALT SPREAD cannot fill legs the user asked for as yards.
    return {
      propsOnly: true,
      allowedMarketKeys: keys,
    };
  }

  if (hasHomeRunPropAsk(t)) {
    return {
      propsOnly: true,
      allowedMarketKeys: [...HOME_RUN_PROP_KEYS],
    };
  }

  if (hasFirstTdAsk(t)) {
    return { propsOnly: true, allowedMarketKeys: [...FIRST_TD_PROP_KEYS] };
  }
  if (hasAnytimeTdAsk(t)) {
    return { propsOnly: true, allowedMarketKeys: [...TD_PROP_KEYS] };
  }
  if (hasFieldGoalPropAsk(t)) {
    return { propsOnly: true, allowedMarketKeys: [...FG_PROP_KEYS] };
  }
  if (hasFootballComboPropAsk(t)) {
    return { propsOnly: true, allowedMarketKeys: [...FOOTBALL_COMBO_PROP_KEYS] };
  }
  if (hasDoubleDoubleAsk(t) || hasPraAsk(t)) {
    return { propsOnly: true, allowedMarketKeys: [...NBA_COMBO_PROP_KEYS] };
  }
  if (hasSoccerSpecialAsk(t)) {
    // Soccer specials are game lines (not player props).
    return { propsOnly: false, allowedMarketKeys: [...SOCCER_SPECIAL_LINE_KEYS] };
  }

  const skillProps = skillPropFamilyFlags(t);
  if (skillProps) {
    const keys: string[] = [];
    if (skillProps.rush) keys.push(...RUSH_PROP_KEYS);
    if (skillProps.rec) keys.push(...REC_PROP_KEYS);
    if (skillProps.pass) keys.push(...PASS_PROP_KEYS);
    return {
      propsOnly: true,
      allowedMarketKeys: keys,
    };
  }

  return { propsOnly: false, allowedMarketKeys: null };
}

export function propMarketKeyAllowed(
  marketKey: string | null | undefined,
  allowed: readonly string[] | null | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const canon = canonicalPropMarketKey(marketKey);
  if (!canon) return false;
  const allow = new Set(allowed.map((k) => canonicalPropMarketKey(k)));
  return allow.has(canon);
}

/** Filter posted prop-pool rows to the ask's market allowlist. */
export function filterPropPoolByAskMarkets<
  T extends { marketKey?: string | null },
>(pool: T[], allowed: readonly string[] | null | undefined): T[] {
  if (!allowed || allowed.length === 0) return pool;
  return pool.filter((row) => propMarketKeyAllowed(row.marketKey, allowed));
}

/** Final ticket defense: drop legs outside the allowlist (or non-props when props-only). */
export function filterPicksByAskMarketConstraint<
  T extends {
    isProp?: boolean;
    propMarketKey?: string | null;
    market?: string | null;
  },
>(picks: T[], constraint: CoachAskMarketConstraint): T[] {
  let out = picks;
  if (constraint.propsOnly) {
    out = out.filter((p) => !!p.isProp);
  }
  if (constraint.allowedMarketKeys && constraint.allowedMarketKeys.length > 0) {
    out = out.filter((p) =>
      propMarketKeyAllowed(p.propMarketKey ?? null, constraint.allowedMarketKeys),
    );
  }
  return out;
}
