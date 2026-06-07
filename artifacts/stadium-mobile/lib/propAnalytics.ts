// Shared, pure prop-analytics helpers used by BOTH the Player Props list card
// (components/PropCard) and the detail sheet (components/PlayerPropsSheet). Kept
// dependency-free (type-only imports, no runtime import of lib/api) so there is
// ONE source of truth for the market -> stat-column mapping. Adding a prop
// market should only touch the maps in this file.
//
// Honesty rule: every number here is derived from REAL data (the player's actual
// ESPN/StatMuse game log and the book's posted American prices). Functions return
// null when the feed doesn't carry what's needed — we never invent a value.

import type { PlayerProp } from "@/lib/api";

// Line-grid resolution for hit-rate math (half-point, like book lines).
export const STEP = 0.5;

// Markets whose per-game value is the SUM of several ESPN stat columns.
const MARKET_COMBO: Record<string, string[]> = {
  player_points_rebounds_assists: ["PTS", "REB", "AST"],
  player_points_rebounds: ["PTS", "REB"],
  player_points_assists: ["PTS", "AST"],
  player_rebounds_assists: ["REB", "AST"],
  player_blocks_steals: ["BLK", "STL"],
};

// Markets that map to a single ESPN stat column. The array is a fallback list —
// the first present (and unambiguous) label wins, since column names differ by
// sport (e.g. assists is "AST" in the NBA log but "A" in the NHL log; shots on
// goal is "S" in the NHL log).
const MARKET_SINGLE: Record<string, string[]> = {
  player_points: ["PTS"],
  player_rebounds: ["REB"],
  player_assists: ["AST", "A"],
  player_blocks: ["BLK"],
  player_steals: ["STL"],
  player_turnovers: ["TO"],
  batter_hits: ["H"],
  batter_home_runs: ["HR"],
  batter_stolen_bases: ["SB"],
  player_sacks: ["SACK", "SACKS"],
  pitcher_strikeouts: ["K", "SO"],
  player_goals: ["G"],
  player_shots_on_goal: ["S", "SOG", "SHOTS"],
  // Soccer (StatMuse fc grid columns).
  player_goal_scorer_anytime: ["G"],
  player_shots: ["SH"],
  player_shots_on_target: ["SOT"],
};

function num(stats: Record<string, string>, label: string): number | null {
  const n = Number(stats[label]);
  return Number.isFinite(n) ? n : null;
}

// Real per-game value for a market from one game's stat line. Returns null when
// the feed doesn't carry the needed column(s) — we never invent a number.
//
// `ambiguous` is the set of labels that appear MORE THAN ONCE in the ESPN
// gamelog header (e.g. football's passing + rushing "YDS"/"TD"). The server
// flattens stats into a label-keyed object, so a duplicated label collides and
// can't be trusted to mean one thing — we treat those as unavailable rather
// than risk showing the wrong stat.
export function gameValueForMarket(
  market: string,
  stats: Record<string, string>,
  ambiguous: Set<string>,
): number | null {
  // Total bases isn't a single ESPN column — it's an exact identity from real
  // columns: TB = H + 2B + 2*(3B) + 3*(HR). All four are unambiguous in the MLB
  // batting log, so this is a real computation, not an estimate.
  if (market === "batter_total_bases") {
    const h = num(stats, "H");
    const d = num(stats, "2B");
    const t = num(stats, "3B");
    const hr = num(stats, "HR");
    if (h == null || d == null || t == null || hr == null) return null;
    return h + d + 2 * t + 3 * hr;
  }

  const combo = MARKET_COMBO[market];
  if (combo) {
    let sum = 0;
    for (const lab of combo) {
      if (ambiguous.has(lab)) return null;
      const n = num(stats, lab);
      if (n == null) return null;
      sum += n;
    }
    return sum;
  }
  const singles = MARKET_SINGLE[market];
  if (singles) {
    for (const lab of singles) {
      if (ambiguous.has(lab)) continue;
      const n = num(stats, lab);
      if (n != null) return n;
    }
  }
  return null;
}

// Header labels that appear MORE THAN ONCE in the gamelog (ambiguous after the
// server's label-keyed flatten) — excluded everywhere rather than risk showing
// the wrong stat.
export function ambiguousLabels(labels: string[] | null | undefined): Set<string> {
  const counts = new Map<string, number>();
  for (const l of labels ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
  const set = new Set<string>();
  for (const [l, c] of counts) if (c > 1) set.add(l);
  return set;
}

// Real per-game values for a market over the most recent games (newest first),
// dropping games where the feed doesn't carry the stat. `recent` is the game-log
// history array; only its `.stats` is read so callers can pass any shape.
export function recentValues(
  market: string,
  recent: { stats: Record<string, string> }[] | null | undefined,
  ambiguous: Set<string>,
  max = 10,
): number[] {
  if (!recent) return [];
  const out: number[] = [];
  for (const g of recent) {
    const v = gameValueForMarket(market, g.stats, ambiguous);
    if (v != null) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

// Empirical clearance rate of an OVER line over the real game log. For yes/no
// markets (line null) a "hit" = the event happened (value >= 1). Returns null
// when there are no usable games.
export function hitRate(
  values: number[],
  line: number | null,
): { hits: number; total: number; pct: number } | null {
  if (values.length === 0) return null;
  const threshold = line == null ? 1 : line;
  const hits = values.filter((v) => v >= threshold).length;
  return { hits, total: values.length, pct: Math.round((hits / values.length) * 100) };
}

// American price -> implied win probability as a whole-number percent. Null for
// a missing/NaN price (nothing to imply).
export function impliedPct(american: number | null | undefined): number | null {
  if (american == null || !Number.isFinite(american)) return null;
  const p = american < 0 ? -american / (-american + 100) : 100 / (american + 100);
  return Math.round(p * 100);
}

// Spread of the player's real recent output: coefficient of variation
// (stdev / mean), bucketed Low / Medium / High. Null when there are fewer than
// two games or the mean is ~0 (no meaningful spread to report).
export function varianceTier(
  values: number[],
): { cv: number; tier: "Low" | "Medium" | "High" } | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0.0001) return null;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  const tier = cv < 0.25 ? "Low" : cv < 0.5 ? "Medium" : "High";
  return { cv, tier };
}

// How much real sample backs the model read — a transparent label, NOT a
// probability. Driven by the game-log sample size and how clear the edge is.
// Few games -> Low; a deep log with a meaningful edge -> High; otherwise Medium.
export function confidenceTier(games: number, edgePct: number): "Low" | "Medium" | "High" {
  if (games < 4) return "Low";
  if (games >= 8 && Math.abs(edgePct) >= 4) return "High";
  if (games >= 5) return "Medium";
  return "Low";
}

// Pick up to three REAL priced OVER rungs to show as Safe / Best / Value:
//  - best  = the main (non-alt) line, else the median priced rung
//  - safe  = the nearest priced rung BELOW best (lower line, easier Over)
//  - value = the nearest priced rung ABOVE best (higher line, bigger payout)
// Only rungs with a line and a real Over price qualify; missing slots are null
// so the card shows only what the book actually posts (never an interpolation).
export function selectRungs(rungs: PlayerProp[]): {
  safe: PlayerProp | null;
  best: PlayerProp | null;
  value: PlayerProp | null;
} {
  const priced = rungs
    .filter((r) => r.line != null && r.overPrice != null)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  if (priced.length === 0) return { safe: null, best: null, value: null };
  const best = priced.find((r) => !r.alt) ?? priced[Math.floor(priced.length / 2)];
  const bestLine = best.line ?? 0;
  const below = priced.filter((r) => (r.line ?? 0) < bestLine);
  const above = priced.filter((r) => (r.line ?? 0) > bestLine);
  return {
    safe: below.length ? below[below.length - 1] : null,
    best,
    value: above.length ? above[0] : null,
  };
}
