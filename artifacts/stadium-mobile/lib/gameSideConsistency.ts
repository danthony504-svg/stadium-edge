// One committed team per game for ML/spread legs — prevents Mets ML + Braves -1.5
// on the same ticket. Conflicting sides resolve by market-specific simulation,
// value, quality, and lean/correlation tiebreaks — never by outright win
// probability alone when a better-qualified underdog spread exists.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { MatchupHistoryEntry } from "./api.ts";
import {
  gameLabelsMatch,
  gameSimHasValidRun,
  gameSimHitForPick,
  isGameLinePick,
  lookupGameSim,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const teamNick = (team: string) => {
  const t = norm(team).split(" ").filter(Boolean);
  return t[t.length - 1] || "";
};

function teamsMatch(pickTeam: string, leanSide: string): boolean {
  const a = norm(pickTeam);
  const b = norm(leanSide);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const na = teamNick(pickTeam);
  const nb = teamNick(leanSide);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  return b
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

const SIM_SIDE_MARGIN = 0.03;

function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function isMlOrSpreadPick(pick: ParsedPick): boolean {
  if (!isGameLinePick(pick)) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/total|over|under|o\/u/.test(m) || /\b(over|under)\b/i.test(pick.pick)) return false;
  return true;
}

/** Which side the game sim favors when the edge is meaningful (ML win-prob only). */
export function simFavoredTeamSide(
  sim: CoachGameSimEntry | null | undefined,
): "home" | "away" | null {
  if (!gameSimHasValidRun(sim)) return null;
  const diff = Math.abs(sim!.homeWinProbability - sim!.awayWinProbability);
  if (diff < SIM_SIDE_MARGIN) return null;
  return sim!.homeWinProbability > sim!.awayWinProbability ? "home" : "away";
}

function lookupMatchupHistory(
  game: string,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): MatchupHistoryEntry | undefined {
  if (!matchupHistory) return undefined;
  const direct = matchupHistory[game];
  if (direct) return direct;
  for (const [label, entry] of Object.entries(matchupHistory)) {
    if (gameLabelsMatch(label, game)) return entry;
  }
  return undefined;
}

function leanSideForGame(
  game: string,
  away: string,
  home: string,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): "home" | "away" | null {
  const entry = lookupMatchupHistory(game, matchupHistory);
  const lean = entry?.mlLean?.side;
  if (!lean) return null;
  if (teamsMatch(home, lean)) return "home";
  if (teamsMatch(away, lean)) return "away";
  return null;
}

/** Group ML/spread legs by matchup — pick and sim labels may differ by nickname. */
function groupMlSpreadLegsByGame(picks: ParsedPick[]): Map<string, ParsedPick[]> {
  const groups: { game: string; legs: ParsedPick[] }[] = [];
  for (const p of picks) {
    if (!isMlOrSpreadPick(p)) continue;
    const existing = groups.find((g) => gameLabelsMatch(g.game, p.game));
    if (existing) existing.legs.push(p);
    else groups.push({ game: p.game, legs: [p] });
  }
  const byGame = new Map<string, ParsedPick[]>();
  for (const { game, legs } of groups) byGame.set(game, legs);
  return byGame;
}

function pickTeamName(pick: ParsedPick): string | null {
  const p = pick.pick || "";
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function pickTeamSide(
  pick: ParsedPick,
  away: string,
  home: string,
): "home" | "away" | null {
  const team = pickTeamName(pick);
  if (!team) return null;
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

function legKey(pick: ParsedPick): string {
  return `${pick.game}|${pick.market}|${pick.pick}`.toLowerCase();
}

/**
 * Final AI / value metrics for resolving opposing sides.
 * Matches gameLineOptimizer.rankEvaluated: composite → simAligned → edge.
 * Raw cover is recorded for diagnostics only — never used to rank across
 * differently priced spreads, ML, or alt lines (price is in edge/EV).
 */
export type GameSideLegMetrics = {
  composite: number;
  edgePct: number;
  /** EV in percent points when odds + cover are known; else −∞. */
  evPct: number;
  simAligned: boolean;
  /** Diagnostic only — not used in compareLegMetrics. */
  marketSimHit: number;
  qualified: boolean;
};

function americanToDecimal(odds: number): number | null {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

/** Expected value in percent points: (hit * decimal − 1) * 100. */
export function evPctFromHitAndOdds(
  hit: number | null | undefined,
  odds: number | null | undefined,
): number | null {
  if (hit == null || !Number.isFinite(hit) || odds == null) return null;
  const dec = americanToDecimal(odds);
  if (dec == null) return null;
  return (hit * dec - 1) * 100;
}

export function gameSideLegMetrics(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
): GameSideLegMetrics {
  const composite =
    pick.finalAiScore?.composite ?? pick.scores?.composite ?? Number.NEGATIVE_INFINITY;
  const edgePct =
    pick.finalAiScore?.edgePct ??
    (typeof pick.scores?.edgePct === "number" ? pick.scores.edgePct : null) ??
    Number.NEGATIVE_INFINITY;
  const fromScore = pick.finalAiScore?.simHit;
  const fromSim = gameSimHitForPick(pick, sim);
  const marketSimHit =
    fromScore != null && Number.isFinite(fromScore)
      ? fromScore
      : fromSim != null && Number.isFinite(fromSim)
        ? fromSim
        : Number.NEGATIVE_INFINITY;
  const simAligned =
    pick.finalAiScore?.simAligned === true ||
    (Number.isFinite(marketSimHit) && marketSimHit >= 0.52);
  const ev =
    evPctFromHitAndOdds(
      Number.isFinite(marketSimHit) ? marketSimHit : null,
      pick.odds,
    ) ?? Number.NEGATIVE_INFINITY;
  const qualified =
    pick.finalAiScore != null &&
    (pick.finalAiScore.recommends === true ||
      (pick.finalAiScore.composite != null && pick.finalAiScore.composite >= 6.5));
  return {
    composite: Number.isFinite(composite) ? composite : Number.NEGATIVE_INFINITY,
    edgePct: Number.isFinite(edgePct as number) ? (edgePct as number) : Number.NEGATIVE_INFINITY,
    evPct: Number.isFinite(ev) ? ev : Number.NEGATIVE_INFINITY,
    simAligned,
    marketSimHit: Number.isFinite(marketSimHit) ? marketSimHit : Number.NEGATIVE_INFINITY,
    qualified,
  };
}

/** Final AI / value order — never ranks by raw cover across priced lines. */
export function compareLegMetrics(a: GameSideLegMetrics, b: GameSideLegMetrics): number {
  if (a.qualified !== b.qualified) return a.qualified ? 1 : -1;
  if (a.composite !== b.composite) return a.composite - b.composite;
  if (a.simAligned !== b.simAligned) return a.simAligned ? 1 : -1;
  // Prefer edge, then EV (both price-aware). Do not fall back to raw cover.
  if (a.edgePct !== b.edgePct) return a.edgePct - b.edgePct;
  if (a.evPct !== b.evPct) return a.evPct - b.evPct;
  return 0;
}

function bestLegOnSide(
  legs: ParsedPick[],
  side: "home" | "away",
  away: string,
  home: string,
  sim: CoachGameSimEntry | null | undefined,
): { pick: ParsedPick; metrics: GameSideLegMetrics } | null {
  let best: { pick: ParsedPick; metrics: GameSideLegMetrics } | null = null;
  for (const leg of legs) {
    if (pickTeamSide(leg, away, home) !== side) continue;
    const metrics = gameSideLegMetrics(leg, sim);
    if (!best || compareLegMetrics(metrics, best.metrics) > 0) {
      best = { pick: leg, metrics };
    }
  }
  return best;
}

export type GameSideRejection = {
  pick: string;
  market: string;
  side: "home" | "away";
  reason: string;
};

export type GameSideResolution = {
  keep: "home" | "away";
  reason: string;
  rejections: GameSideRejection[];
};

/**
 * Resolve opposing ML/spread sides using market-specific sim cover, edge,
 * Final AI quality, then mlLean — never discard a better-qualified underdog
 * solely because the favorite has higher outright win probability.
 */
export function resolveConflictingGameSide(
  legs: ParsedPick[],
  game: string,
  opts: {
    simByGame?: Map<string, CoachGameSimEntry>;
    matchupHistory?: Record<string, MatchupHistoryEntry>;
  } = {},
): GameSideResolution | null {
  const { away, home } = splitLabel(game);
  const sides = new Set(
    legs.map((l) => pickTeamSide(l, away, home)).filter((s): s is "home" | "away" => !!s),
  );
  if (sides.size <= 1) return null;

  const sim = lookupGameSim(game, opts.simByGame);
  const homeBest = bestLegOnSide(legs, "home", away, home, sim);
  const awayBest = bestLegOnSide(legs, "away", away, home, sim);

  let keep: "home" | "away" | null = null;
  let reason = "";

  if (homeBest && awayBest) {
    const cmp = compareLegMetrics(homeBest.metrics, awayBest.metrics);
    const fmt = (m: GameSideLegMetrics) =>
      `comp ${m.composite.toFixed(2)} / edge ${m.edgePct.toFixed(2)} / EV ${Number.isFinite(m.evPct) ? m.evPct.toFixed(2) : "n/a"} / aligned ${m.simAligned}`;
    if (cmp > 0) {
      keep = "home";
      reason = `kept home for higher Final AI/value (${fmt(homeBest.metrics)} vs away ${fmt(awayBest.metrics)})`;
    } else if (cmp < 0) {
      keep = "away";
      reason = `kept away for higher Final AI/value (${fmt(awayBest.metrics)} vs home ${fmt(homeBest.metrics)})`;
    }
  } else if (homeBest) {
    keep = "home";
    reason = "only home side scored";
  } else if (awayBest) {
    keep = "away";
    reason = "only away side scored";
  }

  if (!keep) {
    keep = leanSideForGame(game, away, home, opts.matchupHistory);
    if (keep) reason = `tiebreak mlLean → ${keep}`;
  }
  if (!keep) {
    // Last resort: first leg — still better than both sides. Do NOT fall back
    // to simFavoredTeamSide (outright win-prob) when metrics were present but tied;
    // lean already tried. Win-prob alone is only used when no metrics exist at all.
    const noMetrics =
      (!homeBest ||
        (homeBest.metrics.composite === Number.NEGATIVE_INFINITY &&
          homeBest.metrics.edgePct === Number.NEGATIVE_INFINITY)) &&
      (!awayBest ||
        (awayBest.metrics.composite === Number.NEGATIVE_INFINITY &&
          awayBest.metrics.edgePct === Number.NEGATIVE_INFINITY));
    if (noMetrics) {
      const winProbSide = simFavoredTeamSide(sim);
      if (winProbSide) {
        keep = winProbSide;
        reason = `no market metrics — fallback sim win-prob → ${keep}`;
      }
    }
  }
  if (!keep) {
    keep = pickTeamSide(legs[0]!, away, home);
    if (keep) reason = `first-leg fallback → ${keep}`;
  }
  if (!keep) return null;

  const rejections: GameSideRejection[] = [];
  for (const leg of legs) {
    const side = pickTeamSide(leg, away, home);
    if (side && side !== keep) {
      rejections.push({
        pick: leg.pick,
        market: leg.market,
        side,
        reason: `opposing side dropped — ${reason}`,
      });
    }
  }

  return { keep, reason, rejections };
}

export type GameSideConsistencyResult = {
  picks: ParsedPick[];
  dropped: number;
  note: string;
  /** Per-game resolutions when both sides collided (for audits / tests). */
  resolutions?: Array<{ game: string } & GameSideResolution>;
};

/**
 * For each game, allow ML/spread legs on only ONE team. When both sides appear,
 * keep the better qualified market (sim cover / edge / Final AI), not the
 * higher outright win-probability favorite by default.
 */
export function enforceConsistentGameSides(
  picks: ParsedPick[],
  opts: {
    simByGame?: Map<string, CoachGameSimEntry>;
    matchupHistory?: Record<string, MatchupHistoryEntry>;
  } = {},
): GameSideConsistencyResult {
  const byGame = groupMlSpreadLegsByGame(picks);

  const dropKeys = new Set<string>();
  let dropped = 0;
  const resolutions: Array<{ game: string } & GameSideResolution> = [];

  for (const [game, legs] of byGame) {
    const resolution = resolveConflictingGameSide(legs, game, opts);
    if (!resolution) continue;
    resolutions.push({ game, ...resolution });
    for (const leg of legs) {
      const { away, home } = splitLabel(game);
      const side = pickTeamSide(leg, away, home);
      if (side && side !== resolution.keep) {
        dropKeys.add(legKey(leg));
      }
    }
  }

  const kept: ParsedPick[] = [];
  for (const p of picks) {
    if (dropKeys.has(legKey(p))) {
      dropped += 1;
      continue;
    }
    kept.push(p);
  }

  let note = "";
  if (dropped > 0) {
    note = `_Dropped ${dropped} leg${dropped === 1 ? "" : "s"} that backed the opposing team on the same game — one side per matchup (Final AI / edge / EV, not win-prob or raw cover alone)._`;
  }

  return { picks: kept, dropped, note, resolutions };
}
