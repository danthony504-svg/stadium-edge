/**
 * Ledger grading helpers — resolve display labels / provider keys to a canonical
 * Odds API market, decide combo rejection, and settle O/U against mapped stats.
 *
 * Tackles + Assists is a single provider market (`player_tackles_assists`) that
 * settles on ESPN `totalTackles` — not an unsupported multi-stat combo like PRA.
 */

import {
  computeAmbiguous,
  gameValueForMarket,
} from "./propStatValue.js";

export type GradeSettleResult = "win" | "loss" | "push" | "ungraded";

/** Provider keys that look combo-ish in labels but settle on one mapped stat. */
const GRADEABLE_SINGLE_STAT_DESPITE_PLUS = new Set([
  "player_tackles_assists",
]);

/** True multi-stat / yes-no markets the ledger cannot settle honestly. */
const UNSUPPORTED_COMBO_GRADE_KEYS = new Set([
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_points_assists",
  "player_rebounds_assists",
  "player_blocks_steals",
  "batter_hits_runs_rbis",
  "player_double_double",
  "player_anytime_td",
  "player_first_td",
  "player_1st_td",
  "player_goal_scorer_anytime",
  "player_first_goal_scorer",
]);

/** Human steal/card labels → provider key (mirrors liveStealsCore PROP_MARKET_LABELS). */
const LABEL_TO_MARKET_KEY: Record<string, string> = {
  points: "player_points",
  rebounds: "player_rebounds",
  assists: "player_assists",
  "3-pointers": "player_threes",
  "pts+reb+ast": "player_points_rebounds_assists",
  "pts+reb": "player_points_rebounds",
  "pts+ast": "player_points_assists",
  "reb+ast": "player_rebounds_assists",
  blocks: "player_blocks",
  steals: "player_steals",
  "blocks+steals": "player_blocks_steals",
  turnovers: "player_turnovers",
  "pass yds": "player_pass_yds",
  "pass tds": "player_pass_tds",
  "rush yds": "player_rush_yds",
  "rec yds": "player_reception_yds",
  receptions: "player_receptions",
  "anytime td": "player_anytime_td",
  goals: "player_goals",
  "shots on goal": "player_shots_on_goal",
  "anytime goal": "player_goal_scorer_anytime",
  "shots on target": "player_shots_on_target",
  shots: "player_shots",
  hits: "batter_hits",
  "total bases": "batter_total_bases",
  "home runs": "batter_home_runs",
  "stolen bases": "batter_stolen_bases",
  sacks: "player_sacks",
  "kicking points": "player_kicking_points",
  "tackles + assists": "player_tackles_assists",
  "tackles+assists": "player_tackles_assists",
  "solo tackles": "player_solo_tackles",
  "defensive ints": "player_defensive_interceptions",
  strikeouts: "pitcher_strikeouts",
};

export function canonicalGradeMarketKey(market: string | null | undefined): string {
  let k = String(market ?? "").trim().toLowerCase();
  if (!k) return "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2)$/i, "");
  if (k === "player_1st_td") return "player_first_td";
  if (k === "batter_runs_scored") return "batter_runs";
  return k;
}

/**
 * Resolve a ledger `market` field (provider key OR human label) to a canonical
 * Odds API key when known.
 */
export function resolveGradeMarketKey(market: string | null | undefined): string | null {
  const raw = String(market ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const asKey = canonicalGradeMarketKey(lower.replace(/\s+/g, "_"));
  if (/^(player_|batter_|pitcher_)/.test(asKey)) return asKey || null;
  const fromLabel = LABEL_TO_MARKET_KEY[lower.replace(/\s+/g, " ").trim()];
  if (fromLabel) return fromLabel;
  // Normalize "Tackles + Assists" spacing around +.
  const plusNorm = lower.replace(/\s*\+\s*/g, " + ").replace(/\s+/g, " ").trim();
  if (LABEL_TO_MARKET_KEY[plusNorm]) return LABEL_TO_MARKET_KEY[plusNorm];
  return null;
}

/**
 * True when the ledger must refuse settlement (genuine multi-stat / yes-no).
 * Tackles + Assists resolves to `player_tackles_assists` and is gradeable.
 */
export function isUnsupportedComboGradeMarket(market: string | null | undefined): boolean {
  const key = resolveGradeMarketKey(market);
  if (key && GRADEABLE_SINGLE_STAT_DESPITE_PLUS.has(key)) return false;
  if (key && UNSUPPORTED_COMBO_GRADE_KEYS.has(key)) return true;
  const text = String(market ?? "");
  if (key) {
    // Known single-stat key — do not reject on cosmetic "+" in the label.
    return false;
  }
  return /\+|points\s+rebounds|\bpra\b|double[- ]double/i.test(text);
}

/** StatMuse / display word used when fetching a game log for a known key. */
export function gradeStatWordForMarket(
  marketKey: string | null,
  fallbackLabel: string,
): string {
  switch (marketKey) {
    case "player_tackles_assists":
      return "total tackles";
    case "player_solo_tackles":
      return "solo tackles";
    case "player_defensive_interceptions":
      return "interceptions";
    case "player_kicking_points":
      return "kicking points";
    case "player_sacks":
      return "sacks";
    default:
      return fallbackLabel;
  }
}

export function settleNumericOu(
  value: number | null | undefined,
  side: "over" | "under",
  line: number,
): { result: GradeSettleResult; detail: string } {
  if (value == null || !Number.isFinite(value)) {
    return { result: "ungraded", detail: "no stat value" };
  }
  if (value === line) return { result: "push", detail: `${value} = ${line}` };
  const over = value > line;
  const win = side === "over" ? over : !over;
  return { result: win ? "win" : "loss", detail: `${value} ${side} ${line}` };
}

/**
 * Settle a prop against a single game's ESPN-style stats map using the same
 * `gameValueForMarket` mapping the Monte Carlo path uses (e.g. totalTackles).
 */
export function settlePropMarketAgainstStats(
  marketKey: string,
  stats: Record<string, string>,
  side: "over" | "under",
  line: number,
): { result: GradeSettleResult; detail: string; value: number | null } {
  const key = canonicalGradeMarketKey(marketKey);
  const ambiguous = computeAmbiguous(Object.keys(stats));
  const value = gameValueForMarket(key, stats, ambiguous);
  if (value == null) {
    return { result: "ungraded", detail: "no stat value", value: null };
  }
  const settled = settleNumericOu(value, side, line);
  return { ...settled, value };
}
