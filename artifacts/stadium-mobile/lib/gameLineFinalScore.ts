// Weighted Final Score for game-line selection — ranks every posted rung.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import { americanToDecimal } from "./format.ts";
import { gradeRank } from "./finalAiScore.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { americanToImplied } from "./pickScore.ts";
import type { PickEdgeResolveOpts } from "./parlayQualifiedGate.ts";
import { resolvePickEdgePct } from "./parlayQualifiedGate.ts";

/** Row shape for game-line scoring (mirrors CloseGameSpreadRow). */
export type GameLineScoreRow = {
  entry: RealOddsEntry;
  finalAiScore: FinalAiScore;
  winProb: number | null;
  edgePct: number | null;
};

/** Coin-flip band — search safer alts before skipping the game. */
export const CLOSE_SIM_BAND_LOW = 0.48;
export const CLOSE_SIM_BAND_HIGH = 0.52;

/** Final Score = 40% EV · 30% sim · 15% conf · 10% grade · 5% market movement */
export const GAME_LINE_FINAL_SCORE_WEIGHTS = {
  ev: 0.4,
  sim: 0.3,
  confidence: 0.15,
  grade: 0.1,
  marketMovement: 0.05,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export type GameLineFinalScoreBreakdown = {
  ev: number | null;
  sim: number | null;
  confidence: number | null;
  grade: number | null;
  marketMovement: number | null;
  normEv: number;
  normSim: number;
  normConfidence: number;
  normGrade: number;
  normMarketMovement: number;
  finalScore: number;
};

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

export function resolveRowExpectedValue(row: GameLineScoreRow): number | null {
  const edge = row.edgePct ?? row.entry.edge ?? null;
  return expectedValuePct(
    row.winProb,
    row.entry.odds ?? null,
    row.entry.noVigFair ?? null,
    edge,
  );
}

export function isCloseSimBand(winProb: number | null | undefined): boolean {
  if (winProb == null || !Number.isFinite(winProb)) return false;
  return winProb >= CLOSE_SIM_BAND_LOW && winProb <= CLOSE_SIM_BAND_HIGH;
}

function normEvPct(ev: number | null): number {
  if (ev == null || !Number.isFinite(ev) || ev <= 0) return 0;
  return clamp01(ev / 8);
}

function normSim(sim: number | null): number {
  if (sim == null || !Number.isFinite(sim)) return 0;
  return clamp01(sim);
}

function normConfidence(conf: number | null): number {
  if (conf == null || !Number.isFinite(conf)) return 0.5;
  return clamp01(conf / 100);
}

function normGradeScore(grade: string | null | undefined): number {
  const rank = gradeRank(grade);
  if (rank < 0) return 0;
  return clamp01(rank / 10);
}

/** Market / sharp line movement from cross-book spread or rubric line-shopping. */
function normMarketMovement(row: GameLineScoreRow): number {
  const spread = row.entry.bookSpread;
  if (spread != null && Number.isFinite(spread)) {
    return clamp01(spread / 15);
  }
  const shopping = row.finalAiScore.rubric?.scores?.lineShopping;
  if (shopping != null && Number.isFinite(shopping)) {
    return clamp01(shopping / 10);
  }
  return 0.5;
}

export function computeGameLineFinalScoreBreakdown(
  row: GameLineScoreRow,
): GameLineFinalScoreBreakdown {
  const ev = resolveRowExpectedValue(row);
  const sim = row.winProb ?? row.finalAiScore.simHit ?? null;
  const confidence = row.finalAiScore.confidencePct ?? null;
  const grade = row.finalAiScore.grade ?? null;

  const nEv = normEvPct(ev);
  const nSim = normSim(sim);
  const nConf = normConfidence(confidence);
  const nGrade = normGradeScore(grade);
  const nMarket = normMarketMovement(row);

  const w = GAME_LINE_FINAL_SCORE_WEIGHTS;
  const finalScore = round1(
    100 *
      (w.ev * nEv +
        w.sim * nSim +
        w.confidence * nConf +
        w.grade * nGrade +
        w.marketMovement * nMarket),
  );

  return {
    ev,
    sim,
    confidence,
    grade: gradeRank(grade) >= 0 ? gradeRank(grade) : null,
    marketMovement: row.entry.bookSpread ?? row.finalAiScore.rubric?.scores?.lineShopping ?? null,
    normEv: nEv,
    normSim: nSim,
    normConfidence: nConf,
    normGrade: nGrade,
    normMarketMovement: nMarket,
    finalScore,
  };
}

export function computeGameLineFinalScore(row: GameLineScoreRow): number {
  return computeGameLineFinalScoreBreakdown(row).finalScore;
}

/** Rank game lines by weighted Final Score, then EV, sim, payout. */
export function rankGameLineByFinalScore(a: GameLineScoreRow, b: GameLineScoreRow): number {
  const fsA = computeGameLineFinalScore(a);
  const fsB = computeGameLineFinalScore(b);
  if (fsB !== fsA) return fsB - fsA;

  const evA = resolveRowExpectedValue(a) ?? -999;
  const evB = resolveRowExpectedValue(b) ?? -999;
  if (evB !== evA) return evB - evA;

  const wpA = a.winProb ?? a.finalAiScore.simHit ?? 0;
  const wpB = b.winProb ?? b.finalAiScore.simHit ?? 0;
  if (wpB !== wpA) return wpB - wpA;

  return (b.entry.odds ?? -9999) - (a.entry.odds ?? -9999);
}

export function pickToGameLineScoreRow(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): GameLineScoreRow | null {
  if (!pick.finalAiScore) return null;
  const edge = resolvePickEdgePct(pick, opts);
  let bookSpread: number | null = null;
  if (opts?.realOdds?.length) {
    const row = opts.realOdds.find(
      (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
    );
    bookSpread = row?.bookSpread ?? null;
  }
  return {
    entry: {
      sport: pick.sport ?? "mlb",
      game: pick.game,
      market: pick.market,
      pick: pick.pick,
      odds: pick.odds ?? -110,
      edge: edge ?? pick.finalAiScore.edgePct ?? null,
      bookSpread,
    },
    finalAiScore: pick.finalAiScore,
    winProb: pick.finalAiScore.simHit,
    edgePct: edge ?? pick.finalAiScore.edgePct ?? null,
  };
}

export function computePickFinalScore(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): number | null {
  const row = pickToGameLineScoreRow(pick, opts);
  if (!row) return null;
  const ev = resolveRowExpectedValue(row);
  if (ev == null || ev <= 0) return null;
  return computeGameLineFinalScore(row);
}
