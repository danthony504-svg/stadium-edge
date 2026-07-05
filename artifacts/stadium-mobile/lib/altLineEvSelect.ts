// Longshot parlay line selection — compare every posted alt rung by expected value.

import type { RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { americanToImplied } from "./pickScore.ts";
import { americanToDecimal } from "./format.ts";
import { LONGSHOT_SIM_MIN_HIT } from "./parlayQualifiedGate.ts";
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
 * Rank alt lines for longshot builds: EV first, then edge, win probability, payout.
 */
export function rankAltLineByValue(a: CloseGameSpreadRow, b: CloseGameSpreadRow): number {
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

function pickBest(
  rows: CloseGameSpreadRow[],
  rank: (a: CloseGameSpreadRow, b: CloseGameSpreadRow) => number,
): CloseGameSpreadRow | null {
  if (!rows.length) return null;
  return [...rows].sort(rank)[0]!;
}

function longshotRowEligible(
  row: CloseGameSpreadRow,
  minSim: number,
  qualify: (score: FinalAiScore | null | undefined, odds: number | null, edge: number | null) => boolean,
): boolean {
  const edge = row.edgePct ?? row.entry.edge ?? null;
  if (edge == null || !Number.isFinite(edge) || edge < 0) return false;
  const wp = row.winProb;
  if (wp == null || !Number.isFinite(wp) || wp < minSim) return false;
  const ev = resolveRowExpectedValue(row);
  if (ev == null || ev <= 0) return false;
  return qualify(row.finalAiScore, row.entry.odds ?? null, edge);
}

/**
 * On close longshot sims, search every posted alt rung (ML, spreads, team totals, …)
 * and return the line with the best overall value — never force a specific rung.
 */
export function selectBestAltLineByEv(
  ranked: CloseGameSpreadRow[],
  opts?: {
    minSim?: number;
    qualify?: (score: FinalAiScore | null | undefined, odds: number | null, edge: number | null) => boolean;
  },
): CloseGameSpreadRow | null {
  const minSim = opts?.minSim ?? LONGSHOT_SIM_MIN_HIT;
  const qualify =
    opts?.qualify ??
    ((score, odds, edge) => {
      void score;
      void odds;
      void edge;
      return true;
    });
  const eligible = ranked.filter((r) => longshotRowEligible(r, minSim, qualify));
  return pickBest(eligible, rankAltLineByValue);
}

/** @deprecated Use selectBestAltLineByEv */
export function selectBestLongshotAltLine(ranked: CloseGameSpreadRow[]): CloseGameSpreadRow | null {
  return selectBestAltLineByEv(ranked);
}
