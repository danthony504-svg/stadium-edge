// Live-board pipeline tracing — backend diagnostics only (no UI).

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
  | "deduped"
  | "confidencePassed"
  | "correlationPassed"
  | "delivered";

export type CoachLiveBoardExitReason =
  | "none"
  | "no_games"
  | "no_props"
  | "api_failure"
  | "timeout"
  | "parsing_failure"
  | "confidence_filter"
  | "grounding_filter"
  | "delivery_guard"
  | "dedupe_filter"
  | "correlation_filter"
  | "ev_filter"
  | "scan_exception";

const STAGE_ORDER: CoachLiveBoardStage[] = [
  "games",
  "props",
  "validated",
  "priced",
  "evScored",
  "simulated",
  "deduped",
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
  deduped: number;
  confidencePassed: number;
  correlationPassed: number;
  delivered: number;
  error: string;
  exitReason: CoachLiveBoardExitReason;
  firstZeroStage: string;
};

type TraceState = {
  requestId: string;
  apiRequestSent: boolean;
  endpoints: string[];
  httpStatuses: number[];
  optionalEndpoints: boolean[];
  games: number;
  props: number;
  validated: number;
  priced: number;
  evScored: number;
  simulated: number;
  deduped: number;
  confidencePassed: number;
  correlationPassed: number;
  delivered: number;
  error: string;
  exitReason: CoachLiveBoardExitReason;
  propSimTimeouts: number;
  summaryEmitted: boolean;
};

let active: TraceState | null = null;

export function firstCoachLiveBoardZeroStage(
  snapshot: Pick<CoachLiveBoardTraceSnapshot, CoachLiveBoardStage>,
): string {
  for (const stage of STAGE_ORDER) {
    if (snapshot[stage] === 0) return stage;
  }
  return "none";
}

export function classifyCoachLiveBoardExit(
  snapshot: Pick<
    CoachLiveBoardTraceSnapshot,
    CoachLiveBoardStage | "httpStatus" | "error" | "exitReason"
  >,
): CoachLiveBoardExitReason {
  if (snapshot.exitReason !== "none") return snapshot.exitReason;
  const err = (snapshot.error ?? "").toLowerCase();
  if (err.includes("scan-exception") || err.includes("null-scan")) return "scan_exception";
  if (err.includes("abort") || err.includes("timeout") || err.includes("timed out")) {
    return "timeout";
  }
  if (
    snapshot.httpStatus !== "ok" &&
    snapshot.httpStatus !== "not-sent" &&
    snapshot.httpStatus !== "unknown"
  ) {
    return "api_failure";
  }
  const firstZero = firstCoachLiveBoardZeroStage(snapshot);
  switch (firstZero) {
    case "games":
      return "no_games";
    case "props":
      return "no_props";
    case "validated":
      return err.includes("parse") ? "parsing_failure" : "parsing_failure";
    case "priced":
      return "grounding_filter";
    case "evScored":
      return "ev_filter";
    case "simulated":
      return "timeout";
    case "deduped":
      return "dedupe_filter";
    case "confidencePassed":
      return "confidence_filter";
    case "correlationPassed":
      return "correlation_filter";
    case "delivered":
      return "delivery_guard";
    default:
      return "none";
  }
}

export function beginCoachLiveBoardTrace(requestId: string): void {
  active = {
    requestId,
    apiRequestSent: false,
    endpoints: [],
    httpStatuses: [],
    optionalEndpoints: [],
    games: 0,
    props: 0,
    validated: 0,
    priced: 0,
    evScored: 0,
    simulated: 0,
    deduped: 0,
    confidencePassed: 0,
    correlationPassed: 0,
    delivered: 0,
    error: "",
    exitReason: "none",
    propSimTimeouts: 0,
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
  /** Supplemental feeds (e.g. live-odds) must not poison primary httpStatus / exit. */
  optional?: boolean;
}): void {
  if (!active) return;
  active.apiRequestSent = true;
  active.endpoints.push(opts.endpoint);
  active.httpStatuses.push(opts.status);
  active.optionalEndpoints.push(!!opts.optional);
  if (opts.games != null) active.games = Math.max(active.games, opts.games);
  if (opts.props != null) active.props = Math.max(active.props, opts.props);
  if (!opts.ok) {
    const msg = opts.error || `HTTP ${opts.status} ${opts.endpoint}`;
    if (!opts.optional) {
      active.error = active.error || msg;
    }
    if (!opts.optional && (opts.status === 404 || opts.status >= 500)) {
      active.exitReason = "api_failure";
    }
  }
}

export function recordCoachLiveBoardFeedCounts(opts: { games: number; props: number }): void {
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

export function recordCoachLiveBoardSimulated(count: number, opts?: { timeouts?: number }): void {
  if (!active) return;
  active.simulated = count;
  if (opts?.timeouts) {
    active.propSimTimeouts += opts.timeouts;
    if (opts.timeouts > 0 && active.exitReason === "none") {
      active.exitReason = "timeout";
    }
  }
}

export function recordCoachLiveBoardDeduped(count: number): void {
  if (!active) return;
  active.deduped = count;
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

export function recordCoachLiveBoardExitReason(reason: CoachLiveBoardExitReason): void {
  if (!active) return;
  active.exitReason = reason;
}

export function snapshotCoachLiveBoardTrace(): CoachLiveBoardTraceSnapshot | null {
  if (!active) return null;
  const primaryStatuses = active.httpStatuses.filter((_, i) => !active!.optionalEndpoints[i]);
  const status =
    primaryStatuses.length === 0
      ? active.apiRequestSent
        ? "unknown"
        : "not-sent"
      : primaryStatuses.every((s) => s >= 200 && s < 300)
        ? "ok"
        : String(Math.max(...primaryStatuses));
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
    deduped: active.deduped,
    confidencePassed: active.confidencePassed,
    correlationPassed: active.correlationPassed,
    delivered: active.delivered,
    error: active.error,
    exitReason: active.exitReason,
    firstZeroStage: "",
  };
  snap.firstZeroStage = firstCoachLiveBoardZeroStage(snap);
  snap.exitReason = classifyCoachLiveBoardExit(snap);
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
    `deduped=${snapshot.deduped} ` +
    `confidencePassed=${snapshot.confidencePassed} ` +
    `correlationPassed=${snapshot.correlationPassed} ` +
    `delivered=${snapshot.delivered} ` +
    `error=${snapshot.error || "none"} ` +
    `exit=${snapshot.exitReason} ` +
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
  if (reason) {
    active.error = active.error || reason;
    snap.error = snap.error || reason;
    if (snap.exitReason === "none" && reason.includes("delivery")) {
      snap.exitReason = "delivery_guard";
    }
  }
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
