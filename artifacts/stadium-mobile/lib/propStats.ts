// Shared, REAL prop-stat helpers. Everything here maps a player's actual ESPN /
// StatMuse game-log line to the per-game value for a betting market — never an
// estimate or a fabricated number. Used by the Player Props sheet AND the prop
// detail page so the market→stat mapping lives in exactly one place.

// Line-grid resolution for hit-rate / line work (half-point, like book lines).
export const STEP = 0.5;

// Markets whose per-game value is the SUM of several ESPN stat columns.
const MARKET_COMBO: Record<string, string[]> = {
  player_points_rebounds_assists: ["PTS", "REB", "AST"],
  player_points_rebounds: ["PTS", "REB"],
  player_points_assists: ["PTS", "AST"],
  player_rebounds_assists: ["REB", "AST"],
  player_blocks_steals: ["BLK", "STL"],
  batter_hits_runs_rbis: ["H", "R", "RBI"],
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

// Markets whose ESPN gamelog column is a "made-attempted" string rather than a
// plain number — NBA "3PT" comes through as e.g. "2-5" (2 made of 5 attempted).
// The betting quantity ("3-Pointers" = threes MADE) is the number before the
// dash, so reading it is an EXACT extraction of a real stat, not an estimate.
// "3PM" is listed first for feeds that already give a bare made count.
const MARKET_MADE: Record<string, string[]> = {
  player_threes: ["3PM", "3PT"],
};

function num(stats: Record<string, string>, label: string): number | null {
  const n = Number(stats[label]);
  return Number.isFinite(n) ? n : null;
}

// Made count from a column that may be a bare number ("3") or a real
// "made-attempted" pair ("2-5"). Returns the made portion, or null if the value
// is missing or not one of those two exact shapes (never guesses).
function madeCount(stats: Record<string, string>, label: string): number | null {
  const raw = stats[label];
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const pair = s.match(/^(\d+)\s*-\s*\d+$/);
  if (pair) return Number(pair[1]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Labels that appear MORE THAN ONCE in the ESPN gamelog header (e.g. football's
// passing + rushing "YDS"/"TD"). The server flattens stats into a label-keyed
// object, so a duplicated label collides and can't be trusted to mean one thing
// — callers treat those as unavailable rather than risk the wrong stat.
export function computeAmbiguous(labels: string[] | undefined | null): Set<string> {
  const counts = new Map<string, number>();
  for (const l of labels ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
  const set = new Set<string>();
  for (const [l, c] of counts) if (c > 1) set.add(l);
  return set;
}

// Real per-game value for a market from one game's stat line. Returns null when
// the feed doesn't carry the needed column(s) — we never invent a number.
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
  const made = MARKET_MADE[market];
  if (made) {
    for (const lab of made) {
      if (ambiguous.has(lab)) continue;
      const n = madeCount(stats, lab);
      if (n != null) return n;
    }
    return null;
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
