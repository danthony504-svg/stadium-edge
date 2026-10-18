// Maps a player's real ESPN / StatMuse game-log line to the per-game value for a
// betting market. Ported from stadium-mobile/lib/propStats.ts so the Monte Carlo
// engine runs on the same stat definitions as the client UI.

const MARKET_COMBO: Record<string, string[]> = {
  player_points_rebounds_assists: ["PTS", "REB", "AST"],
  player_points_rebounds: ["PTS", "REB"],
  player_points_assists: ["PTS", "AST"],
  player_rebounds_assists: ["REB", "AST"],
  player_blocks_steals: ["BLK", "STL"],
  batter_hits_runs_rbis: ["H", "R", "RBI"],
};

const MARKET_SINGLE: Record<string, string[]> = {
  // Basketball logs use PTS; NHL skater logs use P (same pattern as AST → A).
  player_points: ["PTS", "P"],
  player_rebounds: ["REB"],
  player_assists: ["AST", "A"],
  player_blocks: ["BLK"],
  player_steals: ["STL"],
  player_turnovers: ["TO"],
  batter_hits: ["H"],
  batter_home_runs: ["HR"],
  batter_stolen_bases: ["SB"],
  batter_total_bases: ["TB"],
  player_sacks: ["SACK", "SACKS"],
  player_tackles_assists: ["totalTackles", "TOT"],
  player_solo_tackles: ["soloTackles", "SOLO"],
  player_defensive_interceptions: ["interceptions"],
  player_kicking_points: ["kickingPoints", "totalKickingPoints"],
  pitcher_strikeouts: ["K", "SO"],
  player_goals: ["G"],
  player_shots_on_goal: ["S", "SOG", "SHOTS"],
  player_goal_scorer_anytime: ["G"],
  player_shots: ["SH"],
  player_shots_on_target: ["SOT"],
  // Football game logs repeat display labels such as YDS, TD, and LNG across
  // passing, rushing, and receiving. The history route retains ESPN's stable
  // machine field names alongside those labels, so use the unambiguous names
  // rather than risk grading the wrong stat column.
  player_pass_yds: ["passingYards"],
  player_pass_attempts: ["passingAttempts"],
  player_pass_completions: ["completions"],
  player_pass_tds: ["passingTouchdowns"],
  player_pass_interceptions: ["interceptions"],
  player_pass_longest_completion: ["longPassing"],
  player_rush_yds: ["rushingYards"],
  player_rush_attempts: ["rushingAttempts"],
  player_rush_longest: ["longRushing"],
  player_reception_yds: ["receivingYards"],
  player_receptions: ["receptions"],
  player_reception_longest: ["longReception"],
  // ESPN gamelog exposes TGTS / receivingTargets — never invent when absent.
  player_targets: ["receivingTargets", "TGTS", "targets"],
  // Football TD component markets — unambiguous machine names only.
  player_rush_tds: ["rushingTouchdowns"],
  player_reception_tds: ["receivingTouchdowns"],
};

/**
 * Anytime TD scorer = player personally scores (rush / receiving / return).
 * Passing TDs thrown by a QB are NOT scoring TDs for this market.
 * Return / defensive TD fields are included only when ESPN exposes them.
 */
const SCORING_TD_FIELDS = [
  "rushingTouchdowns",
  "receivingTouchdowns",
  "kickReturnTouchdowns",
  "puntReturnTouchdowns",
  "interceptionReturnTouchdowns",
  "fumbleReturnTouchdowns",
] as const;

/**
 * Sum scoring TDs for a game.
 * Skill path requires BOTH rushingTouchdowns and receivingTouchdowns present —
 * a missing sibling is incomplete history, never a verified zero.
 * Return/defensive fields are added only when ESPN exposes them.
 */
export function scoringTouchdownsForGame(
  stats: Record<string, string>,
): number | null {
  const rush = num(stats, "rushingTouchdowns");
  const rec = num(stats, "receivingTouchdowns");
  // Pass-only / incomplete skill rows: do not invent zeros for missing columns.
  if (rush == null && rec == null) {
    // Pure return specialist logs may only expose return TD fields.
    let retSum = 0;
    let retAny = false;
    for (const lab of SCORING_TD_FIELDS) {
      if (lab === "rushingTouchdowns" || lab === "receivingTouchdowns") continue;
      const n = num(stats, lab);
      if (n != null) {
        retAny = true;
        retSum += n;
      }
    }
    return retAny ? retSum : null;
  }
  if (rush == null || rec == null) return null;
  let sum = rush + rec;
  for (const lab of SCORING_TD_FIELDS) {
    if (lab === "rushingTouchdowns" || lab === "receivingTouchdowns") continue;
    const n = num(stats, lab);
    if (n != null) sum += n;
  }
  return sum;
}

export function isFirstTdMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!m) return false;
  if (m === "player first td" || m === "player 1st td" || m === "first td") return true;
  return /first\s*td|1st\s*td|first\s*touchdown/.test(m);
}

/** True when Over settlement requires ≥2 scoring TDs (not Anytime yes/no). */
export function isMultiTdOverLine(line: number | null | undefined): boolean {
  return line != null && Number.isFinite(line) && line >= 1.5;
}

const MARKET_MADE: Record<string, string[]> = {
  player_threes: ["3PM", "3PT"],
};

function num(stats: Record<string, string>, label: string): number | null {
  // Missing / blank must stay missing — Number("") === 0 would zero-fill.
  if (!Object.prototype.hasOwnProperty.call(stats, label)) return null;
  const raw = stats[label];
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

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

export function computeAmbiguous(labels: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const set = new Set<string>();
  for (const [l, c] of counts) if (c > 1) set.add(l);
  return set;
}

export function gameValueForMarket(
  market: string,
  stats: Record<string, string>,
  ambiguous: Set<string>,
): number | null {
  // Genuine alt rungs share the same underlying stat as the main market key.
  if (market.endsWith("_alternate")) {
    return gameValueForMarket(market.slice(0, -"_alternate".length), stats, ambiguous);
  }

  if (market === "batter_total_bases") {
    const h = num(stats, "H");
    const d = num(stats, "2B");
    const t = num(stats, "3B");
    const hr = num(stats, "HR");
    if (h == null || d == null || t == null || hr == null) return null;
    return h + d + 2 * t + 3 * hr;
  }

  // Rush+rec TD combo markets (explicit sum — not Anytime scorer).
  if (market === "player_rush_reception_tds") {
    const rush = num(stats, "rushingTouchdowns");
    const rec = num(stats, "receivingTouchdowns");
    if (rush == null || rec == null) return null;
    return rush + rec;
  }
  if (market === "player_pass_rush_reception_tds") {
    const pass = num(stats, "passingTouchdowns");
    const rush = num(stats, "rushingTouchdowns");
    const rec = num(stats, "receivingTouchdowns");
    if (pass == null || rush == null || rec == null) return null;
    return pass + rush + rec;
  }

  // Anytime TD scorer — rush/rec/return only. Never count passing TDs thrown.
  // First TD is intentionally unmapped here: no trustworthy scoring-order feed
  // (see diagnosePropSimNullReason → missing_scoring_order).
  if (market === "player_anytime_td") {
    return scoringTouchdownsForGame(stats);
  }
  if (isFirstTdMarket(market)) {
    return null;
  }

  // Kicking points: prefer ESPN machine field; else exact FG×3 + XP identity.
  if (market === "player_kicking_points") {
    for (const lab of ["kickingPoints", "totalKickingPoints"]) {
      if (ambiguous.has(lab)) continue;
      const n = num(stats, lab);
      if (n != null) return n;
    }
    const fg = !ambiguous.has("fieldGoalsMade")
      ? num(stats, "fieldGoalsMade")
      : !ambiguous.has("FG")
        ? num(stats, "FG")
        : null;
    const xp = !ambiguous.has("extraPointsMade")
      ? num(stats, "extraPointsMade")
      : !ambiguous.has("XP")
        ? num(stats, "XP")
        : null;
    if (fg != null && xp != null) return fg * 3 + xp;
    return null;
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

/** Markets whose outcomes are low-count integers (Poisson-friendly). */
export function isDiscreteCountMarket(market: string): boolean {
  const m = market.endsWith("_alternate")
    ? market.slice(0, -"_alternate".length)
    : market;
  return /threes|blocks|steals|home_runs|stolen_bases|sacks|pass_tds|rush_tds|reception_tds|anytime_td|goal_scorer|receptions|pass_attempts|pass_completions|pass_interceptions|pass_longest|rush_attempts|rush_longest|reception_longest|tackles|defensive_interceptions|kicking_points|field_goals/i.test(
    m,
  );
}
