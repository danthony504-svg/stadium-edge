// Game-line selection — rank every posted rung by expected value (EV).

import type { RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { americanToImplied } from "./pickScore.ts";
import { americanToDecimal } from "./format.ts";
import {
  GAME_LINE_EXCEPTIONAL_EV_PCT,
  isGameLineMainTicketQualified,
} from "./parlayQualifiedGate.ts";
import type { CloseGameSpreadRow } from "./closeGameSpreadSelect.ts";

/** Expected value in pct points per $1 staked: (winProb × decimalOdds − 1) × 100. */
export function expectedValuePct(
  winProb: number | null | undefined,
  american: number | null | undefined,
  fairProb?: number | null,
  edgePct?: number | null,
): number | null {
  if (american == null || !Number.isFinite(american) || american === 0) return null;
  const decimal = americanToDecimal(american);

  let p = fairProb;
  if (p == null || !Number.isFinite(p) || p <= 0 || p > 1) {
    if (winProb != null && Number.isFinite(winProb) && winProb > 0 && winProb <= 1) {
      p = winProb;
    }
  }
  if (p == null) {
    const implied = americanToImplied(american);
    if (implied != null && edgePct != null && Number.isFinite(edgePct)) {
      p = implied + edgePct / 100;
    }
  }
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  return Math.round((p * decimal - 1) * 1000) / 10;
}

export function resolveRowExpectedValue(row: CloseGameSpreadRow): number | null {
  const edge = row.edgePct ?? row.entry.edge ?? null;
  return expectedValuePct(
    row.winProb,
    row.entry.odds ?? null,
    row.entry.noVigFair ?? null,
    edge,
  );
}

/**
 * Rank game lines: EV first, then edge, win probability, payout.
 */
export function rankGameLineByEv(a: CloseGameSpreadRow, b: CloseGameSpreadRow): number {
  const evA = resolveRowExpectedValue(a) ?? -999;
  const evB = resolveRowExpectedValue(b) ?? -999;
  if (evB !== evA) return evB - evA;

  const edgeA = a.edgePct ?? a.entry.edge ?? -999;
  const edgeB = b.edgePct ?? b.entry.edge ?? -999;
  if (edgeB !== edgeA) return edgeB - edgeA;

  const wpA = a.winProb ?? 0;
  const wpB = b.winProb ?? 0;
  if (wpB !== wpA) return wpB - wpA;

  const oddsA = a.entry.odds ?? -9999;
  const oddsB = b.entry.odds ?? -9999;
  return oddsB - oddsA;
}

/** @deprecated Use rankGameLineByEv */
export const rankAltLineByValue = rankGameLineByEv;

function pickBest(
  rows: CloseGameSpreadRow[],
  rank: (a: CloseGameSpreadRow, b: CloseGameSpreadRow) => number,
): CloseGameSpreadRow | null {
  if (!rows.length) return null;
  return [...rows].sort(rank)[0]!;
}

/** Shared qualification read for a scored game-line row. */
export function gameLineRowQualifies(row: CloseGameSpreadRow): boolean {
  const edge = row.edgePct ?? row.entry.edge ?? null;
  const ev = resolveRowExpectedValue(row);
  if (edge == null || edge <= 0) return false;
  if (ev == null || ev <= 0) return false;
  return isGameLineMainTicketQualified(
    row.finalAiScore,
    row.entry.odds ?? null,
    edge,
    ev,
  );
}

/**
 * Compare every posted rung (ML, spread, alt spread, total, team total, …) and
 * return the qualified line with the highest EV — never the first line that
 * merely clears a sim floor.
 */
export function selectBestGameLineByEv(
  ranked: CloseGameSpreadRow[],
  opts?: {
    qualify?: (row: CloseGameSpreadRow) => boolean;
  },
): CloseGameSpreadRow | null {
  const qualify = opts?.qualify ?? gameLineRowQualifies;
  const eligible = ranked.filter(qualify);
  return pickBest(eligible, rankGameLineByEv);
}

/** @deprecated Use selectBestGameLineByEv */
export function selectBestAltLineByEv(
  ranked: CloseGameSpreadRow[],
  opts?: {
    minSim?: number;
    qualify?: (score: FinalAiScore | null | undefined, odds: number | null, edge: number | null) => boolean;
  },
): CloseGameSpreadRow | null {
  void opts?.minSim;
  return selectBestGameLineByEv(ranked, {
    qualify: opts?.qualify
      ? (row) => {
          const edge = row.edgePct ?? row.entry.edge ?? null;
          return opts.qualify!(row.finalAiScore, row.entry.odds ?? null, edge);
        }
      : undefined,
  });
}

/** @deprecated Use selectBestGameLineByEv */
export function selectBestLongshotAltLine(ranked: CloseGameSpreadRow[]): CloseGameSpreadRow | null {
  return selectBestGameLineByEv(ranked);
}

export { GAME_LINE_EXCEPTIONAL_EV_PCT };
