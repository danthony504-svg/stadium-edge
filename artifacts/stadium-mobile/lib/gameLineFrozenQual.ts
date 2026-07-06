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

/** Why a finalized game line met the sim / edge bar — used for audits and debugging. */
export type GameLineQualificationReason = {
  simPct: number;
  edgePct: number;
  evPct: number | null;
  path:
    | "sim_above_50"
    | "sim_at_50_best_ev"
    | "sim_at_50_strong_ev"
    | "sim_at_50_edge"
    | "exceptional_edge";
  sim_above_50: boolean;
  exceptional_edge: boolean;
  strong_ev: boolean;
  best_ev_line: boolean;
  edge_at_50_sim: boolean;
  summary: string;
};

/** Explain which qualification path accepted a game line (especially sub-50% exceptions). */
export function explainGameLineQualification(
  pick: ParsedPick,
  metrics?: GameLineFinalizeMetrics,
): GameLineQualificationReason {
  const d = pick.gameLineFinal?.display;
  const simHit = metrics?.simHit ?? d?.simHit ?? pick.finalAiScore?.simHit;
  const edgePct = metrics?.edgePct ?? d?.edgePct ?? pick.finalAiScore?.edgePct;
  const evPct = metrics?.evPct ?? d?.evPct ?? pick.finalAiScore?.edgePct ?? null;
  const isBestEvLine = metrics?.isBestEvLine ?? pick.gameLineFinal?.isBestEv ?? false;

  if (simHit == null || !Number.isFinite(simHit) || edgePct == null || !Number.isFinite(edgePct)) {
    throw new GameLineFinalizeRejected(
      `${pick.pick ?? "?"} (${pick.game ?? "?"}): cannot explain qualification without sim and edge`,
    );
  }

  const simPct = simPctFromHit(simHit);
  const exceptional_edge = simPct < GAME_LINE_MIN_SIM_PCT && edgePct >= GAME_LINE_EXCEPTIONAL_EDGE_PCT;
  const best_ev_line = simPct === GAME_LINE_MIN_SIM_PCT && isBestEvLine;
  const strong_ev =
    simPct === GAME_LINE_MIN_SIM_PCT &&
    evPct != null &&
    Number.isFinite(evPct) &&
    evPct >= GAME_LINE_STRONG_EV_PCT;
  const edge_at_50_sim = simPct === GAME_LINE_MIN_SIM_PCT && edgePct >= GAME_LINE_STRONG_EV_PCT;
  const sim_above_50 = simPct > GAME_LINE_MIN_SIM_PCT;

  let path: GameLineQualificationReason["path"];
  let summary: string;
  if (sim_above_50) {
    path = "sim_above_50";
    summary = `sim ${simPct}% > ${GAME_LINE_MIN_SIM_PCT}%`;
  } else if (best_ev_line) {
    path = "sim_at_50_best_ev";
    summary = `sim ${simPct}% with best-EV line on game`;
  } else if (strong_ev) {
    path = "sim_at_50_strong_ev";
    summary = `sim ${simPct}% with strong +EV ${evPct!.toFixed(1)}%`;
  } else if (edge_at_50_sim) {
    path = "sim_at_50_edge";
    summary = `sim ${simPct}% with edge ${edgePct.toFixed(1)}% ≥ ${GAME_LINE_STRONG_EV_PCT}%`;
  } else if (exceptional_edge) {
    path = "exceptional_edge";
    summary = `sim ${simPct}% < ${GAME_LINE_MIN_SIM_PCT}% with exceptional edge ${edgePct.toFixed(1)}% ≥ ${GAME_LINE_EXCEPTIONAL_EDGE_PCT}%`;
  } else {
    throw new GameLineFinalizeRejected(
      `${pick.pick ?? "?"} (${pick.game ?? "?"}): sim ${simPct}% does not meet any qualification path`,
    );
  }

  return {
    simPct,
    edgePct,
    evPct: evPct != null && Number.isFinite(evPct) ? evPct : null,
    path,
    sim_above_50,
    exceptional_edge,
    strong_ev,
    best_ev_line,
    edge_at_50_sim,
    summary,
  };
}

/** Assert every sub-50% game line has a documented exceptional-edge (or stronger) qualification path. */
export function assertSub50GameLineQualificationExplained(pick: ParsedPick): GameLineQualificationReason {
  const reason = explainGameLineQualification(pick);
  if (reason.simPct >= GAME_LINE_MIN_SIM_PCT) return reason;
  if (!reason.exceptional_edge) {
    throw new GameLineFinalizeRejected(
      `${pick.pick ?? "?"} (${pick.game ?? "?"}): sim ${reason.simPct}% requires exceptional_edge — no qualification path logged`,
    );
  }
  return reason;
}

export type GameLineFinalizeMetrics = {
  grade: string | null | undefined;
  confidencePct: number | null | undefined;
  simHit: number | null | undefined;
  edgePct: number | null | undefined;
  evPct?: number | null;
  market?: string | null;
  odds?: number | null;
  isBestEvLine?: boolean;
};

/** Required production fields on every finalized game-line leg. */
export const GAME_LINE_PRODUCTION_FIELDS = [
  "Final AI Grade",
  "Confidence",
  "Edge",
  "Simulation",
  "Market",
  "Odds",
] as const;

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
  if (metrics.odds == null || !Number.isFinite(metrics.odds) || metrics.odds === 0) {
    throw new GameLineFinalizeRejected(`${label}: missing Odds`);
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
      odds: d.odds,
      isBestEvLine: pick.gameLineFinal.isBestEv,
    });
    return true;
  } catch {
    return false;
  }
}

/** Throw when any production metadata field is missing on a frozen game-line leg. */
export function assertGameLineProductionMetadataComplete(pick: ParsedPick): void {
  if (!pick.gameLineFrozen || pick.gameLineFinal?.frozenAt == null) {
    throw new GameLineFinalizeRejected(
      `${pick.pick ?? "?"} (${pick.game ?? "?"}): game line is not frozen`,
    );
  }
  const d = pick.gameLineFinal.display;
  if (!d) {
    throw new GameLineFinalizeRejected(
      `${pick.pick ?? "?"} (${pick.game ?? "?"}): missing frozen display snapshot`,
    );
  }
  assertGameLineFinalizeMetrics(pick, {
    grade: d.grade,
    confidencePct: d.confidencePct,
    simHit: d.simHit,
    edgePct: d.edgePct,
    evPct: d.evPct,
    market: d.market,
    odds: d.odds,
    isBestEvLine: pick.gameLineFinal.isBestEv,
  });
}
