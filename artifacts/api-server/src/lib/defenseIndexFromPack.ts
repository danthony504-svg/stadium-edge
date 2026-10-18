/**
 * Stage 4 P0 — defenseIndexByFamily contracts + pure mappers (api-server twin).
 *
 * Builds optional mean multipliers (centered at 1.0) from verified
 * `/sports/team-defense` packs. Never invents DVOA, run-success, fronts, etc.
 * Thin/missing/ambiguous data → omit family (neutral).
 *
 * Shrink/clamp defaults mirror PRE_SIM_SHIFT_CAPS but are **configurable for
 * testing** — not an automatic approval for production seating (P2+).
 */

/**
 * Minimal pack shape (mirrors stadium-mobile DefenseIndexPackSlice fields
 * used by the mapper). Twin of artifacts/stadium-mobile/lib/defenseIndexFromPack.ts
 * — keep in sync for P2 seating enablement; P0/P1 shadow runs on mobile.
 */
export type DefenseIndexPackSlice = {
  rush?: {
    rushingYardsAllowedPerGame: number | null;
    yardsPerRushAllowed?: number | null;
    sampleSize: number;
    teamName?: string | null;
  } | null;
  pass?: {
    passingYardsAllowedPerGame: number | null;
    yardsPerPassAllowed?: number | null;
    sampleSize: number;
    teamName?: string | null;
  } | null;
  teamName?: string | null;
  pointsAgainst?: number | null;
  pointsFor?: number | null;
  sacks?: number | null;
  interceptions?: number | null;
  passesDefended?: number | null;
  stuffs?: number | null;
  gamesPlayed?: number | null;
  totalTakeaways?: number | null;
  sacksAllowed?: number | null;
  sackYardsLost?: number | null;
  interceptionPct?: number | null;
  intsThrown?: number | null;
  passingAttempts?: number | null;
  ownRushYpc?: number | null;
  steals?: number | null;
  blocks?: number | null;
  defRebounds?: number | null;
  oppTurnovers?: number | null;
  oppFgPct?: number | null;
  oppThreePct?: number | null;
  goalsAgainstAvg?: number | null;
  savePct?: number | null;
  shotsAgainst?: number | null;
  blockedShots?: number | null;
  takeaways?: number | null;
  goalsConceded?: number | null;
  cleanSheets?: number | null;
  tackles?: number | null;
  era?: number | null;
  whip?: number | null;
  battingAverageAgainst?: number | null;
};

/** Opportunity / pre-sim family ids (aligned with api-server marketFamily). */
export type DefenseIndexFamily =
  | "rush_yds"
  | "rush_attempts"
  | "rush_longest"
  | "pass_yds"
  | "pass_attempts"
  | "pass_completions"
  | "rec_yds"
  | "receptions"
  | "rec_longest"
  | "sacks"
  | "pass_interceptions"
  | "points"
  | "assists"
  | "rebounds"
  | "threes"
  | "goals"
  | "shots_on_goal"
  | "hits"
  | "total_bases"
  | "home_runs"
  | "strikeouts"
  | "shots"
  | "shots_on_target";

export type DefenseIndexByFamily = Partial<Record<DefenseIndexFamily, number>>;

export type DefenseIndexSkipReason =
  | "unsupported_sport"
  | "missing_stat"
  | "thin_sample"
  | "ambiguous_pack"
  | "stale_or_unverified"
  | "family_excluded";

export type DefenseIndexShrinkConfig = {
  /** Bayesian prior games toward 1.0 (default 8). */
  shrinkPriorGames: number;
  /** Clamp after shrink (defaults match PRE_SIM_SHIFT_CAPS). */
  matchupMin: number;
  matchupMax: number;
  /** Min box-score sample for rush/pass yards-allowed packs. */
  minBoxSample: number;
  /** Min gamesPlayed for season-rate fields. */
  minGamesPlayed: number;
  /**
   * League baselines for raw = allowed / baseline.
   * Configurable for tests — not an automatic production scoring approval.
   */
  baselines: DefenseIndexBaselines;
};

export type DefenseIndexBaselines = {
  nfl: {
    rushYdsAllowedPerGame: number;
    passYdsAllowedPerGame: number;
    sacksAllowedPerGame: number;
    pointsAgainst: number;
  };
  ncaaf: {
    rushYdsAllowedPerGame: number;
    passYdsAllowedPerGame: number;
    sacksAllowedPerGame: number;
    pointsAgainst: number;
  };
  nba: { pointsAgainst: number; steals: number; defRebounds: number; blocks: number };
  wnba: { pointsAgainst: number; steals: number; defRebounds: number; blocks: number };
  ncaab: { pointsAgainst: number; steals: number; defRebounds: number; blocks: number };
  nhl: { goalsAgainstAvg: number; savePct: number; shotsAgainst: number };
  mlb: { era: number; whip: number; battingAverageAgainst: number };
  soccer: { goalsConcededPerGame: number };
};

/** Test/default baselines — document as calibration priors, not locked prod truth. */
export const DEFAULT_DEFENSE_INDEX_BASELINES: DefenseIndexBaselines = {
  nfl: {
    rushYdsAllowedPerGame: 112,
    passYdsAllowedPerGame: 220,
    sacksAllowedPerGame: 2.4,
    pointsAgainst: 22.5,
  },
  ncaaf: {
    rushYdsAllowedPerGame: 150,
    passYdsAllowedPerGame: 230,
    sacksAllowedPerGame: 2.2,
    pointsAgainst: 26,
  },
  nba: { pointsAgainst: 112, steals: 7.5, defRebounds: 33, blocks: 5 },
  wnba: { pointsAgainst: 82, steals: 7, defRebounds: 28, blocks: 4 },
  ncaab: { pointsAgainst: 70, steals: 6.5, defRebounds: 25, blocks: 3.5 },
  nhl: { goalsAgainstAvg: 2.9, savePct: 0.905, shotsAgainst: 30 },
  mlb: { era: 4.1, whip: 1.28, battingAverageAgainst: 0.245 },
  soccer: { goalsConcededPerGame: 1.25 },
};

export const DEFAULT_DEFENSE_INDEX_SHRINK: DefenseIndexShrinkConfig = {
  shrinkPriorGames: 8,
  matchupMin: 0.9,
  matchupMax: 1.14,
  minBoxSample: 2,
  minGamesPlayed: 2,
  baselines: DEFAULT_DEFENSE_INDEX_BASELINES,
};

export type DefenseIndexBuildInput = {
  sport: string;
  opponentTeamId: string;
  /** Verified pack from GET /sports/team-defense (via Coach loader). */
  oppPack: DefenseIndexPackSlice | null | undefined;
  ownPack?: DefenseIndexPackSlice | null;
  /** Optional — reserved; positional splits not available → ignored. */
  playerPosition?: string | null;
  /** Optional pack freshness ms; if set and older than maxAgeMs → skip all. */
  fetchedAtMs?: number | null;
  maxAgeMs?: number;
  config?: Partial<DefenseIndexShrinkConfig>;
};

export type DefenseIndexFamilyExplain = {
  family: DefenseIndexFamily;
  index: number;
  raw: number;
  sampleSize: number;
  stat: string;
  baseline: number;
};

export type DefenseIndexBuildResult = {
  sport: string;
  opponentTeamId: string;
  defenseIndexByFamily: DefenseIndexByFamily;
  explain: DefenseIndexFamilyExplain[];
  skipped: Array<{ family: string; reason: DefenseIndexSkipReason; detail?: string }>;
  /** Config actually used (merged defaults). */
  config: DefenseIndexShrinkConfig;
};

const SUPPORTED = new Set([
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "ncaab",
  "nhl",
  "mlb",
  "soccer",
]);

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function shrinkRatioToOne(
  raw: number,
  sample: number,
  priorGames: number,
): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const n = Math.max(0, sample);
  const n0 = Math.max(0, priorGames);
  if (n + n0 <= 0) return 1;
  return (n * raw + n0 * 1) / (n + n0);
}

function mergeConfig(
  partial?: Partial<DefenseIndexShrinkConfig>,
): DefenseIndexShrinkConfig {
  const base = DEFAULT_DEFENSE_INDEX_SHRINK;
  return {
    shrinkPriorGames: partial?.shrinkPriorGames ?? base.shrinkPriorGames,
    matchupMin: partial?.matchupMin ?? base.matchupMin,
    matchupMax: partial?.matchupMax ?? base.matchupMax,
    minBoxSample: partial?.minBoxSample ?? base.minBoxSample,
    minGamesPlayed: partial?.minGamesPlayed ?? base.minGamesPlayed,
    baselines: {
      ...base.baselines,
      ...(partial?.baselines ?? {}),
      nfl: { ...base.baselines.nfl, ...(partial?.baselines?.nfl ?? {}) },
      ncaaf: { ...base.baselines.ncaaf, ...(partial?.baselines?.ncaaf ?? {}) },
      nba: { ...base.baselines.nba, ...(partial?.baselines?.nba ?? {}) },
      wnba: { ...base.baselines.wnba, ...(partial?.baselines?.wnba ?? {}) },
      ncaab: { ...base.baselines.ncaab, ...(partial?.baselines?.ncaab ?? {}) },
      nhl: { ...base.baselines.nhl, ...(partial?.baselines?.nhl ?? {}) },
      mlb: { ...base.baselines.mlb, ...(partial?.baselines?.mlb ?? {}) },
      soccer: { ...base.baselines.soccer, ...(partial?.baselines?.soccer ?? {}) },
    },
  };
}

function emitIndex(
  family: DefenseIndexFamily,
  raw: number,
  sampleSize: number,
  stat: string,
  baseline: number,
  cfg: DefenseIndexShrinkConfig,
  out: DefenseIndexBuildResult,
): void {
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(baseline) || baseline <= 0) {
    out.skipped.push({ family, reason: "missing_stat", detail: stat });
    return;
  }
  const shrunk = shrinkRatioToOne(raw, sampleSize, cfg.shrinkPriorGames);
  const index = clamp(shrunk, cfg.matchupMin, cfg.matchupMax);
  // Near-neutral after shrink — still record for lineage when movement tiny.
  out.defenseIndexByFamily[family] = Math.round(index * 10000) / 10000;
  out.explain.push({
    family,
    index: out.defenseIndexByFamily[family]!,
    raw: Math.round(raw * 10000) / 10000,
    sampleSize,
    stat,
    baseline,
  });
}

function perGame(
  total: number | null | undefined,
  gamesPlayed: number | null | undefined,
  minGp: number,
): number | null {
  if (total == null || !Number.isFinite(total)) return null;
  if (gamesPlayed == null || !Number.isFinite(gamesPlayed) || gamesPlayed < minGp) {
    return null;
  }
  return total / gamesPlayed;
}

/**
 * Map verified opp defense pack → defenseIndexByFamily.
 * Fail closed: unsupported sport / thin sample / missing stats → skip families.
 */
export function buildDefenseIndexByFamily(
  input: DefenseIndexBuildInput,
): DefenseIndexBuildResult {
  const sport = String(input.sport ?? "").toLowerCase().trim();
  const opponentTeamId = String(input.opponentTeamId ?? "").trim();
  const cfg = mergeConfig(input.config);
  const out: DefenseIndexBuildResult = {
    sport,
    opponentTeamId,
    defenseIndexByFamily: {},
    explain: [],
    skipped: [],
    config: cfg,
  };

  if (!SUPPORTED.has(sport)) {
    out.skipped.push({ family: "*", reason: "unsupported_sport" });
    return out;
  }
  if (!opponentTeamId) {
    out.skipped.push({ family: "*", reason: "ambiguous_pack", detail: "missing opponentTeamId" });
    return out;
  }
  if (input.maxAgeMs != null && input.fetchedAtMs != null) {
    const age = Date.now() - input.fetchedAtMs;
    if (!Number.isFinite(age) || age < 0 || age > input.maxAgeMs) {
      out.skipped.push({ family: "*", reason: "stale_or_unverified", detail: `ageMs=${age}` });
      return out;
    }
  }

  const pack = input.oppPack;
  if (!pack || typeof pack !== "object") {
    out.skipped.push({ family: "*", reason: "ambiguous_pack", detail: "null pack" });
    return out;
  }

  // Positional splits are unavailable — explicitly ignore playerPosition.
  void input.playerPosition;

  if (sport === "nfl" || sport === "ncaaf") {
    buildFootball(out, pack, input.ownPack ?? null, cfg, sport);
    return out;
  }
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    buildBasketball(out, pack, cfg, sport);
    return out;
  }
  if (sport === "nhl") {
    buildNhl(out, pack, cfg);
    return out;
  }
  if (sport === "mlb") {
    buildMlb(out, pack, cfg);
    return out;
  }
  if (sport === "soccer") {
    buildSoccer(out, pack, cfg);
    return out;
  }
  out.skipped.push({ family: "*", reason: "unsupported_sport" });
  return out;
}

function buildFootball(
  out: DefenseIndexBuildResult,
  pack: DefenseIndexPackSlice,
  own: DefenseIndexPackSlice | null,
  cfg: DefenseIndexShrinkConfig,
  sport: "nfl" | "ncaaf",
): void {
  const bl = cfg.baselines[sport];
  const rush = pack.rush;
  if (rush && rush.sampleSize >= cfg.minBoxSample && rush.rushingYardsAllowedPerGame != null) {
    const raw = rush.rushingYardsAllowedPerGame / bl.rushYdsAllowedPerGame;
    emitIndex(
      "rush_yds",
      raw,
      rush.sampleSize,
      `rushYdsAllowed/g=${rush.rushingYardsAllowedPerGame}`,
      bl.rushYdsAllowedPerGame,
      cfg,
      out,
    );
    // Volume family shares the same verified rush-allowed signal (weaker copy).
    emitIndex(
      "rush_attempts",
      raw,
      rush.sampleSize,
      `rushYdsAllowed/g=${rush.rushingYardsAllowedPerGame}`,
      bl.rushYdsAllowedPerGame,
      cfg,
      out,
    );
  } else {
    out.skipped.push({
      family: "rush_yds",
      reason: rush ? "thin_sample" : "missing_stat",
      detail: rush ? `sampleSize=${rush.sampleSize}` : "no rushDefense",
    });
  }

  const pass = pack.pass;
  if (pass && pass.sampleSize >= cfg.minBoxSample && pass.passingYardsAllowedPerGame != null) {
    const raw = pass.passingYardsAllowedPerGame / bl.passYdsAllowedPerGame;
    emitIndex(
      "pass_yds",
      raw,
      pass.sampleSize,
      `passYdsAllowed/g=${pass.passingYardsAllowedPerGame}`,
      bl.passYdsAllowedPerGame,
      cfg,
      out,
    );
    emitIndex(
      "pass_attempts",
      raw,
      pass.sampleSize,
      `passYdsAllowed/g=${pass.passingYardsAllowedPerGame}`,
      bl.passYdsAllowedPerGame,
      cfg,
      out,
    );
    emitIndex(
      "pass_completions",
      raw,
      pass.sampleSize,
      `passYdsAllowed/g=${pass.passingYardsAllowedPerGame}`,
      bl.passYdsAllowedPerGame,
      cfg,
      out,
    );
    // Receiving production faces the same pass D (proxy — not inventing WR-specific D).
    emitIndex(
      "rec_yds",
      raw,
      pass.sampleSize,
      `passYdsAllowed/g=${pass.passingYardsAllowedPerGame} (recv proxy)`,
      bl.passYdsAllowedPerGame,
      cfg,
      out,
    );
    emitIndex(
      "receptions",
      raw,
      pass.sampleSize,
      `passYdsAllowed/g=${pass.passingYardsAllowedPerGame} (recv proxy)`,
      bl.passYdsAllowedPerGame,
      cfg,
      out,
    );
  } else {
    out.skipped.push({
      family: "pass_yds",
      reason: pass ? "thin_sample" : "missing_stat",
      detail: pass ? `sampleSize=${pass.sampleSize}` : "no passDefense",
    });
  }

  // Sacks: offense being rushed → sacksAllowed on pack (opponent OL).
  const oline = perGame(pack.sacksAllowed, pack.gamesPlayed, cfg.minGamesPlayed);
  if (oline != null) {
    const raw = oline / bl.sacksAllowedPerGame;
    emitIndex(
      "sacks",
      raw,
      pack.gamesPlayed ?? cfg.minGamesPlayed,
      `OL sacksAllowed/g=${oline.toFixed(2)}`,
      bl.sacksAllowedPerGame,
      cfg,
      out,
    );
  } else {
    out.skipped.push({ family: "sacks", reason: "missing_stat", detail: "sacksAllowed" });
  }

  // anytime_td / first_td intentionally excluded (sparse binary) — not invented.
  out.skipped.push({
    family: "anytime_td",
    reason: "family_excluded",
    detail: "binary TD markets excluded from team-D index in P0",
  });

  void own; // ownPack reserved for P2+ coupling; unused in P0 mean index
}

function buildBasketball(
  out: DefenseIndexBuildResult,
  pack: DefenseIndexPackSlice,
  cfg: DefenseIndexShrinkConfig,
  sport: "nba" | "wnba" | "ncaab",
): void {
  const bl = cfg.baselines[sport];
  const gp = pack.gamesPlayed ?? cfg.minGamesPlayed;
  if (pack.pointsAgainst != null && Number.isFinite(pack.pointsAgainst)) {
    const raw = pack.pointsAgainst / bl.pointsAgainst;
    emitIndex("points", raw, gp, `ptsAllowed/g=${pack.pointsAgainst}`, bl.pointsAgainst, cfg, out);
    emitIndex("threes", raw, gp, `ptsAllowed/g=${pack.pointsAgainst} (3pt proxy)`, bl.pointsAgainst, cfg, out);
  } else {
    out.skipped.push({ family: "points", reason: "missing_stat" });
  }
  if (pack.steals != null && Number.isFinite(pack.steals)) {
    // High steals → harder for assists Overs → index < 1 when steals high.
    // raw = baseline/steals so elite steal teams suppress assist mean.
    const raw = bl.steals / Math.max(pack.steals, 0.1);
    emitIndex("assists", raw, gp, `stl/g=${pack.steals}`, bl.steals, cfg, out);
  } else {
    out.skipped.push({ family: "assists", reason: "missing_stat" });
  }
  if (pack.defRebounds != null && Number.isFinite(pack.defRebounds)) {
    const raw = bl.defRebounds / Math.max(pack.defRebounds, 0.1);
    emitIndex("rebounds", raw, gp, `dreb/g=${pack.defRebounds}`, bl.defRebounds, cfg, out);
  } else {
    out.skipped.push({ family: "rebounds", reason: "missing_stat" });
  }
  void bl.blocks;
}

function buildNhl(
  out: DefenseIndexBuildResult,
  pack: DefenseIndexPackSlice,
  cfg: DefenseIndexShrinkConfig,
): void {
  const bl = cfg.baselines.nhl;
  const gp = pack.gamesPlayed ?? cfg.minGamesPlayed;
  let sv = pack.savePct;
  if (sv != null && sv > 1) sv = sv / 100;
  if (pack.goalsAgainstAvg != null && Number.isFinite(pack.goalsAgainstAvg)) {
    const raw = pack.goalsAgainstAvg / bl.goalsAgainstAvg;
    emitIndex("goals", raw, gp, `GAA=${pack.goalsAgainstAvg}`, bl.goalsAgainstAvg, cfg, out);
  } else if (sv != null && Number.isFinite(sv)) {
    const raw = (1 - sv) / Math.max(1 - bl.savePct, 1e-6);
    emitIndex("goals", raw, gp, `SV%=${sv}`, bl.savePct, cfg, out);
  } else {
    out.skipped.push({ family: "goals", reason: "missing_stat" });
  }
  if (pack.shotsAgainst != null && Number.isFinite(pack.shotsAgainst)) {
    const raw = pack.shotsAgainst / bl.shotsAgainst;
    emitIndex(
      "shots_on_goal",
      raw,
      gp,
      `SA=${pack.shotsAgainst}`,
      bl.shotsAgainst,
      cfg,
      out,
    );
  } else {
    out.skipped.push({ family: "shots_on_goal", reason: "missing_stat" });
  }
}

function buildMlb(
  out: DefenseIndexBuildResult,
  pack: DefenseIndexPackSlice,
  cfg: DefenseIndexShrinkConfig,
): void {
  // Coarse team pitching only — lineage flags proxy; prefer pitcher tendency in live sim.
  const bl = cfg.baselines.mlb;
  const gp = pack.gamesPlayed ?? cfg.minGamesPlayed;
  if (pack.era != null && Number.isFinite(pack.era)) {
    const raw = pack.era / bl.era;
    emitIndex("hits", raw, gp, `ERA=${pack.era} (team proxy)`, bl.era, cfg, out);
    emitIndex("total_bases", raw, gp, `ERA=${pack.era} (team proxy)`, bl.era, cfg, out);
    emitIndex("home_runs", raw, gp, `ERA=${pack.era} (team proxy)`, bl.era, cfg, out);
    // Stingy staffs → more K overs: invert for strikeouts.
    emitIndex(
      "strikeouts",
      bl.era / Math.max(pack.era, 0.5),
      gp,
      `ERA=${pack.era} (K invert proxy)`,
      bl.era,
      cfg,
      out,
    );
  } else {
    out.skipped.push({
      family: "hits",
      reason: "missing_stat",
      detail: "team ERA; prefer opposing pitcher tendency when present",
    });
  }
  void bl.whip;
  void bl.battingAverageAgainst;
}

function buildSoccer(
  out: DefenseIndexBuildResult,
  pack: DefenseIndexPackSlice,
  cfg: DefenseIndexShrinkConfig,
): void {
  const bl = cfg.baselines.soccer;
  const gp = pack.gamesPlayed ?? cfg.minGamesPlayed;
  // goalsConceded on feed may be season total — normalize when gp present.
  let concededPg: number | null = null;
  if (pack.goalsConceded != null && Number.isFinite(pack.goalsConceded)) {
    if (pack.gamesPlayed != null && pack.gamesPlayed >= cfg.minGamesPlayed) {
      concededPg = pack.goalsConceded / pack.gamesPlayed;
    } else if (pack.goalsConceded < 8) {
      // Likely already a rate / small sample — treat cautiously as thin if gp missing
      out.skipped.push({
        family: "goals",
        reason: "thin_sample",
        detail: "goalsConceded without gamesPlayed",
      });
      return;
    } else {
      out.skipped.push({ family: "goals", reason: "thin_sample", detail: "cannot normalize" });
      return;
    }
  }
  if (concededPg != null) {
    const raw = concededPg / bl.goalsConcededPerGame;
    emitIndex("goals", raw, gp, `goalsConceded/g=${concededPg.toFixed(2)}`, bl.goalsConcededPerGame, cfg, out);
    emitIndex("shots", raw, gp, `goalsConceded/g proxy`, bl.goalsConcededPerGame, cfg, out);
    emitIndex(
      "shots_on_target",
      raw,
      gp,
      `goalsConceded/g proxy`,
      bl.goalsConcededPerGame,
      cfg,
      out,
    );
  } else if (!out.skipped.some((s) => s.family === "goals")) {
    out.skipped.push({ family: "goals", reason: "missing_stat" });
  }
}

/** Resolve family for a provider market key (local, no server import). */
export function defenseIndexFamilyForMarket(
  market: string | null | undefined,
): DefenseIndexFamily | null {
  const key = String(market ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_alternate$/, "")
    .replace(/_alt$/, "");
  const map: Record<string, DefenseIndexFamily> = {
    player_rush_yds: "rush_yds",
    rush_yds: "rush_yds",
    player_rush_attempts: "rush_attempts",
    rush_attempts: "rush_attempts",
    player_rush_longest: "rush_longest",
    player_pass_yds: "pass_yds",
    pass_yds: "pass_yds",
    player_pass_attempts: "pass_attempts",
    player_pass_completions: "pass_completions",
    player_reception_yds: "rec_yds",
    player_receptions: "receptions",
    player_reception_longest: "rec_longest",
    player_sacks: "sacks",
    player_pass_interceptions: "pass_interceptions",
    player_points: "points",
    player_assists: "assists",
    player_rebounds: "rebounds",
    player_threes: "threes",
    player_goals: "goals",
    player_shots_on_goal: "shots_on_goal",
    batter_hits: "hits",
    batter_total_bases: "total_bases",
    batter_home_runs: "home_runs",
    pitcher_strikeouts: "strikeouts",
    player_shots: "shots",
    player_shots_on_target: "shots_on_target",
  };
  return map[key] ?? null;
}

export function indexForMarket(
  byFamily: DefenseIndexByFamily,
  market: string | null | undefined,
): number | null {
  const fam = defenseIndexFamilyForMarket(market);
  if (!fam) return null;
  const v = byFamily[fam];
  return v != null && Number.isFinite(v) ? v : null;
}
