// Frozen game-line qualification — no imports from parlayQualifiedGate (avoids cycles).

import type { ParsedPick } from "../components/PickCard.tsx";
import { gradeRank } from "./finalAiScore.ts";

const MIN_GRADE = "C+";
const MIN_CONFIDENCE = 50;
const PLACEHOLDER = /^[—\-]+$/;
const PLACEHOLDER_GRADE = /^(?:[—\-]+|--|n\/a|null)$/i;

/** Sub-50% sim needs at least this edge % to finalize. */
export const GAME_LINE_EXCEPTIONAL_EDGE_PCT = 4.5;
export const GAME_LINE_MIN_SIM_PCT = 50;
export const GAME_LINE_STRONG_EV_PCT = 3;

export class GameLineFinalizeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameLineFinalizeRejected";
  }
}

function isRealGrade(grade: string | null | undefined): grade is string {
  return (
    !!grade &&
    grade.trim() !== "" &&
    !PLACEHOLDER.test(grade.trim()) &&
    !PLACEHOLDER_GRADE.test(grade.trim()) &&
    gradeRank(grade) >= gradeRank(MIN_GRADE)
  );
}

function simPctFromHit(simHit: number): number {
  return Math.round(simHit * 100);
}

/**
 * Sim / edge bar for finalized game lines:
 * - sim > 50%: pass
 * - sim === 50%: strong +EV, best-EV line, or edge ≥ 3%
 * - sim < 50%: edge ≥ 4.5% only
 */
export function gameLineSimEdgeQualifies(
  simHit: number,
  edgePct: number,
  opts?: { evPct?: number | null; isBestEvLine?: boolean },
): boolean {
  if (!Number.isFinite(simHit) || !Number.isFinite(edgePct) || edgePct <= 0) return false;
  const simPct = simPctFromHit(simHit);
  if (simPct > GAME_LINE_MIN_SIM_PCT) return true;
  if (simPct === GAME_LINE_MIN_SIM_PCT) {
    if (opts?.isBestEvLine) return true;
    const ev = opts?.evPct;
    if (ev != null && Number.isFinite(ev) && ev >= GAME_LINE_STRONG_EV_PCT) return true;
    return edgePct >= GAME_LINE_STRONG_EV_PCT;
  }
  return edgePct >= GAME_LINE_EXCEPTIONAL_EDGE_PCT;
}

export type GameLineFinalizeMetrics = {
  grade: string | null | undefined;
  confidencePct: number | null | undefined;
  simHit: number | null | undefined;
  edgePct: number | null | undefined;
  evPct?: number | null;
  market?: string | null;
  isBestEvLine?: boolean;
};

/**
 * Hard fail before freeze/finalize when any required metric is missing or the
 * sim/edge bar is not met. Never allow placeholder dashes to reach the UI.
 */
export function assertGameLineFinalizeMetrics(
  pick: ParsedPick,
  metrics: GameLineFinalizeMetrics,
): void {
  const label = `${pick.pick ?? "?"} (${pick.game ?? "?"})`;

  if (!isRealGrade(metrics.grade)) {
    throw new GameLineFinalizeRejected(`${label}: missing Final AI Grade`);
  }
  if (
    metrics.confidencePct == null ||
    !Number.isFinite(metrics.confidencePct) ||
    metrics.confidencePct < MIN_CONFIDENCE
  ) {
    throw new GameLineFinalizeRejected(`${label}: missing or sub-threshold Confidence`);
  }
  if (metrics.simHit == null || !Number.isFinite(metrics.simHit)) {
    throw new GameLineFinalizeRejected(`${label}: missing Simulation %`);
  }
  if (metrics.edgePct == null || !Number.isFinite(metrics.edgePct) || metrics.edgePct <= 0) {
    throw new GameLineFinalizeRejected(`${label}: missing Edge %`);
  }
  if (!metrics.market?.trim()) {
    throw new GameLineFinalizeRejected(`${label}: missing final selected market`);
  }

  const simPct = simPctFromHit(metrics.simHit);
  if (simPct < GAME_LINE_MIN_SIM_PCT && metrics.edgePct < GAME_LINE_EXCEPTIONAL_EDGE_PCT) {
    throw new GameLineFinalizeRejected(
      `${label}: sim ${simPct}% < ${GAME_LINE_MIN_SIM_PCT}% requires edge ≥ ${GAME_LINE_EXCEPTIONAL_EDGE_PCT}%`,
    );
  }
  if (
    !gameLineSimEdgeQualifies(metrics.simHit, metrics.edgePct, {
      evPct: metrics.evPct,
      isBestEvLine: metrics.isBestEvLine ?? pick.gameLineFinal?.isBestEv,
    })
  ) {
    throw new GameLineFinalizeRejected(
      `${label}: sim ${simPct}% does not meet game-line sim / edge qualification`,
    );
  }
}

/** True when gameLineFinal.display has every metric surfaces must show — no placeholders. */
export function gameLineFrozenMetricsComplete(pick: ParsedPick): boolean {
  if (!pick.gameLineFrozen || pick.gameLineFinal?.frozenAt == null) return false;
  const d = pick.gameLineFinal.display;
  if (!d) return false;
  try {
    assertGameLineFinalizeMetrics(pick, {
      grade: d.grade,
      confidencePct: d.confidencePct,
      simHit: d.simHit,
      edgePct: d.edgePct,
      evPct: d.evPct,
      market: d.market,
      isBestEvLine: pick.gameLineFinal.isBestEv,
    });
    return true;
  } catch {
    return false;
  }
}
