// Shared, REAL prop-stat helpers. Everything here maps a player's actual ESPN /
// StatMuse game-log line to the per-game value for a betting market — never an
// estimate or a fabricated number. Kept in parity with
// api-server/src/lib/propStatValue.ts.

export const STEP = 0.5;

const MARKET_COMBO: Record<string, string[]> = {
  player_points_rebounds_assists: ["PTS", "REB", "AST"],
  player_points_rebounds: ["PTS", "REB"],
  player_points_assists: ["PTS", "AST"],
  player_rebounds_assists: ["REB", "AST"],
  player_blocks_steals: ["BLK", "STL"],
  batter_hits_runs_rbis: ["H", "R", "RBI"],
  player_pass_rush_yds: ["passingYards", "rushingYards"],
  player_rush_reception_yds: ["rushingYards", "receivingYards"],
  player_pass_rush_reception_yds: ["passingYards", "rushingYards", "receivingYards"],
};

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
  batter_rbis: ["RBI"],
  batter_runs: ["R"],
  batter_runs_scored: ["R"],
  player_sacks: ["SACK", "SACKS"],
  player_tackles_assists: ["totalTackles", "TOT"],
  player_solo_tackles: ["soloTackles", "SOLO"],
  player_defensive_interceptions: ["interceptions"],
  player_kicking_points: ["kickingPoints", "totalKickingPoints"],
  pitcher_strikeouts: ["K", "SO"],
  pitcher_outs: ["OUTS", "IP"],
  player_goals: ["G"],
  player_shots_on_goal: ["S", "SOG", "SHOTS"],
  player_goal_scorer_anytime: ["G"],
  player_first_goal_scorer: ["G"],
  player_shots: ["SH"],
  player_shots_on_target: ["SOT"],
  player_pass_yds: ["passingYards"],
  player_pass_attempts: ["passingAttempts"],
  player_pass_completions: ["completions"],
  player_pass_tds: ["passingTouchdowns"],
  player_pass_interceptions: ["interceptions"],
  player_pass_longest_completion: ["longPassing"],
  player_rush_yds: ["rushingYards"],
  player_rush_attempts: ["rushingAttempts"],
  player_rush_longest: ["longRushing"],
  player_rush_tds: ["rushingTouchdowns"],
  player_reception_yds: ["receivingYards"],
  player_receptions: ["receptions"],
  player_reception_longest: ["longReception"],
  player_reception_tds: ["receivingTouchdowns"],
  player_field_goals: ["fieldGoalsMade", "FG"],
  player_targets: ["receivingTargets", "TGTS", "targets"],
};

const MARKET_MADE: Record<string, string[]> = {
  player_threes: ["3PM", "3PT"],
};

function num(stats: Record<string, string>, label: string): number | null {
  const n = Number(stats[label]);
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

export function computeAmbiguous(labels: string[] | undefined | null): Set<string> {
  const counts = new Map<string, number>();
  for (const l of labels ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
  const set = new Set<string>();
  for (const [l, c] of counts) if (c > 1) set.add(l);
  return set;
}

/** Period-suffixed prop markets are unsimulatable until periodTag series exist. */
export function isPeriodPropMarketKey(market: string | null | undefined): boolean {
  return /_(q[1-4]|h[12]|p[123]|f5|i1)$/i.test(String(market ?? "").trim());
}

export function gameValueForMarket(
  market: string,
  stats: Record<string, string>,
  ambiguous: Set<string>,
): number | null {
  if (market.endsWith("_alternate")) {
    return gameValueForMarket(market.slice(0, -"_alternate".length), stats, ambiguous);
  }
  if (isPeriodPropMarketKey(market)) return null;

  if (market === "batter_total_bases") {
    const h = num(stats, "H");
    const d = num(stats, "2B");
    const t = num(stats, "3B");
    const hr = num(stats, "HR");
    if (h == null || d == null || t == null || hr == null) return null;
    return h + d + 2 * t + 3 * hr;
  }

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
  if (market === "player_anytime_td" || market === "player_first_td") {
    const pass = num(stats, "passingTouchdowns");
    const rush = num(stats, "rushingTouchdowns");
    const rec = num(stats, "receivingTouchdowns");
    if (rush == null && rec == null && pass == null) return null;
    return (pass ?? 0) + (rush ?? 0) + (rec ?? 0);
  }

  if (market === "player_double_double") {
    const cats = ["PTS", "REB", "AST", "STL", "BLK"];
    let doubles = 0;
    for (const lab of cats) {
      if (ambiguous.has(lab)) return null;
      const n = num(stats, lab);
      if (n == null) return null;
      if (n >= 10) doubles += 1;
    }
    return doubles >= 2 ? 1 : 0;
  }

  if (market === "pitcher_outs") {
    if (!ambiguous.has("OUTS")) {
      const outs = num(stats, "OUTS");
      if (outs != null) return outs;
    }
    if (!ambiguous.has("IP")) {
      const raw = stats["IP"];
      if (raw != null && String(raw).trim() !== "") {
        const m = String(raw).trim().match(/^(\d+)(?:\.(\d))?$/);
        if (m) {
          const inn = Number(m[1]);
          const frac = m[2] != null ? Number(m[2]) : 0;
          if (frac >= 0 && frac <= 2) return inn * 3 + frac;
        }
      }
    }
    return null;
  }

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

  if (market === "player_field_goals") {
    for (const lab of ["fieldGoalsMade", "FG"]) {
      if (ambiguous.has(lab)) continue;
      const made = madeCount(stats, lab);
      if (made != null) return made;
      const n = num(stats, lab);
      if (n != null) return n;
    }
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
