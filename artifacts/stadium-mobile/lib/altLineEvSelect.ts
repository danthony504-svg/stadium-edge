// Game-line selection — rank every posted rung by weighted Final Score.

import type { RealOddsEntry } from "./api.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import {
  isCloseSimBand,
  rankGameLineByFinalScore,
  resolveRowExpectedValue,
  type GameLineScoreRow,
} from "./gameLineFinalScore.ts";
import {
  GAME_LINE_EXCEPTIONAL_EV_PCT,
  isGameLineMainTicketQualified,
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
};

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
    {
      evPct: ev,
      bookSpread: row.entry.bookSpread ?? null,
      finalAiScore: row.finalAiScore,
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
  mainLine?: CloseGameSpreadRow | null,
): string {
  const main = mainLine ?? findMainSpreadRow(allRows);
  if (!main || main.entry === selected.entry) {
    return "Selected because it had the highest Final Score.";
  }

  const mainSim = main.winProb ?? main.finalAiScore.simHit ?? null;
  const mainRejected =
    isCloseSimBand(mainSim) &&
    (isStandardLaySpread(main.entry) || !isSaferSpreadEntry(main.entry));

  if (mainRejected) {
    const alt = isMoneylineEntry(selected.entry)
      ? "Moneyline"
      : `Alt ${spreadLineLabel(selected)}`;
    return `Main line rejected. ${alt} selected — highest Final Score among safer +EV lines.`;
  }

  const mainEv = resolveRowExpectedValue(main);
  const selEv = resolveRowExpectedValue(selected);
  if (
    selEv != null &&
    mainEv != null &&
    selEv > mainEv + 0.05 &&
    selected.entry !== main.entry
  ) {
    const alt = isMoneylineEntry(selected.entry)
      ? "Moneyline"
      : `Alt ${spreadLineLabel(selected)}`;
    return `${alt} had higher EV.`;
  }

  return "Selected because it had the highest Final Score.";
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
    qualify?: (row: CloseGameSpreadRow) => boolean;
  },
): GameLineSelectionResult | null {
  const qualify = opts?.qualify ?? gameLineRowQualifies;
  const eligible = ranked.filter(qualify);
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

  return {
    row: best,
    reason: buildGameLineSelectionReason(best, ranked),
  };
}

/**
 * Compare every posted rung and return the qualified line with the highest
 * weighted Final Score (40% EV · 30% sim · 15% conf · 10% grade · 5% market).
 */
export function selectBestGameLineByEv(
  ranked: CloseGameSpreadRow[],
  opts?: {
    qualify?: (row: CloseGameSpreadRow) => boolean;
  },
): CloseGameSpreadRow | null {
  return selectBestGameLineByFinalScore(ranked, opts)?.row ?? null;
}

/** Full selection with transparency reason. */
export function selectBestGameLineWithReason(
  ranked: CloseGameSpreadRow[],
  opts?: {
    qualify?: (row: CloseGameSpreadRow) => boolean;
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

/** @deprecated Use rankGameLineByFinalScore */
export const rankAltLineByValue = rankGameLineByEv;
