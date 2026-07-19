// Live-board pipeline tracing — one summary log per Coach parlay scan request.

import { API_BASE } from "./apiBase.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { positiveEdgeScoredLegs } from "./coachDeliverySalvage.ts";

export const COACH_LIVE_BOARD_LOG = "[coach-live-board]";

export type CoachLiveBoardStage =
  | "games"
  | "props"
  | "validated"
  | "priced"
  | "evScored"
  | "simulated"
  | "confidencePassed"
  | "correlationPassed"
  | "delivered";

const STAGE_ORDER: CoachLiveBoardStage[] = [
  "games",
  "props",
  "validated",
  "priced",
  "evScored",
  "simulated",
  "confidencePassed",
  "correlationPassed",
  "delivered",
];

export type CoachLiveBoardTraceSnapshot = {
  requestId: string;
  apiBase: string;
  apiRequestSent: boolean;
  endpoints: string[];
  httpStatus: string;
  games: number;
  props: number;
  validated: number;
  priced: number;
  evScored: number;
  simulated: number;
  confidencePassed: number;
  correlationPassed: number;
  delivered: number;
  error: string;
  firstZeroStage: string;
};

type TraceState = {
  requestId: string;
  apiRequestSent: boolean;
  endpoints: string[];
  httpStatuses: number[];
  games: number;
  props: number;
  validated: number;
  priced: number;
  evScored: number;
  simulated: number;
  confidencePassed: number;
  correlationPassed: number;
  delivered: number;
  error: string;
  summaryEmitted: boolean;
};

let active: TraceState | null = null;

function stageValue(state: TraceState, stage: CoachLiveBoardStage): number {
  return state[stage];
}

export function firstCoachLiveBoardZeroStage(
  snapshot: Pick<CoachLiveBoardTraceSnapshot, CoachLiveBoardStage>,
): string {
  for (const stage of STAGE_ORDER) {
    if (snapshot[stage] === 0) return stage;
  }
  return "none";
}

export function beginCoachLiveBoardTrace(requestId: string): void {
  active = {
    requestId,
    apiRequestSent: false,
    endpoints: [],
    httpStatuses: [],
    games: 0,
    props: 0,
    validated: 0,
    priced: 0,
    evScored: 0,
    simulated: 0,
    confidencePassed: 0,
    correlationPassed: 0,
    delivered: 0,
    error: "",
    summaryEmitted: false,
  };
}

export function coachLiveBoardTraceActive(): boolean {
  return active != null;
}

export function recordCoachLiveBoardApiResult(opts: {
  endpoint: string;
  status: number;
  ok: boolean;
  games?: number;
  props?: number;
  error?: string;
}): void {
  if (!active) return;
  active.apiRequestSent = true;
  active.endpoints.push(opts.endpoint);
  active.httpStatuses.push(opts.status);
  if (opts.games != null) active.games = Math.max(active.games, opts.games);
  if (opts.props != null) active.props = Math.max(active.props, opts.props);
  if (!opts.ok && opts.error) {
    active.error = active.error || opts.error;
  } else if (!opts.ok) {
    active.error = active.error || `HTTP ${opts.status} ${opts.endpoint}`;
  }
}

export function recordCoachLiveBoardFeedCounts(opts: {
  games: number;
  props: number;
}): void {
  if (!active) return;
  active.games = Math.max(active.games, opts.games);
  active.props = Math.max(active.props, opts.props);
}

export function recordCoachLiveBoardValidated(count: number): void {
  if (!active) return;
  active.validated = count;
}

export function recordCoachLiveBoardPriced(count: number): void {
  if (!active) return;
  active.priced = count;
}

export function recordCoachLiveBoardEvScored(scored: BoardScoredLeg[]): void {
  if (!active) return;
  active.evScored = positiveEdgeScoredLegs(scored).length;
}

export function recordCoachLiveBoardSimulated(count: number): void {
  if (!active) return;
  active.simulated = count;
}

export function recordCoachLiveBoardConfidencePassed(count: number): void {
  if (!active) return;
  active.confidencePassed = count;
}

export function recordCoachLiveBoardCorrelationPassed(count: number): void {
  if (!active) return;
  active.correlationPassed = count;
}

export function recordCoachLiveBoardDelivered(count: number): void {
  if (!active) return;
  active.delivered = count;
}

export function recordCoachLiveBoardError(message: string): void {
  if (!active) return;
  active.error = message;
}

export function snapshotCoachLiveBoardTrace(): CoachLiveBoardTraceSnapshot | null {
  if (!active) return null;
  const status =
    active.httpStatuses.length === 0
      ? active.apiRequestSent
        ? "unknown"
        : "not-sent"
      : active.httpStatuses.every((s) => s >= 200 && s < 300)
        ? "ok"
        : String(Math.max(...active.httpStatuses));
  const snap: CoachLiveBoardTraceSnapshot = {
    requestId: active.requestId,
    apiBase: API_BASE,
    apiRequestSent: active.apiRequestSent,
    endpoints: [...active.endpoints],
    httpStatus: status,
    games: active.games,
    props: active.props,
    validated: active.validated,
    priced: active.priced,
    evScored: active.evScored,
    simulated: active.simulated,
    confidencePassed: active.confidencePassed,
    correlationPassed: active.correlationPassed,
    delivered: active.delivered,
    error: active.error,
    firstZeroStage: "",
  };
  snap.firstZeroStage = firstCoachLiveBoardZeroStage(snap);
  return snap;
}

export function formatCoachLiveBoardSummary(snapshot: CoachLiveBoardTraceSnapshot): string {
  return (
    `${COACH_LIVE_BOARD_LOG} ` +
    `status=${snapshot.httpStatus} ` +
    `games=${snapshot.games} ` +
    `props=${snapshot.props} ` +
    `validated=${snapshot.validated} ` +
    `priced=${snapshot.priced} ` +
    `evScored=${snapshot.evScored} ` +
    `simulated=${snapshot.simulated} ` +
    `confidencePassed=${snapshot.confidencePassed} ` +
    `correlationPassed=${snapshot.correlationPassed} ` +
    `delivered=${snapshot.delivered} ` +
    `error=${snapshot.error || "none"} ` +
    `firstZero=${snapshot.firstZeroStage} ` +
    `apiBase=${snapshot.apiBase} ` +
    `requestId=${snapshot.requestId}`
  );
}

export function emitCoachLiveBoardSummary(reason?: string): CoachLiveBoardTraceSnapshot | null {
  if (!active || active.summaryEmitted) {
    return snapshotCoachLiveBoardTrace();
  }
  active.summaryEmitted = true;
  const snap = snapshotCoachLiveBoardTrace();
  if (!snap) return null;
  if (reason && !snap.error) snap.error = reason;
  console.log(formatCoachLiveBoardSummary(snap));
  if (snap.endpoints.length) {
    console.log(
      `${COACH_LIVE_BOARD_LOG} endpoints=${snap.endpoints.join(",")} apiRequestSent=${snap.apiRequestSent}`,
    );
  }
  return snap;
}

export function resetCoachLiveBoardTrace(): void {
  active = null;
}
