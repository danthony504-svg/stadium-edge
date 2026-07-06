// Game-line selection — rank every posted rung by weighted Final Score.

import type { RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  isCloseSimBand,
  computeGameLineFinalScoreBreakdown,
  rankGameLineByFinalScore,
  resolveRowExpectedValue,
  type GameLineScoreRow,
} from "./gameLineFinalScore.ts";
import {
  GAME_LINE_EXCEPTIONAL_EV_PCT,
  GAME_LINE_STRONG_EV_PCT,
  isGameLineMainTicketQualified,
  isSimAboveFifty,
  isSimExactlyFifty,
} from "./parlayQualifiedGate.ts";
import type { CloseGameSpreadRow } from "./closeGameSpreadSelect.ts";
import { spreadLineFromPick } from "./spreadSimAlignment.ts";

export { expectedValuePct, resolveRowExpectedValue } from "./gameLineFinalScore.ts";

function isMoneylineEntry(entry: RealOddsEntry): boolean {
  return /^moneyline$/i.test(String(entry.market ?? "").trim());
}

function isSpreadFamilyMarket(market: string): boolean {
  return /spread|run ?line|puck ?line/i.test(String(market ?? ""));
}

function spreadLineFromEntry(entry: RealOddsEntry): number | null {
  return spreadLineFromPick(entry.pick);
}

function isStandardLaySpread(entry: RealOddsEntry): boolean {
  if (isMoneylineEntry(entry)) return false;
  if (!isSpreadFamilyMarket(entry.market)) return false;
  return spreadLineFromEntry(entry) === -1.5;
}

function isSaferSpreadEntry(entry: RealOddsEntry): boolean {
  if (isMoneylineEntry(entry)) return true;
  if (!isSpreadFamilyMarket(entry.market)) return false;
  const line = spreadLineFromEntry(entry);
  if (line == null) return false;
  if (line >= 1) return true;
  if (line === -1 || line === -0.5 || line === 0.5) return true;
  return false;
}

export type GameLineSelectionResult = {
  row: CloseGameSpreadRow;
  reason: string;
  bullets: string[];
};

function marketFamilyLabel(market: string): string {
  const m = String(market ?? "").toLowerCase();
  if (/moneyline/.test(m)) return "Moneyline";
  if (/alt.*spread|alternate spread/.test(m)) return "Alt Spread";
  if (/spread|run ?line|puck ?line/.test(m)) return "Spread";
  if (/alt.*total/.test(m)) return "Alt Total";
  if (/team total/.test(m)) return "Team Total";
  if (/total|over|under|o\/u/.test(m)) return "Total";
  return String(market ?? "Line").trim() || "Line";
}

/** True when this row's +EV is highest among every posted rung (within 0.05 pts). */
export function isBestEvAmongRows(
  row: CloseGameSpreadRow,
  allRows: CloseGameSpreadRow[],
): boolean {
  const selEv = resolveRowExpectedValue(row);
  if (selEv == null || selEv <= 0) return false;
  let maxEv = -Infinity;
  for (const r of allRows) {
    const ev = resolveRowExpectedValue(r);
    if (ev != null && ev > maxEv) maxEv = ev;
  }
  return maxEv > 0 && selEv >= maxEv - 0.05;
}

/** Short headline for cards — Highest EV, Simulation Favorite, Best Alt Line, etc. */
export function primaryGameLineWinLabel(
  selected: CloseGameSpreadRow,
  allRows: CloseGameSpreadRow[],
): string {
  const sim = selected.winProb ?? selected.finalAiScore.simHit ?? null;
  const selEv = resolveRowExpectedValue(selected);
  const market = String(selected.entry.market ?? "").toLowerCase();
  if (isBestEvAmongRows(selected, allRows) && selEv != null && selEv > 0) {
    return "Highest EV";
  }
  if (isSimAboveFifty(sim)) return "Simulation Favorite";
  if (isSimExactlyFifty(sim) && selEv != null && selEv >= GAME_LINE_STRONG_EV_PCT) {
    return "Strong +EV";
  }
  if (/alt|team total/.test(market)) return "Best Alt Line";
  return "Best Line";
}

/** Plain-English bullets explaining why this rung won selection. */
export function buildGameLineSelectionBullets(
  selected: CloseGameSpreadRow,
  allRows: CloseGameSpreadRow[],
): string[] {
  const bullets: string[] = [];
  const qualified = allRows.filter((r) => gameLineRowQualifies(r, allRows));
  const selEv = resolveRowExpectedValue(selected);
  const edge = selected.edgePct ?? selected.entry.edge ?? null;
  const sim = selected.winProb ?? selected.finalAiScore.simHit ?? null;
  const headline = primaryGameLineWinLabel(selected, allRows);
  bullets.push(headline);

  const maxEv = qualified.reduce((best, row) => {
    const ev = resolveRowExpectedValue(row);
    return ev != null && ev > best ? ev : best;
  }, -Infinity);

  if (isBestEvAmongRows(selected, allRows) && selEv != null && selEv > 0) {
    bullets.push("Highest EV among every posted line (ML, spread, alt, total)");
  }

  if (edge != null && edge > 0) {
    bullets.push(`+${edge}% edge`);
  }

  if (selEv != null && selEv > 0) {
    bullets.push(`+${selEv.toFixed(1)}% expected value`);
  }

  const selScore = computeGameLineFinalScoreBreakdown(selected).finalScore;
  const beatenFamilies = new Set<string>();
  for (const row of qualified) {
    if (row.entry === selected.entry) continue;
    const fam = marketFamilyLabel(row.entry.market);
    if (fam === marketFamilyLabel(selected.entry.market)) continue;
    const rowScore = computeGameLineFinalScoreBreakdown(row).finalScore;
    if (rowScore < selScore - 0.05) beatenFamilies.add(fam);
  }
  if (beatenFamilies.size > 0) {
    bullets.push(`Beat ${[...beatenFamilies].sort().join(" and ")} on Final Score`);
  }

  if (isSimAboveFifty(sim)) {
    bullets.push(`Simulation favorite (${Math.round((sim ?? 0) * 100)}% hit)`);
  } else if (isSimExactlyFifty(sim) && selEv != null && selEv >= GAME_LINE_STRONG_EV_PCT) {
    bullets.push(`Coin-flip sim (50%) cleared by strong +${selEv.toFixed(1)}% EV`);
  } else if (
    edge != null &&
    edge >= GAME_LINE_EXCEPTIONAL_EV_PCT &&
    selEv != null &&
    selEv >= GAME_LINE_EXCEPTIONAL_EV_PCT
  ) {
    bullets.push("Exceptional value — large +EV overcomes a coin-flip sim");
  }

  void maxEv;
  return [...new Set(bullets)];
}

function pickBest(
  rows: CloseGameSpreadRow[],
  rank: (a: CloseGameSpreadRow, b: CloseGameSpreadRow) => number,
): CloseGameSpreadRow | null {
  if (!rows.length) return null;
  return [...rows].sort(rank)[0]!;
}

/** Shared qualification read for a scored game-line row. */
export function gameLineRowQualifies(
  row: CloseGameSpreadRow,
  allRows?: CloseGameSpreadRow[],
): boolean {
  const edge = row.edgePct ?? row.entry.edge ?? null;
  const ev = resolveRowExpectedValue(row);
  if (edge == null || edge <= 0) return false;
  if (ev == null || ev <= 0) return false;
  const pool = allRows ?? [row];
  return isGameLineMainTicketQualified(
    row.finalAiScore,
    row.entry.odds ?? null,
    edge,
    ev,
    {
      evPct: ev,
      bookSpread: row.entry.bookSpread ?? null,
      finalAiScore: row.finalAiScore,
      isBestEvLine: isBestEvAmongRows(row, pool),
    },
  );
}

function spreadLineLabel(row: CloseGameSpreadRow): string {
  const line = spreadLineFromEntry(row.entry);
  if (line == null) return row.entry.pick;
  if (line > 0) return `+${line}`;
  return String(line);
}

function isTeamSidedSpreadRow(row: CloseGameSpreadRow): boolean {
  if (isMoneylineEntry(row.entry)) return true;
  return /spread|run ?line|puck ?line/i.test(String(row.entry.market ?? ""));
}

export function findMainSpreadRow(rows: CloseGameSpreadRow[]): CloseGameSpreadRow | null {
  return (
    rows.find((r) => isStandardLaySpread(r.entry)) ??
    rows.find((r) => /^spread$/i.test(String(r.entry.market ?? "").trim())) ??
    null
  );
}

export function buildGameLineSelectionReason(
  selected: CloseGameSpreadRow,
  allRows: CloseGameSpreadRow[],
  _mainLine?: CloseGameSpreadRow | null,
): string {
  void _mainLine;
  return buildGameLineSelectionBullets(selected, allRows).join(" · ");
}

function hasCloseSimTeamSpread(rows: CloseGameSpreadRow[]): boolean {
  return rows.some((r) => {
    if (!isTeamSidedSpreadRow(r)) return false;
    const sim = r.winProb ?? r.finalAiScore.simHit ?? null;
    return isCloseSimBand(sim);
  });
}

/**
 * Pick the qualified line with the highest Final Score across every market.
 * Never returns negative-EV lines. On 48–52% sim, prefers safer +EV alts first.
 */
export function selectBestGameLineByFinalScore(
  ranked: CloseGameSpreadRow[],
  opts?: {
    qualify?: (row: CloseGameSpreadRow, allRows: CloseGameSpreadRow[]) => boolean;
  },
): GameLineSelectionResult | null {
  const qualify =
    opts?.qualify ??
    ((row, all) => gameLineRowQualifies(row, all));
  const eligible = ranked.filter((r) => qualify(r, ranked));
  if (!eligible.length) return null;

  let pool = eligible;
  if (hasCloseSimTeamSpread(eligible)) {
    const safer = eligible.filter(
      (r) => isSaferSpreadEntry(r.entry) || isMoneylineEntry(r.entry),
    );
    if (safer.length) pool = safer;
  }

  const best = pickBest(pool, rankGameLineByFinalScore as (a: GameLineScoreRow, b: GameLineScoreRow) => number);
  if (!best) return null;

  const bullets = buildGameLineSelectionBullets(best, ranked);
  const headline = primaryGameLineWinLabel(best, ranked);
  return {
    row: best,
    reason: headline,
    bullets,
  };
}

/**
 * Compare every posted rung and return the qualified line with the highest
 * weighted Final Score (40% EV · 30% sim · 15% conf · 10% grade · 5% market).
 */
export function selectBestGameLineByEv(
  ranked: CloseGameSpreadRow[],
  opts?: {
    qualify?: (row: CloseGameSpreadRow, allRows: CloseGameSpreadRow[]) => boolean;
  },
): CloseGameSpreadRow | null {
  return selectBestGameLineByFinalScore(ranked, opts)?.row ?? null;
}

/** Full selection with transparency reason. */
export function selectBestGameLineWithReason(
  ranked: CloseGameSpreadRow[],
  opts?: {
    qualify?: (row: CloseGameSpreadRow, allRows: CloseGameSpreadRow[]) => boolean;
  },
): GameLineSelectionResult | null {
  return selectBestGameLineByFinalScore(ranked, opts);
}

/** @deprecated Use rankGameLineByFinalScore from gameLineFinalScore.ts */
export function rankGameLineByEv(a: CloseGameSpreadRow, b: CloseGameSpreadRow): number {
  return rankGameLineByFinalScore(a, b);
}

/** @deprecated Use selectBestGameLineByEv */
export function selectBestAltLineByEv(
  ranked: CloseGameSpreadRow[],
  opts?: {
    minSim?: number;
    qualify?: (
      score: FinalAiScore | null | undefined,
      odds: number | null,
      edge: number | null,
    ) => boolean;
  },
): CloseGameSpreadRow | null {
  void opts?.minSim;
  return selectBestGameLineByEv(ranked, {
    qualify: opts?.qualify
      ? (row, all) => {
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

/** @deprecated Use rankGameLineByFinalScore */
export const rankAltLineByValue = rankGameLineByEv;
