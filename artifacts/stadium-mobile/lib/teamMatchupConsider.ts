/**
 * Team Props matchup analysis helpers — both-team context + "Players to Consider".
 *
 * Pure evaluation over REAL posted player props for one odds event. Uses the
 * same recommendSide / gradePropCands / fetchPropSimulations paths as Props UI,
 * but never touches Coach board assembly. Fail closed: no fabricated lines,
 * odds, players, probabilities, or recommendations.
 */

import {
  EXACT_MARKET_10K_MIN_SIMULATIONS,
} from "./coachPropProbabilityProvenance.ts";
import type {
  PlayerProp,
  PropPoolEntry,
  PropSimulationResult,
  TeamDefense,
  TeamHistory,
} from "./api.ts";
import { propBelongsToGameTeams } from "./propGameTeamGate.ts";
import {
  GRADE_MIN_SAMPLE,
  GRADE_WINDOW,
  gradeFromHitPct,
  recommendSide,
  type Grade,
  type GradeResult,
} from "./propGrade.ts";
import { propMarketLabel } from "./propMarketLabel.ts";

/** Deep Monte Carlo floor — same as Coach exact-market seating bar. */
export const MATCHUP_CONSIDER_MIN_SIMULATIONS = EXACT_MARKET_10K_MIN_SIMULATIONS;

/** Need enough real games in the sim sample to trust a hit rate. */
export const MATCHUP_CONSIDER_MIN_SAMPLE_GAMES = GRADE_MIN_SAMPLE;

/** Cap candidates sent to deep sim (independent of Coach; keeps sheet snappy). */
export const MATCHUP_CONSIDER_MAX_CANDIDATES = 16;

export type MatchupTeamSide = "home" | "away";

export type MatchupTeamIds = {
  homeTeamId: string | null;
  awayTeamId: string | null;
};

/** Sport-relevant player-prop markets for matchup analysis (posted keys only). */
export function relevantPlayerMarketsForSport(sport: string): readonly string[] {
  const s = String(sport ?? "").toLowerCase();
  if (s === "nba" || s === "wnba" || s === "ncaab" || s === "cbb") {
    return [
      "player_points",
      "player_rebounds",
      "player_assists",
      "player_blocks",
      "player_threes",
      "player_steals",
      "player_points_rebounds_assists",
      "player_points_rebounds",
      "player_points_assists",
    ] as const;
  }
  if (s === "nfl" || s === "ncaaf" || s === "cfb") {
    return [
      "player_pass_yds",
      "player_pass_tds",
      "player_pass_completions",
      "player_pass_attempts",
      "player_rush_yds",
      "player_rush_tds",
      "player_rush_attempts",
      "player_reception_yds",
      "player_receptions",
      "player_reception_tds",
      "player_anytime_td",
      "player_pass_rush_yds",
      "player_rush_reception_yds",
    ] as const;
  }
  if (s === "mlb") {
    return [
      "batter_hits",
      "batter_total_bases",
      "batter_rbis",
      "batter_runs_scored",
      "batter_home_runs",
      "batter_stolen_bases",
      "pitcher_strikeouts",
      "pitcher_outs",
      "pitcher_earned_runs",
    ] as const;
  }
  if (s === "nhl") {
    return [
      "player_points",
      "player_goals",
      "player_assists",
      "player_shots_on_goal",
      "player_blocked_shots",
      "player_power_play_points",
    ] as const;
  }
  if (s === "soccer") {
    return [
      "player_goal_scorer_anytime",
      "player_shots",
      "player_shots_on_target",
      "player_assists",
    ] as const;
  }
  return [] as const;
}

export function isRelevantPlayerMarket(sport: string, market: string): boolean {
  const keys = relevantPlayerMarketsForSport(sport);
  if (!keys.length) return true; // unknown sport — don't invent a filter
  const m = String(market ?? "").toLowerCase();
  return keys.some((k) => m === k || m.startsWith(`${k}_`));
}

/**
 * Team-wide defensive fields we may surface. Never claim these are
 * position-specific — the ESPN team-defense pack is team-level only.
 */
export type TeamDefenseStatRow = {
  key: string;
  label: string;
  value: string;
  /** Always team-wide for this feed. */
  scope: "team";
  sampleSize: number | null;
  source: string;
  timeframe: string;
};

export function teamDefenseRows(
  sport: string,
  def: TeamDefense | null | undefined,
): TeamDefenseStatRow[] {
  if (!def) return [];
  const rows: TeamDefenseStatRow[] = [];
  const seasonTf = "season · team-wide";
  const src = "ESPN team-defense";

  if (def.avgPointsAgainst != null) {
    rows.push({
      key: "pts_allowed",
      label: "Points allowed / game",
      value: def.avgPointsAgainst.toFixed(1),
      scope: "team",
      sampleSize: null,
      source: src,
      timeframe: seasonTf,
    });
  }
  if (def.avgPointsFor != null) {
    rows.push({
      key: "pts_for",
      label: "Points scored / game",
      value: def.avgPointsFor.toFixed(1),
      scope: "team",
      sampleSize: null,
      source: src,
      timeframe: seasonTf,
    });
  }

  const s = String(sport ?? "").toLowerCase();
  if (s === "nfl" || s === "ncaaf" || s === "cfb") {
    if (def.rushDefense && def.rushDefense.sampleSize > 0) {
      const v = def.rushDefense.rushingYardsAllowedPerGame;
      rows.push({
        key: "rush_yds_allowed",
        label: "Rush yards allowed / game",
        value: v != null ? v.toFixed(1) : "—",
        scope: "team",
        sampleSize: def.rushDefense.sampleSize,
        source: src,
        timeframe: `last ${def.rushDefense.sampleSize} box scores · team-wide`,
      });
    }
    if (def.passDefense && def.passDefense.sampleSize > 0) {
      const v = def.passDefense.passingYardsAllowedPerGame;
      rows.push({
        key: "pass_yds_allowed",
        label: "Pass yards allowed / game",
        value: v != null ? v.toFixed(1) : "—",
        scope: "team",
        sampleSize: def.passDefense.sampleSize,
        source: src,
        timeframe: `last ${def.passDefense.sampleSize} box scores · team-wide`,
      });
    }
  }

  // Surface a few verified defensive map averages when present (basketball etc.).
  // Never invent keys — only echo what the feed returned.
  const prefer = [
    "oppFgPct",
    "opp3PointPct",
    "defensiveRebounds",
    "steals",
    "blocks",
    "avgPoints",
  ];
  for (const k of prefer) {
    const cell = def.defensive?.[k];
    if (!cell) continue;
    const display =
      cell.displayValue?.trim() ||
      (cell.value != null && Number.isFinite(cell.value) ? String(cell.value) : "");
    if (!display) continue;
    rows.push({
      key: `def_${k}`,
      label: humanizeDefenseKey(k),
      value: display,
      scope: "team",
      sampleSize: null,
      source: src,
      timeframe: seasonTf,
    });
  }

  return rows;
}

function humanizeDefenseKey(k: string): string {
  return k
    .replace(/([A-Z])/g, " $1")
    .replace(/^opp\s*/i, "Opp ")
    .replace(/\bFg\b/g, "FG")
    .replace(/\bPct\b/g, "%")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export type TeamFormSummary = {
  teamName: string;
  record: string | null;
  recordGames: number | null;
  last10: string | null;
  last10Games: number | null;
  streak: string | null;
  ptsFor: number | null;
  ptsAgainst: number | null;
  avgMargin: number | null;
  homeSplit: string | null;
  homeGames: number | null;
  awaySplit: string | null;
  awayGames: number | null;
  source: string;
  timeframe: string;
};

export function summarizeTeamForm(
  teamName: string,
  history: TeamHistory | null | undefined,
): TeamFormSummary {
  const rec = (w: number, l: number, g: number) => (g > 0 ? `${w}-${l}` : null);
  return {
    teamName,
    record:
      history?.record.games
        ? rec(history.record.wins, history.record.losses, history.record.games)
        : null,
    recordGames: history?.record.games ?? null,
    last10: history?.last10.games
      ? rec(history.last10.wins, history.last10.losses, history.last10.games)
      : null,
    last10Games: history?.last10.games ?? null,
    streak: history?.streak ? `${history.streak.type}${history.streak.count}` : null,
    ptsFor: history?.last10.ptsFor ?? null,
    ptsAgainst: history?.last10.ptsAgainst ?? null,
    avgMargin: history?.last10.avgMargin ?? null,
    homeSplit: history?.homeSplit.games
      ? rec(history.homeSplit.wins, history.homeSplit.losses, history.homeSplit.games)
      : null,
    homeGames: history?.homeSplit.games ?? null,
    awaySplit: history?.awaySplit.games
      ? rec(history.awaySplit.wins, history.awaySplit.losses, history.awaySplit.games)
      : null,
    awayGames: history?.awaySplit.games ?? null,
    source: "ESPN team-history",
    timeframe: history?.season
      ? `prior season fallback (${history.season}) · finals only`
      : `last ${GRADE_WINDOW} finals (when available)`,
  };
}

export type ConsiderCandidate = {
  key: string;
  prop: PlayerProp;
  side: "Over" | "Under";
  price: number;
  teamSide: MatchupTeamSide;
  teamName: string;
  oppName: string;
};

/**
 * Build scored candidates from posted mains for THIS event only.
 * Unbound / alt-only / irrelevant / unpriced rows are dropped (fail closed).
 */
export function buildConsiderCandidates(opts: {
  props: PlayerProp[];
  sport: string;
  homeTeam: string;
  awayTeam: string;
  ids: MatchupTeamIds;
  maxPerTeam?: number;
}): { candidates: ConsiderCandidate[]; skipReason: string | null } {
  const maxPer = opts.maxPerTeam ?? MATCHUP_CONSIDER_MAX_CANDIDATES / 2;
  const homeId = opts.ids.homeTeamId;
  const awayId = opts.ids.awayTeamId;
  if (!homeId && !awayId) {
    return {
      candidates: [],
      skipReason:
        "Team ids for this matchup are unavailable, so player props cannot be bound safely.",
    };
  }

  const home: ConsiderCandidate[] = [];
  const away: ConsiderCandidate[] = [];

  for (const p of opts.props) {
    if (p.alt) continue;
    if (p.line == null || !Number.isFinite(p.line)) continue;
    if (!isRelevantPlayerMarket(opts.sport, p.market)) continue;
    if (!propBelongsToGameTeams(p.playerTeamId, homeId, awayId)) continue;
    const sel = recommendSide(p);
    if (!sel) continue;

    const onHome = String(p.playerTeamId).trim() === String(homeId).trim();
    const teamSide: MatchupTeamSide = onHome ? "home" : "away";
    const row: ConsiderCandidate = {
      key: `${p.player}|${p.market}|${p.line}|${sel.side}|${teamSide}`.toLowerCase(),
      prop: p,
      side: sel.side,
      price: sel.price,
      teamSide,
      teamName: onHome ? opts.homeTeam : opts.awayTeam,
      oppName: onHome ? opts.awayTeam : opts.homeTeam,
    };
    if (teamSide === "home") home.push(row);
    else away.push(row);
  }

  // Prefer diverse markets; stable player order from feed.
  const take = (rows: ConsiderCandidate[]) => {
    const seenPlayer = new Set<string>();
    const out: ConsiderCandidate[] = [];
    for (const r of rows) {
      if (out.length >= maxPer) break;
      const pk = r.prop.player.toLowerCase();
      // Allow a second market for the same player only after first pass fills.
      if (seenPlayer.has(pk) && out.length < maxPer) {
        // skip duplicates in first pass
        continue;
      }
      seenPlayer.add(pk);
      out.push(r);
    }
    // Second pass: additional markets if room.
    if (out.length < maxPer) {
      for (const r of rows) {
        if (out.length >= maxPer) break;
        if (out.some((x) => x.key === r.key)) continue;
        out.push(r);
      }
    }
    return out;
  };

  const candidates = [...take(away), ...take(home)];
  if (!candidates.length) {
    const anyBound = opts.props.some((p) =>
      propBelongsToGameTeams(p.playerTeamId, homeId, awayId),
    );
    return {
      candidates: [],
      skipReason: anyBound
        ? "No relevant posted player-prop mains with a real price are available for this matchup."
        : "No posted player props could be bound to either team for this event.",
    };
  }
  return { candidates, skipReason: null };
}

export type ConsiderQualification =
  | { status: "qualified"; reason: null }
  | { status: "rejected"; reason: string };

/** Qualify a deep-sim result against quality floors — never invent a pass. */
export function qualifyConsiderSim(
  sim: PropSimulationResult | null | undefined,
): ConsiderQualification {
  if (!sim) {
    return { status: "rejected", reason: "Simulation evidence unavailable." };
  }
  if (sim.nullReason) {
    return {
      status: "rejected",
      reason: `Simulation unavailable (${sim.nullReason.replace(/_/g, " ")}).`,
    };
  }
  if (sim.hitProbability == null || !Number.isFinite(sim.hitProbability)) {
    return { status: "rejected", reason: "Simulation returned no hit probability." };
  }
  if ((sim.simulations ?? 0) < MATCHUP_CONSIDER_MIN_SIMULATIONS) {
    return {
      status: "rejected",
      reason: `Needs ${MATCHUP_CONSIDER_MIN_SIMULATIONS.toLocaleString()} simulations (got ${sim.simulations ?? 0}).`,
    };
  }
  if ((sim.sampleGames ?? 0) < MATCHUP_CONSIDER_MIN_SAMPLE_GAMES) {
    return {
      status: "rejected",
      reason: `Insufficient game-log sample (n=${sim.sampleGames ?? 0}; need ${MATCHUP_CONSIDER_MIN_SAMPLE_GAMES}).`,
    };
  }
  return { status: "qualified", reason: null };
}

export type ConsiderPick = {
  key: string;
  player: string;
  athleteId: string | null;
  headshot: string | null;
  teamSide: MatchupTeamSide;
  teamName: string;
  oppName: string;
  marketKey: string;
  marketLabel: string;
  side: "Over" | "Under";
  line: number;
  price: number;
  sportsbook: string | null;
  altCount: number;
  grade: Grade | null;
  gradeHits: number | null;
  gradeN: number | null;
  simHitPct: number;
  simulations: number;
  sampleGames: number;
  meanProjection: number | null;
  explanation: string;
  prop: PlayerProp;
};

export function buildConsiderPick(opts: {
  cand: ConsiderCandidate;
  sim: PropSimulationResult;
  grade: GradeResult | null;
  altCount: number;
  usageNote?: string | null;
  defenseNote?: string | null;
}): ConsiderPick | null {
  const q = qualifyConsiderSim(opts.sim);
  if (q.status !== "qualified") return null;
  const p = opts.cand.prop;
  const hitPct = Math.round((opts.sim.hitProbability as number) * 1000) / 10;
  const parts: string[] = [];
  if (opts.grade) {
    parts.push(
      `Recent form ${opts.grade.hits}/${opts.grade.n} vs this line (${GRADE_WINDOW}-game window).`,
    );
  } else {
    parts.push(
      `Recent hit-rate grade unavailable (need ≥${GRADE_MIN_SAMPLE} logged games).`,
    );
  }
  parts.push(
    `${MATCHUP_CONSIDER_MIN_SIMULATIONS.toLocaleString()}-sim hit ${hitPct}% · sample n=${opts.sim.sampleGames}.`,
  );
  if (opts.sim.meanProjection != null) {
    parts.push(`Mean projection ${opts.sim.meanProjection.toFixed(1)}.`);
  }
  if (opts.usageNote) parts.push(opts.usageNote);
  if (opts.defenseNote) parts.push(opts.defenseNote);
  parts.push("Team-wide opponent rates only — not position-specific.");

  const book =
    opts.cand.side === "Over" ? p.overBook ?? null : p.underBook ?? null;

  return {
    key: opts.cand.key,
    player: p.player,
    athleteId: p.athleteId ?? null,
    headshot: p.headshot ?? null,
    teamSide: opts.cand.teamSide,
    teamName: opts.cand.teamName,
    oppName: opts.cand.oppName,
    marketKey: p.market,
    marketLabel: propMarketLabel(p.market),
    side: opts.cand.side,
    line: p.line as number,
    price: opts.cand.price,
    sportsbook: book,
    altCount: opts.altCount,
    grade: opts.grade?.grade ?? null,
    gradeHits: opts.grade?.hits ?? null,
    gradeN: opts.grade?.n ?? null,
    simHitPct: hitPct,
    simulations: opts.sim.simulations,
    sampleGames: opts.sim.sampleGames,
    meanProjection: opts.sim.meanProjection,
    explanation: parts.join(" "),
    prop: p,
  };
}

/** Count alt rungs for the same player+market on this event (posted only). */
export function countPostedAlts(
  all: PlayerProp[],
  player: string,
  market: string,
): number {
  return all.filter(
    (p) => p.alt && p.player === player && p.market === market && p.line != null,
  ).length;
}

/** Map consider candidates → PropPoolEntry rows for fetchPropSimulations. */
export function candidatesToPropPool(
  cands: ConsiderCandidate[],
  sport: string,
  gameLabel: string,
  startsAt: string,
): PropPoolEntry[] {
  const out: PropPoolEntry[] = [];
  for (const c of cands) {
    const p = c.prop;
    if (p.line == null) continue;
    out.push({
      sport,
      game: gameLabel,
      marketLabel: propMarketLabel(p.market),
      player: p.player,
      line: p.line,
      side: c.side,
      odds: c.price,
      startsAt,
      headshot: p.headshot,
      athleteId: p.athleteId,
      playerTeamId: p.playerTeamId,
      marketKey: p.market,
      alt: !!p.alt,
      eventId: p.eventId ?? p.oddsEventId ?? null,
      sportsbook: c.side === "Over" ? p.overBook ?? null : p.underBook ?? null,
    });
  }
  return out;
}

/** Picks for fetchPropSimulations (isProp shape). */
export function candidatesToSimPicks(
  cands: ConsiderCandidate[],
  sport: string,
  gameLabel: string,
) {
  return cands.map((c) => ({
    isProp: true as const,
    player: c.prop.player,
    propLine: c.prop.line,
    propSide: c.side,
    propMarketKey: c.prop.market,
    athleteId: c.prop.athleteId,
    eventId: c.prop.eventId ?? c.prop.oddsEventId ?? null,
    game: gameLabel,
    sport,
  }));
}

export function simLookupKey(
  player: string,
  market: string,
  line: number,
  side: "Over" | "Under",
): string {
  return `${player}|${market}|${line}|${side}`.toLowerCase();
}

export function emptyConsiderMessage(opts: {
  propsLoaded: boolean;
  propsError: boolean;
  candidateCount: number;
  qualifiedCount: number;
  skipReason: string | null;
}): string {
  if (opts.propsError) {
    return "Player-prop feed unavailable for this matchup right now — no recommendations invented.";
  }
  if (!opts.propsLoaded) {
    return "Loading posted player props for this matchup…";
  }
  if (opts.skipReason) return opts.skipReason;
  if (opts.candidateCount === 0) {
    return "No posted player props are available to evaluate for this matchup.";
  }
  if (opts.qualifiedCount === 0) {
    return `Reviewed ${opts.candidateCount} posted prop${opts.candidateCount === 1 ? "" : "s"}; none cleared the ${MATCHUP_CONSIDER_MIN_SIMULATIONS.toLocaleString()}-simulation quality floor with sufficient sample. Nothing recommended.`;
  }
  return "";
}

/** Re-export grade helper for tests. */
export { gradeFromHitPct, recommendSide };
