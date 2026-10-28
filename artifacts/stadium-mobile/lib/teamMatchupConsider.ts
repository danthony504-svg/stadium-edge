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
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  meetsCoachSimQualityFloor,
} from "./gameSimQualityGates.ts";
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
import { simulatorModelEdge } from "./simulatorPropMetrics.ts";

/** Deep Monte Carlo floor — same as Coach exact-market seating bar. */
export const MATCHUP_CONSIDER_MIN_SIMULATIONS = EXACT_MARKET_10K_MIN_SIMULATIONS;

/** Need enough real games in the sim sample to trust a hit rate. */
export const MATCHUP_CONSIDER_MIN_SAMPLE_GAMES = GRADE_MIN_SAMPLE;

/** Shared confidence floor — sim hit % must clear this (same as Coach). */
export const MATCHUP_CONSIDER_MIN_HIT_PCT = COACH_SIM_MIN_CONFIDENCE;

/** Shared grade floor — missing grades never qualify. */
export const MATCHUP_CONSIDER_MIN_GRADE = COACH_SIM_MIN_GRADE;

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

/** Soft role from posted market family — never claimed as verified roster position. */
export type MatchupRole = {
  key: string;
  label: string;
  /** Markets that belong to this role filter chip. */
  markets: readonly string[];
};

/** Sport-specific role chips for Matchup Props filters + grouping. */
export function matchupRolesForSport(sport: string): readonly MatchupRole[] {
  const s = String(sport ?? "").toLowerCase();
  if (s === "nfl" || s === "ncaaf" || s === "cfb") {
    return [
      {
        key: "qb",
        label: "QB",
        markets: [
          "player_pass_yds",
          "player_pass_tds",
          "player_pass_completions",
          "player_pass_attempts",
          "player_pass_rush_yds",
        ],
      },
      {
        key: "rb",
        label: "RB",
        markets: ["player_rush_yds", "player_rush_tds", "player_rush_attempts", "player_rush_reception_yds"],
      },
      {
        key: "wr_te",
        label: "WR/TE",
        markets: ["player_reception_yds", "player_receptions", "player_reception_tds"],
      },
      { key: "td", label: "Anytime TD", markets: ["player_anytime_td"] },
    ] as const;
  }
  if (s === "nba" || s === "wnba" || s === "ncaab" || s === "cbb") {
    return [
      { key: "pts", label: "Points", markets: ["player_points", "player_points_rebounds_assists", "player_points_rebounds", "player_points_assists"] },
      { key: "reb", label: "Rebounds", markets: ["player_rebounds"] },
      { key: "ast", label: "Assists", markets: ["player_assists"] },
      { key: "threes", label: "Threes", markets: ["player_threes"] },
      { key: "stocks", label: "Stocks", markets: ["player_blocks", "player_steals"] },
    ] as const;
  }
  if (s === "mlb") {
    return [
      {
        key: "batter",
        label: "Batter",
        markets: [
          "batter_hits",
          "batter_total_bases",
          "batter_rbis",
          "batter_runs_scored",
          "batter_home_runs",
          "batter_stolen_bases",
        ],
      },
      {
        key: "pitcher",
        label: "Pitcher",
        markets: ["pitcher_strikeouts", "pitcher_outs", "pitcher_earned_runs"],
      },
    ] as const;
  }
  if (s === "nhl") {
    return [
      { key: "skater_pts", label: "Points", markets: ["player_points", "player_goals", "player_assists", "player_power_play_points"] },
      { key: "shots", label: "Shots", markets: ["player_shots_on_goal"] },
      { key: "blocks", label: "Blocks", markets: ["player_blocked_shots"] },
    ] as const;
  }
  if (s === "soccer") {
    return [
      { key: "scorer", label: "Scorer", markets: ["player_goal_scorer_anytime"] },
      { key: "shots", label: "Shots", markets: ["player_shots", "player_shots_on_target"] },
      { key: "assists", label: "Assists", markets: ["player_assists"] },
    ] as const;
  }
  return [] as const;
}

export function softRoleFromMarket(sport: string, market: string): MatchupRole | null {
  const m = String(market ?? "").toLowerCase();
  for (const role of matchupRolesForSport(sport)) {
    if (role.markets.some((k) => m === k || m.startsWith(`${k}_`))) return role;
  }
  return null;
}

/**
 * Map verified roster abbreviations onto filter/group keys when authentic.
 * Never invent a position — returns null when abbreviation is unrecognized.
 */
export function rosterPositionToRoleKey(sport: string, position: string | null | undefined): string | null {
  const p = String(position ?? "").trim().toUpperCase();
  if (!p) return null;
  const s = String(sport ?? "").toLowerCase();
  if (s === "nfl" || s === "ncaaf" || s === "cfb") {
    if (p === "QB") return "qb";
    if (p === "RB" || p === "FB" || p === "HB") return "rb";
    if (p === "WR") return "wr";
    if (p === "TE") return "te";
    return null;
  }
  if (s === "nba" || s === "wnba" || s === "ncaab" || s === "cbb") {
    if (["PG", "SG", "SF", "PF", "C", "G", "F"].includes(p)) return p.toLowerCase();
    return null;
  }
  if (s === "mlb") {
    if (["P", "SP", "RP", "CL", "LHP", "RHP"].includes(p)) return "pitcher";
    return "batter";
  }
  if (s === "nhl") {
    if (p === "G") return "g";
    if (p === "D" || p === "LD" || p === "RD") return "d";
    if (p === "C" || p === "LW" || p === "RW" || p === "F" || p === "W") return "f";
    return null;
  }
  if (s === "soccer") {
    if (["F", "FW", "ST", "CF"].includes(p)) return "fwd";
    if (["M", "MF", "CM", "DM", "AM", "LM", "RM"].includes(p)) return "mid";
    if (["D", "DF", "CB", "LB", "RB"].includes(p)) return "def";
    if (["G", "GK"].includes(p)) return "gk";
    return null;
  }
  return null;
}

export type ResolvedMatchupRole = {
  roleKey: string;
  roleLabel: string;
  /** Verified ESPN roster abbreviation when present. */
  position: string | null;
  positionVerified: boolean;
  /** True when role came only from market family (soft). */
  roleFromMarketOnly: boolean;
  /** How the group was chosen — never claim market groups are roster positions. */
  groupSource: "roster_position" | "market";
};

/**
 * Group by verified sport-specific roster position when available.
 * Market-family fallback is labeled honestly (never as positional defense).
 */
export function resolveMatchupRole(opts: {
  sport: string;
  market: string;
  rosterPosition?: string | null;
}): ResolvedMatchupRole {
  const soft = softRoleFromMarket(opts.sport, opts.market);
  const pos = String(opts.rosterPosition ?? "").trim() || null;
  if (pos) {
    const posKey = rosterPositionToRoleKey(opts.sport, pos);
    if (posKey) {
      return {
        roleKey: posKey,
        roleLabel: pos.toUpperCase(),
        position: pos,
        positionVerified: true,
        roleFromMarketOnly: false,
        groupSource: "roster_position",
      };
    }
    // Position string present but unrecognized — still show it; group by market.
    return {
      roleKey: soft?.key ?? "other",
      roleLabel: soft ? `${soft.label} · market` : propMarketLabel(opts.market),
      position: pos,
      positionVerified: true,
      roleFromMarketOnly: !soft,
      groupSource: "market",
    };
  }
  return {
    roleKey: soft?.key ?? "other",
    roleLabel: soft ? `${soft.label} · market` : propMarketLabel(opts.market),
    position: null,
    positionVerified: false,
    roleFromMarketOnly: true,
    groupSource: "market",
  };
}

/** Quote age helpers — honest stale labeling; never invent timestamps. */
export const MATCHUP_QUOTE_STALE_MS = 6 * 60 * 60 * 1000;

export function quoteTimestampForSide(
  prop: PlayerProp,
  side: "Over" | "Under",
): string | null {
  const raw =
    side === "Over" ? prop.overSourceUpdatedAt ?? null : prop.underSourceUpdatedAt ?? null;
  if (!raw || !String(raw).trim()) return null;
  return String(raw);
}

export function isQuoteStale(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
  maxAgeMs: number = MATCHUP_QUOTE_STALE_MS,
): boolean {
  if (!iso) return false; // missing ≠ stale; UI says "quote time unavailable"
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t > maxAgeMs;
}

/**
 * Team-wide opponent defense snippet relevant to a market family.
 * Never claims positional allowances — ESPN pack is team-level only.
 */
export function oppDefenseNoteForMarket(opts: {
  sport: string;
  market: string;
  oppName: string;
  oppDefense: TeamDefense | null | undefined;
}): string | null {
  const def = opts.oppDefense;
  if (!def) return null;
  const s = String(opts.sport ?? "").toLowerCase();
  const m = String(opts.market ?? "").toLowerCase();
  const teamTag = "team-wide · ESPN team-defense";

  if (s === "nfl" || s === "ncaaf" || s === "cfb") {
    if (/rush/.test(m) && def.rushDefense && def.rushDefense.sampleSize > 0) {
      const v = def.rushDefense.rushingYardsAllowedPerGame;
      if (v != null) {
        return `${opts.oppName} allows ${v.toFixed(1)} rush ypg (n=${def.rushDefense.sampleSize} boxes · ${teamTag}). Position-specific rush defense unavailable.`;
      }
    }
    if ((/pass/.test(m) || /reception|anytime_td/.test(m)) && def.passDefense && def.passDefense.sampleSize > 0) {
      const v = def.passDefense.passingYardsAllowedPerGame;
      if (v != null) {
        return `${opts.oppName} allows ${v.toFixed(1)} pass ypg (n=${def.passDefense.sampleSize} boxes · ${teamTag}). Position-specific pass/WR defense unavailable.`;
      }
    }
  }
  if (def.avgPointsAgainst != null) {
    return `${opts.oppName} allows ${def.avgPointsAgainst.toFixed(1)} PPG (season · ${teamTag}). Position-specific allowances unavailable.`;
  }
  return null;
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
 * Require exact-event identity before sim/qualify. Never infer team from
 * nickname or headshot — ambiguous bindings are excluded.
 */
export function candidateIdentityOk(opts: {
  prop: PlayerProp;
  sport: string;
  ids: MatchupTeamIds;
}): { ok: true } | { ok: false; reason: string } {
  const p = opts.prop;
  if (!propBelongsToGameTeams(p.playerTeamId, opts.ids.homeTeamId, opts.ids.awayTeamId)) {
    return { ok: false, reason: "Player team is not bound to this event's home/away ids." };
  }
  const sport = String(opts.sport ?? "").toLowerCase();
  if (sport !== "soccer" && !String(p.athleteId ?? "").trim()) {
    return { ok: false, reason: "Missing verified athlete id — cannot bind simulation identity." };
  }
  if (sport === "soccer" && !String(p.athleteId ?? "").trim() && !String(p.player ?? "").trim()) {
    return { ok: false, reason: "Missing player identity for soccer prop." };
  }
  // Event id when present on the row must be non-empty; null is allowed only
  // when the sheet already scoped getProps by eventId (caller responsibility).
  if (p.eventId != null && !String(p.eventId).trim() && p.oddsEventId != null && !String(p.oddsEventId).trim()) {
    return { ok: false, reason: "Ambiguous empty event id on prop row." };
  }
  return { ok: true };
}

/** Posted sides to evaluate — both when priced, else the single available side. */
export function candidateSidesForProp(
  p: PlayerProp,
): Array<{ side: "Over" | "Under"; price: number }> {
  const out: Array<{ side: "Over" | "Under"; price: number }> = [];
  if (p.overPrice != null && Number.isFinite(p.overPrice)) {
    out.push({ side: "Over", price: p.overPrice });
  }
  if (p.underPrice != null && Number.isFinite(p.underPrice)) {
    out.push({ side: "Under", price: p.underPrice });
  }
  if (out.length) return out;
  const fallback = recommendSide(p);
  return fallback ? [fallback] : [];
}

/**
 * Build scored candidates from posted mains for THIS event only.
 * Unbound / alt-only / irrelevant / unpriced / ambiguous-identity rows drop (fail closed).
 * Both Over and Under are candidates when both are priced so qualification
 * always matches the exact displayed side/line/price.
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
    const idCheck = candidateIdentityOk({ prop: p, sport: opts.sport, ids: opts.ids });
    if (!idCheck.ok) continue;

    const onHome = String(p.playerTeamId).trim() === String(homeId).trim();
    const teamSide: MatchupTeamSide = onHome ? "home" : "away";
    for (const sel of candidateSidesForProp(p)) {
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
  }

  // Prefer diverse players/markets; stable order from feed. Cap keeps deep-sim load bounded.
  const take = (rows: ConsiderCandidate[]) => {
    const seenPlayerSide = new Set<string>();
    const out: ConsiderCandidate[] = [];
    for (const r of rows) {
      if (out.length >= maxPer) break;
      const pk = `${r.prop.player}|${r.side}`.toLowerCase();
      if (seenPlayerSide.has(pk)) continue;
      seenPlayerSide.add(pk);
      out.push(r);
    }
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
        ? "No relevant posted player-prop mains with a real price and verified identity are available for this matchup."
        : "No posted player props could be bound to either team for this event.",
    };
  }
  return { candidates, skipReason: null };
}

export type ConsiderQualification =
  | { status: "qualified"; reason: null }
  | { status: "rejected"; reason: string };

/**
 * Exact selection binding — sim row must match the displayed player/market/line/side.
 * Prevents qualifying Over while rendering Under (or an alternate line).
 */
export function simMatchesConsiderSelection(
  sim: PropSimulationResult | null | undefined,
  cand: Pick<ConsiderCandidate, "side" | "prop">,
): boolean {
  if (!sim) return false;
  const p = cand.prop;
  if (String(sim.player).trim() !== String(p.player).trim()) return false;
  if (String(sim.market).toLowerCase() !== String(p.market).toLowerCase()) return false;
  if (sim.side !== cand.side) return false;
  if (p.line == null || !Number.isFinite(p.line) || !Number.isFinite(sim.line)) return false;
  if (Math.abs(sim.line - p.line) > 1e-9) return false;
  return true;
}

/** Look up the exact sim for a candidate — never accept a mismatched side/line. */
export function lookupExactConsiderSim(
  sims: Map<string, PropSimulationResult> | null | undefined,
  cand: ConsiderCandidate,
): PropSimulationResult | null {
  if (!sims) return null;
  const simKey = `${cand.prop.player}|${cand.prop.market}|${cand.prop.line}|${cand.side}`;
  const direct = sims.get(simKey) ?? sims.get(simKey.toLowerCase());
  if (direct && simMatchesConsiderSelection(direct, cand)) return direct;
  for (const [k, v] of sims) {
    if (k.toLowerCase() === simKey.toLowerCase() && simMatchesConsiderSelection(v, cand)) {
      return v;
    }
    if (simMatchesConsiderSelection(v, cand)) return v;
  }
  return null;
}

/**
 * Qualify against shared Coach floors + exact-market provenance for the
 * displayed selection. Missing grades never qualify. Negative edge / sub-52%
 * hit never qualify. Floors are never relaxed to fill top-2 slots.
 */
export function qualifyConsiderSim(
  sim: PropSimulationResult | null | undefined,
  opts?: {
    cand?: ConsiderCandidate;
    grade?: GradeResult | null;
    price?: number | null;
  },
): ConsiderQualification {
  if (!sim) {
    return { status: "rejected", reason: "Simulation evidence unavailable." };
  }
  if (opts?.cand && !simMatchesConsiderSelection(sim, opts.cand)) {
    return {
      status: "rejected",
      reason: "Simulation identity does not match the displayed player/market/side/line.",
    };
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
      reason: `Needs ${MATCHUP_CONSIDER_MIN_SIMULATIONS.toLocaleString()} exact-market simulations (got ${sim.simulations ?? 0}).`,
    };
  }
  if ((sim.sampleGames ?? 0) < MATCHUP_CONSIDER_MIN_SAMPLE_GAMES) {
    return {
      status: "rejected",
      reason: `Insufficient simulation-history sample (sim n=${sim.sampleGames ?? 0}; need ≥${MATCHUP_CONSIDER_MIN_SAMPLE_GAMES}).`,
    };
  }

  const hitPct = Math.round(sim.hitProbability * 1000) / 10;
  if (hitPct < MATCHUP_CONSIDER_MIN_HIT_PCT) {
    return {
      status: "rejected",
      reason: `Simulated probability ${hitPct}% is below the ${MATCHUP_CONSIDER_MIN_HIT_PCT}% floor.`,
    };
  }

  const grade = opts?.grade ?? null;
  if (!grade?.grade) {
    return {
      status: "rejected",
      reason: `Missing hit-rate grade — need ≥${GRADE_MIN_SAMPLE} logged games clearing the ${MATCHUP_CONSIDER_MIN_GRADE} floor (missing grades never qualify).`,
    };
  }
  if (
    !meetsCoachSimQualityFloor({
      grade: grade.grade,
      confidencePct: hitPct,
    })
  ) {
    return {
      status: "rejected",
      reason: `Grade ${grade.grade} / ${hitPct}% does not meet ${MATCHUP_CONSIDER_MIN_GRADE} + ${MATCHUP_CONSIDER_MIN_HIT_PCT}% floors.`,
    };
  }

  const price = opts?.price ?? opts?.cand?.price ?? null;
  const edgePct = simulatorModelEdge(sim.hitProbability, price);
  if (edgePct == null || !Number.isFinite(edgePct)) {
    return { status: "rejected", reason: "Model edge unavailable for the posted price." };
  }
  if (edgePct <= 0) {
    return {
      status: "rejected",
      reason: `Model edge ${edgePct.toFixed(1)} pp is not positive versus the posted price.`,
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
  /** Verified roster abbreviation when present; null when unavailable. */
  position: string | null;
  positionVerified: boolean;
  roleKey: string;
  roleLabel: string;
  marketKey: string;
  marketLabel: string;
  side: "Over" | "Under";
  line: number;
  price: number;
  overPrice: number | null;
  underPrice: number | null;
  sportsbook: string | null;
  overBook: string | null;
  underBook: string | null;
  quoteUpdatedAt: string | null;
  quoteStale: boolean;
  altCount: number;
  grade: Grade | null;
  gradeHits: number | null;
  gradeN: number | null;
  /** Model edge (sim hit − implied) in percentage points; null when uncomputable. */
  edgePct: number | null;
  simHitPct: number;
  simulations: number;
  sampleGames: number;
  meanProjection: number | null;
  formSummary: string;
  opportunitySummary: string;
  defenseSummary: string;
  explanation: string;
  prop: PlayerProp;
};

/** Honest recent-form label — never conflate with simulation-history n. */
export function considerFormSummary(grade: GradeResult | null | undefined): string {
  if (grade?.grade && grade.n >= GRADE_MIN_SAMPLE) {
    return `Recent hit-rate form ${grade.hits}/${grade.n} vs this exact line (${GRADE_WINDOW}-game window).`;
  }
  if (grade && grade.n > 0 && grade.n < GRADE_MIN_SAMPLE) {
    return `Recent hit-rate grade unavailable — only ${grade.n} logged games (need ≥${GRADE_MIN_SAMPLE}).`;
  }
  return `Recent hit-rate grade unavailable — missing grade or below ${MATCHUP_CONSIDER_MIN_GRADE} threshold (need ≥${GRADE_MIN_SAMPLE} logged games clearing the floor).`;
}

/** Simulation-history sample — separate from recent hit-rate form sample. */
export function considerSimSampleSummary(sim: PropSimulationResult, hitPct: number): string {
  return `${MATCHUP_CONSIDER_MIN_SIMULATIONS.toLocaleString()}-sim exact-market hit ${hitPct}% · simulation-history n=${sim.sampleGames} (not the recent hit-rate sample).`;
}

export function buildConsiderPick(opts: {
  cand: ConsiderCandidate;
  sim: PropSimulationResult;
  grade: GradeResult | null;
  altCount: number;
  sport: string;
  usageNote?: string | null;
  defenseNote?: string | null;
  nowMs?: number;
}): ConsiderPick | null {
  const q = qualifyConsiderSim(opts.sim, {
    cand: opts.cand,
    grade: opts.grade,
    price: opts.cand.price,
  });
  if (q.status !== "qualified") return null;
  const p = opts.cand.prop;
  const hitPct = Math.round((opts.sim.hitProbability as number) * 1000) / 10;
  const edgePct = simulatorModelEdge(opts.sim.hitProbability, opts.cand.price);
  if (edgePct == null || edgePct <= 0) return null;
  const role = resolveMatchupRole({
    sport: opts.sport,
    market: p.market,
    rosterPosition: p.position ?? null,
  });

  const formSummary = considerFormSummary(opts.grade);
  const simSampleSummary = considerSimSampleSummary(opts.sim, hitPct);
  const opportunitySummary = opts.usageNote?.trim()
    ? opts.usageNote.trim()
    : "Opportunity / usage metrics unavailable for this card.";
  const defenseSummary =
    opts.defenseNote?.trim() ||
    "Opponent defensive rates unavailable — nothing estimated. Position-specific allowances are not in this feed.";

  const parts: string[] = [formSummary, opportunitySummary, simSampleSummary];
  if (opts.sim.meanProjection != null) {
    parts.push(`Mean projection ${opts.sim.meanProjection.toFixed(1)}.`);
  }
  parts.push(`Model edge +${edgePct.toFixed(1)} pp vs posted ${opts.cand.side} price.`);
  parts.push(defenseSummary);
  if (role.groupSource === "roster_position" && role.position) {
    parts.push(`Grouped by verified roster position ${role.position} (ESPN).`);
  } else if (role.positionVerified && role.position) {
    parts.push(
      `Roster position ${role.position} (ESPN) · grouped by market role (not positional defense).`,
    );
  } else {
    parts.push(
      "Verified roster position unavailable — grouped by posted market role only (not positional defense).",
    );
  }

  const book =
    opts.cand.side === "Over" ? p.overBook ?? null : p.underBook ?? null;
  const quoteUpdatedAt = quoteTimestampForSide(p, opts.cand.side);
  const quoteStale = isQuoteStale(quoteUpdatedAt, opts.nowMs);

  return {
    key: opts.cand.key,
    player: p.player,
    athleteId: p.athleteId ?? null,
    headshot: p.headshot ?? null,
    teamSide: opts.cand.teamSide,
    teamName: opts.cand.teamName,
    oppName: opts.cand.oppName,
    position: role.position,
    positionVerified: role.positionVerified,
    roleKey: role.roleKey,
    roleLabel: role.roleLabel,
    marketKey: p.market,
    marketLabel: propMarketLabel(p.market),
    side: opts.cand.side,
    line: p.line as number,
    price: opts.cand.price,
    overPrice: p.overPrice ?? null,
    underPrice: p.underPrice ?? null,
    sportsbook: book,
    overBook: p.overBook ?? null,
    underBook: p.underBook ?? null,
    quoteUpdatedAt,
    quoteStale,
    altCount: opts.altCount,
    grade: opts.grade?.grade ?? null,
    gradeHits: opts.grade?.hits ?? null,
    gradeN: opts.grade?.n ?? null,
    edgePct,
    simHitPct: hitPct,
    simulations: opts.sim.simulations,
    sampleGames: opts.sim.sampleGames,
    meanProjection: opts.sim.meanProjection,
    formSummary,
    opportunitySummary,
    defenseSummary,
    explanation: parts.join(" "),
    prop: p,
  };
}

/** Exact Add-to-Slip payload for a qualified consider pick — same selection as the card. */
export function considerSlipPayload(
  pick: ConsiderPick,
  gameLabel: string,
): { game: string; market: string; pick: string; odds: number; sport?: string } {
  return {
    game: gameLabel,
    market: pick.marketLabel,
    pick: `${pick.player} ${pick.side} ${pick.line} ${pick.marketLabel}`,
    odds: pick.price,
  };
}

/** Max qualifying cards shown per role/position group (from either side). */
export const MATCHUP_TOP_PER_ROLE = 2;

export type MatchupRoleGroup = {
  roleKey: string;
  roleLabel: string;
  picks: ConsiderPick[];
};

/**
 * Deduplicate by player+market (keep best sim/edge), then take top N per role
 * across either team. Ranking: sim hit % → edge → price.
 */
export function rankConsiderPicksByRole(
  picks: ConsiderPick[],
  maxPerRole: number = MATCHUP_TOP_PER_ROLE,
): MatchupRoleGroup[] {
  const deduped = dedupeConsiderPicks(picks);
  const byRole = new Map<string, ConsiderPick[]>();
  for (const p of deduped) {
    const list = byRole.get(p.roleKey) ?? [];
    list.push(p);
    byRole.set(p.roleKey, list);
  }
  const order = new Map<string, number>();
  // Preserve discovery order of role keys as they appear in ranked picks.
  let i = 0;
  for (const p of deduped) {
    if (!order.has(p.roleKey)) order.set(p.roleKey, i++);
  }
  const groups: MatchupRoleGroup[] = [];
  for (const [roleKey, list] of [...byRole.entries()].sort(
    (a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0),
  )) {
    const sorted = [...list].sort(
      (a, b) =>
        b.simHitPct - a.simHitPct ||
        (b.edgePct ?? -999) - (a.edgePct ?? -999) ||
        b.price - a.price,
    );
    groups.push({
      roleKey,
      roleLabel: sorted[0]?.roleLabel ?? roleKey,
      picks: sorted.slice(0, Math.max(0, maxPerRole)),
    });
  }
  return groups.filter((g) => g.picks.length > 0);
}

/** Keep the stronger pick when the same player+market appears twice. */
export function dedupeConsiderPicks(picks: ConsiderPick[]): ConsiderPick[] {
  const best = new Map<string, ConsiderPick>();
  for (const p of picks) {
    const k = `${p.player}|${p.marketKey}`.toLowerCase();
    const prev = best.get(k);
    if (!prev) {
      best.set(k, p);
      continue;
    }
    const better =
      p.simHitPct !== prev.simHitPct
        ? p.simHitPct > prev.simHitPct
        : (p.edgePct ?? -999) > (prev.edgePct ?? -999);
    if (better) best.set(k, p);
  }
  return [...best.values()];
}

/**
 * Filter by role chip / market key / verified position family.
 * `wr_te` matches WR or TE roster groups and receiving markets.
 */
export function filterConsiderPicks(
  picks: ConsiderPick[],
  filterKey: string | null | undefined,
  sport?: string,
): ConsiderPick[] {
  const f = String(filterKey ?? "all").toLowerCase();
  if (!f || f === "all") return picks;
  return picks.filter((p) => {
    if (p.roleKey.toLowerCase() === f) return true;
    if (p.marketKey.toLowerCase() === f || p.marketKey.toLowerCase().startsWith(`${f}_`)) {
      return true;
    }
    const marketRole = softRoleFromMarket(sport ?? "", p.marketKey);
    if (marketRole?.key === f) return true;
    if (f === "wr_te" && (p.roleKey === "wr" || p.roleKey === "te")) return true;
    if (p.positionVerified && rosterPositionToRoleKey(sport ?? "", p.position) === f) {
      return true;
    }
    return false;
  });
}

export type MatchupFilterChip = {
  key: string;
  label: string;
};

export function matchupFilterChips(sport: string): MatchupFilterChip[] {
  return [{ key: "all", label: "All" }, ...matchupRolesForSport(sport).map((r) => ({ key: r.key, label: r.label }))];
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
