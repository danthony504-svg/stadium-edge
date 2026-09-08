// Correlation-stage instrumentation — backend logs only (no UI).

import type { ParsedPick } from "./parsedPick.ts";
import { parlayCorrelationPenalty } from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

export const COACH_CORRELATION_TRACE_LOG = "[coach-correlation-trace]";

export type CoachCorrelationCandidateTrace = {
  entity: string;
  market: string;
  line: string;
  edge: number | null;
  confidence: number | null;
  simulationPct: number | null;
  correlationScore: number | null;
  rejectionReason: string;
};

export type CoachCorrelationTraceSnapshot = {
  requestId: string;
  candidatesEntering: number;
  candidatesExiting: number;
  matrixBuilt: boolean;
  correlationTimeout: boolean;
  avgCorrelationScore: number | null;
  highestCorrelationScore: number | null;
  lowestCorrelationScore: number | null;
  rejectedByCorrelation: number;
  executionMs: number;
  exception: string | null;
  zeroExitCandidates: CoachCorrelationCandidateTrace[];
};

let lastTrace: CoachCorrelationTraceSnapshot | null = null;

export function snapshotCoachCorrelationTrace(): CoachCorrelationTraceSnapshot | null {
  return lastTrace;
}

export function resetCoachCorrelationTraceForTests(): void {
  lastTrace = null;
}

function entityLabel(pick: ParsedPick): string {
  if (pick.player) return pick.player;
  if (pick.teamAbbr) return pick.teamAbbr;
  const game = String(pick.game ?? "");
  const parts = game.split("@").map((s) => s.trim()).filter(Boolean);
  return parts[0] ?? (game || "—");
}

function lineLabel(pick: ParsedPick): string {
  return String(pick.pick ?? "").trim() || "—";
}

function metricsFromPick(pick: ParsedPick) {
  const score = pick.finalAiScore;
  return {
    edge: score?.edgePct ?? null,
    confidence: score?.confidencePct ?? null,
    simulationPct:
      score?.simHit != null ? Math.round(score.simHit * 1000) / 10 : null,
  };
}

/** Pairwise correlation penalties for every entering candidate vs the selected ticket. */
export function buildCorrelationPenaltyMatrix(
  candidates: BoardScoredLeg[],
  selected: ParsedPick[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const leg of candidates) {
    const fp = pickLegFingerprint(leg.pick);
    const penalty = parlayCorrelationPenalty(leg.pick, selected);
    out.set(fp, penalty);
  }
  return out;
}

function summarizePenaltyScores(scores: number[]): {
  avg: number | null;
  highest: number | null;
  lowest: number | null;
} {
  if (!scores.length) return { avg: null, highest: null, lowest: null };
  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round((sum / scores.length) * 10) / 10,
    highest: Math.max(...scores),
    lowest: Math.min(...scores),
  };
}

function rejectionReasonForCandidate(
  pick: ParsedPick,
  selected: ParsedPick[],
  exited: boolean,
  penalty: number,
): string {
  if (exited) return "Selected for ticket";
  if (!selected.length) {
    return penalty > 0
      ? `Rejected by correlation (penalty ${penalty.toFixed(1)} vs empty ticket)`
      : "Not selected — correlation pass returned zero picks";
  }
  const kept = new Set(selected.map((p) => pickLegFingerprint(p)));
  if (kept.has(pickLegFingerprint(pick))) return "Selected for ticket";
  if (penalty >= 14) {
    return `Rejected by correlation (high same-game / player stack penalty ${penalty.toFixed(1)})`;
  }
  if (penalty > 0) {
    return `Rejected by correlation (penalty ${penalty.toFixed(1)} — lower rank than delivered legs)`;
  }
  return "Not selected — lower rank than correlation-aware ticket";
}

export function buildCoachCorrelationTrace(opts: {
  requestId: string;
  candidates: BoardScoredLeg[];
  selected: ParsedPick[];
  executionMs: number;
  correlationTimeout: boolean;
  exception?: string | null;
}): CoachCorrelationTraceSnapshot {
  const matrixBuilt = opts.candidates.length > 0;
  const penalties = buildCorrelationPenaltyMatrix(opts.candidates, opts.selected);
  const penaltyValues = [...penalties.values()];
  const { avg, highest, lowest } = summarizePenaltyScores(penaltyValues);
  const kept = new Set(opts.selected.map((p) => pickLegFingerprint(p)));

  const zeroExitCandidates: CoachCorrelationCandidateTrace[] = opts.candidates.map((leg) => {
    const pick = leg.pick;
    const fp = pickLegFingerprint(pick);
    const penalty = penalties.get(fp) ?? 0;
    const metrics = metricsFromPick(pick);
    const exited = kept.has(fp);
    return {
      entity: entityLabel(pick),
      market: String(pick.market ?? ""),
      line: lineLabel(pick),
      edge: metrics.edge,
      confidence: metrics.confidence,
      simulationPct: metrics.simulationPct,
      correlationScore: penalty,
      rejectionReason: rejectionReasonForCandidate(pick, opts.selected, exited, penalty),
    };
  });

  zeroExitCandidates.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));

  const rejectedByCorrelation = zeroExitCandidates.filter(
    (c) => !c.rejectionReason.startsWith("Selected"),
  ).length;

  const trace: CoachCorrelationTraceSnapshot = {
    requestId: opts.requestId,
    candidatesEntering: opts.candidates.length,
    candidatesExiting: opts.selected.length,
    matrixBuilt,
    correlationTimeout: opts.correlationTimeout,
    avgCorrelationScore: avg,
    highestCorrelationScore: highest,
    lowestCorrelationScore: lowest,
    rejectedByCorrelation,
    executionMs: opts.executionMs,
    exception: opts.exception ?? null,
    zeroExitCandidates,
  };
  lastTrace = trace;
  return trace;
}

export function logCoachCorrelationTrace(trace: CoachCorrelationTraceSnapshot): void {
  console.log(`${COACH_CORRELATION_TRACE_LOG} ── correlation stage ──`);
  console.log(
    `${COACH_CORRELATION_TRACE_LOG} requestId=${trace.requestId} entering=${trace.candidatesEntering} exiting=${trace.candidatesExiting} rejected=${trace.rejectedByCorrelation} executionMs=${trace.executionMs}`,
  );
  console.log(
    `${COACH_CORRELATION_TRACE_LOG} matrixBuilt=${trace.matrixBuilt} timeout=${trace.correlationTimeout} avgPenalty=${trace.avgCorrelationScore ?? "—"} high=${trace.highestCorrelationScore ?? "—"} low=${trace.lowestCorrelationScore ?? "—"}`,
  );
  if (trace.exception) {
    console.log(`${COACH_CORRELATION_TRACE_LOG} exception=${trace.exception}`);
  }
  if (trace.candidatesExiting === 0 && trace.zeroExitCandidates.length) {
    console.log(
      `${COACH_CORRELATION_TRACE_LOG} zero-exit candidates (top ${Math.min(20, trace.zeroExitCandidates.length)} by edge):`,
    );
    for (const c of trace.zeroExitCandidates.slice(0, 20)) {
      console.log(
        `${COACH_CORRELATION_TRACE_LOG} CAND ${c.entity} | ${c.market} | ${c.line} | edge=${c.edge ?? "—"}% conf=${c.confidence ?? "—"}% sim=${c.simulationPct ?? "—"}% penalty=${c.correlationScore ?? "—"} | ${c.rejectionReason}`,
      );
    }
    if (trace.zeroExitCandidates.length > 20) {
      console.log(
        `${COACH_CORRELATION_TRACE_LOG} …and ${trace.zeroExitCandidates.length - 20} more candidates`,
      );
    }
  }
}
