// Pick the best-value alternate line — not the safest / highest hit-rate rung.

import type { ParsedPick } from "../components/PickCard.tsx";
import { americanToDecimal, impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import { gameSimHitForPick } from "./gameSimScoring.ts";

/** Exclude buried juice (e.g. -850 alt spreads) from alternate promotion. */
export const ALT_LADDER_MAX_CHALK_ODDS = -400;

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export function payoutProfitPerDollar(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return -1;
  return americanToDecimal(odds) - 1;
}

/** Heavy favorites with almost no payout — safe but not value. */
export function isBuriedChalk(odds: number): boolean {
  if (!Number.isFinite(odds)) return true;
  if (odds <= ALT_LADDER_MAX_CHALK_ODDS) return true;
  if (odds < 0) {
    const imp = impliedProb(odds);
    const profit = payoutProfitPerDollar(odds);
    if (imp > 0.82 && profit < 0.25) return true;
  }
  return false;
}

export type AlternateValueMetrics = {
  edgePct: number;
  evPct: number;
  confidencePct: number;
  grade: string | null;
  payoutProfit: number;
  simHit: number | null;
};

export function metricsForAlternate(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): AlternateValueMetrics | null {
  const edgePct = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const odds = pick.odds;
  if (edgePct == null || edgePct <= 0 || odds == null || !Number.isFinite(odds)) return null;
  if (isBuriedChalk(odds)) return null;

  const simHit =
    pick.isProp && propHit != null
      ? propHit
      : (pick.finalAiScore?.simHit ?? gameSimHitForPick(pick, sim ?? null));
  if (simHit == null || !Number.isFinite(simHit)) return null;

  const evPct = simEvPct(simHit, odds);
  if (evPct == null || evPct <= 0) return null;

  return {
    edgePct,
    evPct,
    confidencePct: pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? 0,
    grade: pick.finalAiScore?.grade ?? null,
    payoutProfit: payoutProfitPerDollar(odds),
    simHit,
  };
}

/**
 * Composite value score for ranking alternates. Sim hit is tracked for gates
 * but intentionally excluded from ranking so we don't always pick the safest line.
 */
export function alternateOverallValueScore(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): number | null {
  const m = metricsForAlternate(pick, sim, propHit);
  if (!m) return null;
  return (
    m.evPct * 5 +
    m.edgePct * 2 +
    m.payoutProfit * 3 +
    gradeRank(m.grade) * 0.2 +
    m.confidencePct * 0.03
  );
}

export function formatAlternateValueNote(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
): string {
  const m = metricsForAlternate(pick, sim, propHit);
  if (!m) return "";
  const oddsStr =
    pick.odds != null && Number.isFinite(pick.odds)
      ? pick.odds > 0
        ? `+${pick.odds}`
        : `${pick.odds}`
      : "—";
  return `${m.evPct}% EV, ${m.edgePct > 0 ? "+" : ""}${m.edgePct}% edge, ${m.grade ?? "—"} grade, ${m.confidencePct}% confidence, ${oddsStr} payout`;
}
