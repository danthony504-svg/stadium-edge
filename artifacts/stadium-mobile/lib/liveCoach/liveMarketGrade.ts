/**
 * Live Coach Phase 2A — grade a real live market from remaining-game sim.
 * Preserves provider line + price exactly. Never synthesizes lines.
 */

import { impliedProb } from "../format.ts";
import { simEvPct, simEdgeFromHit } from "../gameSimQualityGates.ts";
import type { NormalizedLiveMarket } from "./types.ts";
import type { LiveCoverQuery, RemainingGameSimResult } from "./remainingGameSim.ts";

/** Minimum edge (pct points) to qualify a live recommendation. Never lowered to fill. */
export const LIVE_COACH_MIN_EDGE_PCT = 1.5;
export const LIVE_COACH_MIN_EV_PCT = 0.5;
export const LIVE_COACH_MIN_FAIR_PROB = 0.05;

export type LiveMarketGrade = {
  coverQueryId: string;
  fairProb: number;
  impliedProb: number;
  edgePct: number;
  evPct: number;
  qualifies: boolean;
  rejectReasons: string[];
  /** Echo of provider quote — never altered. */
  line: number | null;
  price: number;
  market: string;
  pick: string;
};

/**
 * Build a cover query that matches the provider's posted live market exactly.
 * Returns null when the side/line cannot be grounded from the pick string.
 */
export function liveCoverQueryFromMarket(m: NormalizedLiveMarket): LiveCoverQuery | null {
  const market = String(m.market ?? "").trim().toLowerCase();
  const pick = String(m.pick ?? "").trim();
  const id = `${m.eventId}|${market}|${pick}|${m.line ?? "ml"}|${m.price}`;

  if (market === "moneyline") {
    const side = resolveTeamSide(m);
    if (!side) return null;
    return { id, kind: "ml", teamSide: side };
  }

  if (market === "spread" || market === "puck line" || market === "puckline") {
    const side = resolveTeamSide(m);
    if (!side) return null;
    if (m.line == null || !Number.isFinite(m.line)) return null;
    return { id, kind: "spread", teamSide: side, line: m.line };
  }

  if (market === "total") {
    const lower = pick.toLowerCase();
    const totalSide = lower.startsWith("over")
      ? "over"
      : lower.startsWith("under")
        ? "under"
        : null;
    if (!totalSide) return null;
    if (m.line == null || !Number.isFinite(m.line)) return null;
    return { id, kind: "total", totalSide, line: m.line };
  }

  return null;
}

function resolveTeamSide(m: NormalizedLiveMarket): "home" | "away" | null {
  const pick = String(m.pick ?? "").toLowerCase();
  const away = nick(m.awayTeam);
  const home = nick(m.homeTeam);
  if (away && pick.includes(away)) return "away";
  if (home && pick.includes(home)) return "home";
  // Matchup "Away @ Home" — try last tokens from matchup if team fields thin.
  const parts = String(m.matchup ?? "").split(/\s+@\s+/);
  if (parts.length === 2) {
    const a = nick(parts[0]!);
    const h = nick(parts[1]!);
    if (a && pick.includes(a)) return "away";
    if (h && pick.includes(h)) return "home";
  }
  return null;
}

function nick(name: string | null | undefined): string {
  const parts = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : "";
}

/**
 * Grade one live market against a remaining-game sim result.
 * Uses the provider's actual line and price only.
 */
export function gradeLiveMarket(
  m: NormalizedLiveMarket,
  sim: RemainingGameSimResult,
  coverQuery: LiveCoverQuery,
): LiveMarketGrade {
  const rejectReasons: string[] = [];
  const fairProb = sim.coverHitRates[coverQuery.id];
  const line = m.line;
  const price = m.price;

  if (fairProb == null || !Number.isFinite(fairProb)) {
    rejectReasons.push("missing_fair_prob");
  }
  if (price == null || !Number.isFinite(price) || price === 0) {
    rejectReasons.push("missing_live_price");
  }

  const implied = Number.isFinite(price) && price !== 0 ? impliedProb(price) : NaN;
  if (!Number.isFinite(implied)) rejectReasons.push("bad_implied_prob");

  const fair = fairProb ?? 0;
  const edgePct =
    Number.isFinite(fair) && Number.isFinite(implied)
      ? (simEdgeFromHit(fair, price) ?? (fair - implied) * 100)
      : 0;
  const evPct =
    Number.isFinite(fair) && Number.isFinite(price) ? (simEvPct(fair, price) ?? 0) : 0;

  if (fair < LIVE_COACH_MIN_FAIR_PROB) rejectReasons.push("fair_prob_too_low");
  if (fair <= implied) rejectReasons.push("fair_not_above_implied");
  if (edgePct < LIVE_COACH_MIN_EDGE_PCT) rejectReasons.push("edge_below_minimum");
  if (evPct < LIVE_COACH_MIN_EV_PCT) rejectReasons.push("ev_below_minimum");

  return {
    coverQueryId: coverQuery.id,
    fairProb: fair,
    impliedProb: Number.isFinite(implied) ? implied : 0,
    edgePct: Math.round(edgePct * 10) / 10,
    evPct: Math.round(evPct * 10) / 10,
    qualifies: rejectReasons.length === 0,
    rejectReasons,
    line,
    price,
    market: m.market,
    pick: m.pick,
  };
}

/** Map fair/edge into a coarse live confidence (0–100). */
export function liveConfidencePct(grade: LiveMarketGrade): number {
  const base = 50 + grade.edgePct * 2.5 + (grade.fairProb - 0.5) * 20;
  return Math.max(52, Math.min(92, Math.round(base)));
}

export function liveGradeLetter(grade: LiveMarketGrade): string {
  if (grade.edgePct >= 8) return "A";
  if (grade.edgePct >= 5) return "A-";
  if (grade.edgePct >= 3.5) return "B+";
  if (grade.edgePct >= 2.5) return "B";
  if (grade.edgePct >= LIVE_COACH_MIN_EDGE_PCT) return "B-";
  return "C";
}
