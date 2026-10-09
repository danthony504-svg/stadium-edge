/**
 * Tennis game-handicap / total-games simulation gates.
 *
 * Match-win probability must never substitute for a verified game-handicap
 * cover rate. When simulated match strength disagrees with the sportsbook
 * moneyline consensus, handicap grades fail closed rather than awarding
 * unsupported A grades or extreme edges (e.g. Struff +3.5 @ +160 → ~49% edge
 * from an ~88% match-win used as a cover hit).
 *
 * Kept free of gameSimScoring imports to avoid circular deps (sanitize path
 * gates tennis covers from gameSimScoring).
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry, TennisAnalysis } from "./api.ts";
import { impliedProb } from "./format.ts";
import { parseMarketPeriod } from "./simMarketSupport.ts";

/** Max |simHit − handicap implied| before a tennis cover rate is treated as uncalibrated. */
export const TENNIS_HANDICAP_MAX_BOOK_GAP = 0.22;

/** Max |sim match-win − book ML implied| before handicap/total grades fail closed. */
export const TENNIS_MATCH_STRENGTH_MAX_ML_GAP = 0.25;

/** Hit rates within this of the side's match-win are treated as ML substitutes. */
export const TENNIS_MATCH_WIN_SUBSTITUTE_EPS = 0.025;

/** Minimal sim shape — avoids importing CoachGameSimEntry. */
export type TennisSimLike = {
  simulations?: number;
  homeWinProbability?: number;
  awayWinProbability?: number;
  coverHitRates?: Record<string, number>;
} | null | undefined;

function sportOf(pick: { sport?: string | null }): string {
  return String(pick.sport ?? "").toLowerCase();
}

function marketFamily(market: string): "moneyline" | "spread" | "total" | "other" {
  const m = String(market ?? "").toLowerCase();
  if (/money|h2h|\bml\b/.test(m)) return "moneyline";
  if (/spread|run ?line|puck ?line|handicap/.test(m)) return "spread";
  if (/total|over|under|o\/u/.test(m)) return "total";
  return "other";
}

export function isTennisPick(pick: { sport?: string | null }): boolean {
  return sportOf(pick) === "tennis";
}

/** Full-game tennis game-handicap (spread) — not moneyline, not period. */
export function isTennisGameHandicap(pick: ParsedPick): boolean {
  if (!isTennisPick(pick) || pick.isProp) return false;
  if (parseMarketPeriod(pick.market ?? "") !== "fg") return false;
  return marketFamily(pick.market ?? "") === "spread";
}

/** Full-game tennis match-games total. */
export function isTennisGameTotal(pick: ParsedPick): boolean {
  if (!isTennisPick(pick) || pick.isProp) return false;
  if (parseMarketPeriod(pick.market ?? "") !== "fg") return false;
  return marketFamily(pick.market ?? "") === "total";
}

export function isTennisHandicapOrTotal(pick: ParsedPick): boolean {
  return isTennisGameHandicap(pick) || isTennisGameTotal(pick);
}

function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function namesMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  return ta.some((t) => tb.includes(t)) || tb.some((t) => ta.includes(t));
}

function pickSide(pick: ParsedPick): "away" | "home" | null {
  const { away, home } = splitLabel(pick.game);
  const p = String(pick.pick ?? "")
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .replace(/\s*(over|under)\b.*$/i, "")
    .trim();
  if (!p) return null;
  if (namesMatch(p, away)) return "away";
  if (namesMatch(p, home)) return "home";
  return null;
}

function coverQueryId(pick: ParsedPick): string {
  return `${pick.game}|${pick.market}|${pick.pick}`.toLowerCase();
}

function simHasValidRun(sim: TennisSimLike): boolean {
  return !!sim && (sim.simulations ?? 0) > 0;
}

/**
 * Verified cover probability from coverHitRates only (never match-win).
 */
export function tennisVerifiedCoverHit(
  pick: ParsedPick,
  sim: TennisSimLike,
): number | null {
  if (!isTennisHandicapOrTotal(pick)) return null;
  if (!simHasValidRun(sim)) return null;

  const fromCover = sim!.coverHitRates?.[coverQueryId(pick)];
  if (fromCover == null || !Number.isFinite(fromCover)) return null;
  if (fromCover <= 0 || fromCover >= 1) return null;

  const side = pickSide(pick);
  if (isTennisGameHandicap(pick) && side) {
    const ml = side === "home" ? sim!.homeWinProbability : sim!.awayWinProbability;
    if (
      ml != null &&
      Number.isFinite(ml) &&
      Math.abs(fromCover - ml) < TENNIS_MATCH_WIN_SUBSTITUTE_EPS
    ) {
      return null;
    }
  }

  return fromCover;
}

/** Apply tennis handicap fail-closed rules to an already-resolved cover hit. */
export function gateTennisCoverHit(
  pick: ParsedPick,
  coverHit: number | null | undefined,
  sim: TennisSimLike,
  realOdds?: RealOddsEntry[],
  tennis?: TennisAnalysis | null,
): number | null {
  if (!isTennisHandicapOrTotal(pick)) {
    return coverHit != null && Number.isFinite(coverHit) ? coverHit : null;
  }
  if (coverHit == null || !Number.isFinite(coverHit) || coverHit <= 0 || coverHit >= 1) {
    return null;
  }
  const side = pickSide(pick);
  if (isTennisGameHandicap(pick) && side && simHasValidRun(sim)) {
    const ml = side === "home" ? sim!.homeWinProbability : sim!.awayWinProbability;
    if (
      ml != null &&
      Number.isFinite(ml) &&
      Math.abs(coverHit - ml) < TENNIS_MATCH_WIN_SUBSTITUTE_EPS
    ) {
      return null;
    }
  }
  if (tennisHandicapFailsClosed(pick, coverHit, sim, realOdds, tennis)) {
    return null;
  }
  return coverHit;
}

function sameTennisMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = splitLabel(a);
  const pb = splitLabel(b);
  if (!pa.away || !pa.home || !pb.away || !pb.home) {
    return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
  }
  return namesMatch(pa.away, pb.away) && namesMatch(pa.home, pb.home);
}

/** Book moneyline implied win probability for the picked side (best price). */
export function tennisBookMlImplied(
  pick: ParsedPick,
  realOdds: RealOddsEntry[] | undefined,
): number | null {
  if (!realOdds?.length) return null;
  const side = pickSide(pick);
  if (!side) return null;
  const { away, home } = splitLabel(pick.game);
  const target = side === "away" ? away : home;
  let bestImplied: number | null = null;
  for (const row of realOdds) {
    if (String(row.sport ?? "").toLowerCase() !== "tennis") continue;
    if (!sameTennisMatch(row.game, pick.game)) continue;
    if (marketFamily(row.market) !== "moneyline") continue;
    const rowSide = pickSide({ ...pick, market: row.market, pick: row.pick });
    if (rowSide !== side && !namesMatch(row.pick, target)) continue;
    if (row.odds == null || !Number.isFinite(row.odds) || row.odds === 0) continue;
    const imp = impliedProb(row.odds);
    if (!Number.isFinite(imp)) continue;
    if (bestImplied == null || imp < bestImplied) bestImplied = imp;
  }
  return bestImplied;
}

export function tennisSimMatchWinForPick(
  pick: ParsedPick,
  sim: TennisSimLike,
  tennis?: TennisAnalysis | null,
): number | null {
  const side = pickSide(pick);
  if (!side) return null;
  if (simHasValidRun(sim)) {
    const hit = side === "away" ? sim!.awayWinProbability : sim!.homeWinProbability;
    if (hit != null && Number.isFinite(hit) && hit > 0 && hit < 1) return hit;
  }
  const tSim = tennis?.simulation;
  if (!tSim) return null;
  const hit = side === "away" ? tSim.awayWinProbability : tSim.homeWinProbability;
  if (hit != null && Number.isFinite(hit) && hit > 0 && hit < 1) return hit;
  return null;
}

/**
 * True when simulated match strength disagrees with sportsbook ML consensus,
 * or when the cover rate is uncalibrated vs the posted handicap price.
 */
export function tennisHandicapFailsClosed(
  pick: ParsedPick,
  coverHit: number,
  sim: TennisSimLike,
  realOdds?: RealOddsEntry[],
  tennis?: TennisAnalysis | null,
): boolean {
  if (!isTennisHandicapOrTotal(pick)) return false;

  if (pick.odds != null && Number.isFinite(pick.odds)) {
    const implied = impliedProb(pick.odds);
    if (
      Number.isFinite(implied) &&
      Math.abs(coverHit - implied) > TENNIS_HANDICAP_MAX_BOOK_GAP
    ) {
      return true;
    }
  }

  const simMl = tennisSimMatchWinForPick(pick, sim, tennis);
  const bookMl = tennisBookMlImplied(pick, realOdds);
  if (
    simMl != null &&
    bookMl != null &&
    Math.abs(simMl - bookMl) > TENNIS_MATCH_STRENGTH_MAX_ML_GAP
  ) {
    return true;
  }

  return false;
}

/**
 * Resolve a gradeable tennis sim hit.
 * - Moneyline: match-win from game sim or tennis analysis.
 * - Game handicap / total: verified cover only; fail closed when unvalidated
 *   or when match strength disagrees with the book.
 */
export function resolveTennisSimHit(
  pick: ParsedPick,
  gameSim: TennisSimLike,
  tennis: TennisAnalysis | null | undefined,
  realOdds?: RealOddsEntry[],
): number | null {
  if (!isTennisPick(pick)) return null;
  const fam = marketFamily(pick.market ?? "");

  if (fam === "moneyline") {
    return tennisSimMatchWinForPick(pick, gameSim, tennis);
  }

  if (fam !== "spread" && fam !== "total") return null;

  const cover = tennisVerifiedCoverHit(pick, gameSim);
  return gateTennisCoverHit(pick, cover, gameSim, realOdds, tennis);
}
