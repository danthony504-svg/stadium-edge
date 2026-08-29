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
  player_points: ["PTS"],
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
  pitcher_strikeouts: ["K", "SO"],
  player_goals: ["G"],
  player_shots_on_goal: ["S", "SOG", "SHOTS"],
  player_goal_scorer_anytime: ["G"],
  player_shots: ["SH"],
  player_shots_on_target: ["SOT"],
  player_pass_yds: ["YDS"],
  player_pass_tds: ["TD"],
  player_anytime_td: ["TD"],
  player_rush_yds: ["YDS"],
  player_reception_yds: ["YDS"],
  player_receptions: ["REC"],
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

/** Markets whose outcomes are low-count integers (Poisson-friendly). */
export function isDiscreteCountMarket(market: string): boolean {
  return /threes|blocks|steals|home_runs|stolen_bases|sacks|pass_tds|anytime_td|goal_scorer|receptions/i.test(
    market,
  );
}
