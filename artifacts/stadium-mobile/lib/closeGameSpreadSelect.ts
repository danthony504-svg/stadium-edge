// Close-game spread policy — safer lines on coin-flip sims; aggressive lays only
// when the 10k sim projects a comfortable cover.

import type { RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { gameSimHitForPick, type CoachGameSimEntry } from "./gameSimScoring.ts";
import {
  GAME_LINE_SIM_MIN_HIT,
  isGameLineMainTicketQualified,
} from "./parlayQualifiedGate.ts";
import { selectBestAltLineByEv } from "./altLineEvSelect.ts";
import { isCloseGameForTeamSpread, spreadLineFromPick } from "./spreadSimAlignment.ts";

export type CloseGameSpreadOpts = {
  longshotAsk?: boolean;
};

export type CloseGameSpreadRow = {
  entry: RealOddsEntry;
  finalAiScore: FinalAiScore;
  winProb: number | null;
  edgePct: number | null;
};

/** @deprecated Use GAME_SIM_MIN_HIT — kept for tests referencing the old band. */
export const CLOSE_GAME_SIM_FLOOR = 0.48;
/** @deprecated Use GAME_SIM_MIN_HIT — kept for tests referencing the old band. */
export const CLOSE_GAME_SIM_CEILING = 0.54;
/** Aggressive alt lays (-2, -2.5, …) need sim support above this. */
export const COMFORTABLE_WIN_SIM_MIN = 0.55;

/** True when this line's cover probability is below the game-line sim floor. */
export function isCloseSimWinProb(winProb: number | null | undefined): boolean {
  if (winProb == null || !Number.isFinite(winProb)) return false;
  return winProb < GAME_LINE_SIM_MIN_HIT;
}

export function needsSaferSpreadLine(
  sim: CoachGameSimEntry | null | undefined,
  side: "home" | "away" | null,
  evalLines: RealOddsEntry[],
  teamName: string,
  rowSimHit?: number | null,
): boolean {
  if (rowSimHit != null && isCloseSimWinProb(rowSimHit)) return true;
  return isCloseGameForTeamSpread(sim, side, evalLines, teamName);
}

/** Standard main-board lay (-1.5) — blocked under the 52% sim floor. */
export function isStandardLaySpread(entry: RealOddsEntry): boolean {
  if (isMoneylineEntry(entry)) return false;
  if (!isSpreadFamilyMarket(entry.market)) return false;
  return spreadLineFromEntry(entry) === -1.5;
}

/** True when this spread/alt rung must not appear on the main ticket. */
export function spreadViolatesLadderPolicy(
  entry: RealOddsEntry,
  winProb: number | null,
  sim: CoachGameSimEntry | null | undefined,
  side: "home" | "away" | null,
  evalLines: RealOddsEntry[],
  teamName: string,
): boolean {
  if (isMoneylineEntry(entry)) return false;
  if (!isSpreadFamilyMarket(entry.market)) return false;
  const hit = winProb ?? 0;
  if (hit < GAME_LINE_SIM_MIN_HIT) {
    if (isStandardLaySpread(entry) || isAggressiveSpreadEntry(entry)) return true;
  }
  if (needsSaferSpreadLine(sim, side, evalLines, teamName, winProb)) {
    return !isSaferSpreadEntry(entry);
  }
  if (isAggressiveSpreadEntry(entry)) return hit < COMFORTABLE_WIN_SIM_MIN;
  return false;
}

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const t = norm(s).split(" ").filter(Boolean);
    return t[t.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function teamSideFromName(game: string, team: string): "home" | "away" | null {
  const parts = game.split(" @ ");
  if (parts.length !== 2) return null;
  const away = parts[0]!.trim();
  const home = parts[1]!.trim();
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

function isSpreadFamilyMarket(market: string): boolean {
  return /spread|run ?line|puck ?line/i.test(String(market ?? ""));
}

export function isMoneylineEntry(entry: RealOddsEntry): boolean {
  return /^moneyline$/i.test(String(entry.market ?? "").trim());
}

export function spreadLineFromEntry(entry: RealOddsEntry): number | null {
  return spreadLineFromPick(entry.pick);
}

/** Aggressive alt lays: -2, -2.5, -3.5, etc. */
export function isAggressiveSpreadEntry(entry: RealOddsEntry): boolean {
  if (isMoneylineEntry(entry)) return false;
  if (!isSpreadFamilyMarket(entry.market)) return false;
  const line = spreadLineFromEntry(entry);
  return line != null && line <= -2;
}

/**
 * Safer rungs on close projections: ML, -1, small hooks, and plus-points
 * (+1.5, +2.5). Standard -1.5 lays and deeper alt lays are excluded.
 */
export function isSaferSpreadEntry(entry: RealOddsEntry): boolean {
  if (isMoneylineEntry(entry)) return true;
  if (!isSpreadFamilyMarket(entry.market)) return false;
  const line = spreadLineFromEntry(entry);
  if (line == null) return false;
  if (line >= 1) return true;
  if (line === -1 || line === -0.5 || line === 0.5) return true;
  return false;
}

function isGameTotalEntry(entry: RealOddsEntry): boolean {
  return /\b(over|under)\b/i.test(entry.pick) && !/team total/i.test(entry.market);
}

function isTeamSidedFullGameEntry(entry: RealOddsEntry): boolean {
  const m = String(entry.market ?? "").trim();
  if (!/^(moneyline|spread|alt spread|total|alt total|team total)$/i.test(m)) return false;
  if (isGameTotalEntry(entry)) return false;
  return pickTeamName(entry.pick) != null;
}

function isQualifiedRow(row: CloseGameSpreadRow): boolean {
  const edge = row.edgePct ?? row.entry.edge ?? null;
  return isGameLineMainTicketQualified(row.finalAiScore, row.entry.odds ?? null, edge);
}

/** Close games: maximize cover probability, then edge. */
function rankSaferCloseGameLine(a: CloseGameSpreadRow, b: CloseGameSpreadRow): number {
  const aw = a.winProb ?? 0;
  const bw = b.winProb ?? 0;
  if (bw !== aw) return bw - aw;
  const ae = a.edgePct ?? -999;
  const be = b.edgePct ?? -999;
  return be - ae;
}

/** Comfortable wins: edge first, then cover probability. */
function rankComfortableSpreadLine(a: CloseGameSpreadRow, b: CloseGameSpreadRow): number {
  const ae = a.edgePct ?? -999;
  const be = b.edgePct ?? -999;
  if (be !== ae) return be - ae;
  const aw = a.winProb ?? 0;
  const bw = b.winProb ?? 0;
  return bw - aw;
}

function pickBest(rows: CloseGameSpreadRow[], rank: (a: CloseGameSpreadRow, b: CloseGameSpreadRow) => number): CloseGameSpreadRow | null {
  if (!rows.length) return null;
  return [...rows].sort(rank)[0]!;
}

/** On a coin-flip sim, pick the safest qualified ML / plus-points / -1 rung. */
export function selectBestSaferLineForCloseGame(
  ranked: CloseGameSpreadRow[],
): CloseGameSpreadRow | null {
  const eligible = ranked.filter(
    (r) => (isMoneylineEntry(r.entry) || isSaferSpreadEntry(r.entry)) && isQualifiedRow(r),
  );
  return pickBest(eligible, rankSaferCloseGameLine);
}

/** When the sim is not close, allow aggressive lays only with comfortable cover %. */
export function selectBestSpreadLineForOpenGame(
  ranked: CloseGameSpreadRow[],
): CloseGameSpreadRow | null {
  const eligible = ranked.filter((r) => {
    if (!isQualifiedRow(r)) return false;
    if (!isAggressiveSpreadEntry(r.entry)) return true;
    return (r.winProb ?? 0) >= COMFORTABLE_WIN_SIM_MIN;
  });
  return pickBest(eligible, rankComfortableSpreadLine);
}

/**
 * Unified team spread picker — close games search safer rungs; open games may
 * take aggressive alt lays only when sim cover is comfortable and edge is +EV.
 */
export function selectBestTeamSpreadLine(
  ranked: CloseGameSpreadRow[],
  sim: CoachGameSimEntry | null | undefined,
  evalLines: RealOddsEntry[],
  teamName: string,
  game: string,
  opts?: CloseGameSpreadOpts,
): CloseGameSpreadRow | null {
  if (opts?.longshotAsk) {
    return selectBestAltLineByEv(ranked, {
      qualify: (score, odds, edge) => isGameLineMainTicketQualified(score, odds, edge),
    });
  }
  const side = teamSideFromName(game, teamName);
  const close = needsSaferSpreadLine(
    sim,
    side,
    evalLines,
    teamName,
    ranked.reduce<number | null>((worst, r) => {
      const hit = r.winProb;
      if (hit == null) return worst;
      if (worst == null) return hit;
      return Math.min(worst, hit);
    }, null),
  );
  if (close) return selectBestSaferLineForCloseGame(ranked);
  return selectBestSpreadLineForOpenGame(ranked);
}

/** @deprecated Use selectBestSaferLineForCloseGame */
export function selectBestCloseGameAltSpread(
  ranked: CloseGameSpreadRow[],
): CloseGameSpreadRow | null {
  return selectBestSaferLineForCloseGame(ranked);
}

function resolveLineSimHit(
  pick: import("../components/PickCard.tsx").ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
): number | null {
  const fromScore = pick.finalAiScore?.simHit;
  if (fromScore != null && Number.isFinite(fromScore)) return fromScore;
  return gameSimHitForPick(pick, sim);
}

/** Drop or block spread legs that violate the close-game / aggressive-lay ladder. */
export function dropSpreadLadderViolations(
  picks: import("../components/PickCard.tsx").ParsedPick[],
  simByGame: Map<string, CoachGameSimEntry>,
  evalLinesByGame: Map<string, import("./api.ts").RealOddsEntry[]>,
  opts?: CloseGameSpreadOpts,
): import("../components/PickCard.tsx").ParsedPick[] {
  if (opts?.longshotAsk) return picks;
  return picks.filter((pick) => {
    if (pick.isProp) return true;
    const team = pickTeamName(pick.pick);
    if (!team) return true;
    const game = pick.game;
    let evalLines = evalLinesByGame.get(game) ?? [];
    if (!evalLines.length) {
      for (const [k, lines] of evalLinesByGame) {
        if (norm(k) === norm(game) || teamsMatch(k, game)) {
          evalLines = lines;
          break;
        }
      }
    }
    let sim = simByGame.get(game);
    if (!sim) {
      for (const [k, s] of simByGame) {
        if (teamsMatch(k, game)) {
          sim = s;
          break;
        }
      }
    }
    const side = teamSideFromName(game, team);
    const entry: RealOddsEntry = {
      sport: pick.sport ?? "mlb",
      game,
      market: pick.market,
      pick: pick.pick,
      odds: pick.odds ?? -110,
    };
    const simHit = resolveLineSimHit(pick, sim);
    return !spreadViolatesLadderPolicy(entry, simHit, sim, side, evalLines, team);
  });
}

/**
 * Enforce spread ladder policy across evaluated game lines.
 * Close games → safest +EV rung; aggressive lays gated on comfortable sim cover.
 */
export function filterRowsForCloseGameSpread(
  rows: CloseGameSpreadRow[],
  sim: CoachGameSimEntry | null | undefined,
  evalLines: RealOddsEntry[],
  opts?: CloseGameSpreadOpts,
): CloseGameSpreadRow[] {
  if (!sim || !rows.length) {
    return rows.filter(
      (r) =>
        !isAggressiveSpreadEntry(r.entry) ||
        (r.winProb ?? 0) >= COMFORTABLE_WIN_SIM_MIN,
    );
  }

  const byTeam = new Map<string, CloseGameSpreadRow[]>();
  for (const row of rows) {
    const team = pickTeamName(row.entry.pick);
    if (!team || !isTeamSidedFullGameEntry(row.entry)) continue;
    const key = norm(team);
    const arr = byTeam.get(key) ?? [];
    arr.push(row);
    byTeam.set(key, arr);
  }

  const keep = new Set<CloseGameSpreadRow>();
  const drop = new Set<CloseGameSpreadRow>();

  for (const [, teamRows] of byTeam) {
    const team = pickTeamName(teamRows[0]!.entry.pick);
    if (!team) continue;
    const game = teamRows[0]!.entry.game;
    const best = selectBestTeamSpreadLine(teamRows, sim, evalLines, team, game, opts);

    if (!best) {
      for (const row of teamRows) {
        if (isTeamSidedFullGameEntry(row.entry) && !isGameTotalEntry(row.entry)) drop.add(row);
      }
      continue;
    }

    keep.add(best);
    for (const row of teamRows) {
      if (isTeamSidedFullGameEntry(row.entry) && !isGameTotalEntry(row.entry) && row !== best) {
        drop.add(row);
      }
    }
  }

  return rows.filter((r) => {
    if (drop.has(r)) return false;
    if (keep.has(r)) return true;
    if (opts?.longshotAsk) return true;
    const team = pickTeamName(r.entry.pick);
    if (team && isTeamSidedFullGameEntry(r.entry) && !isGameTotalEntry(r.entry)) {
      const side = teamSideFromName(r.entry.game, team);
      if (
        spreadViolatesLadderPolicy(r.entry, r.winProb, sim, side, evalLines, team)
      ) {
        return false;
      }
    }
    return true;
  });
}
