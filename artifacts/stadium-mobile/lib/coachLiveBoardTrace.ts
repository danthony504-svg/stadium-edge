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
  | "confidencePassed"
  | "grounded"
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
  "confidencePassed",
  "grounded",
  "delivered",
];

export const COACH_LIVE_BOARD_STAGE_LABELS: Record<CoachLiveBoardStage, string> = {
  games: "Games loaded",
  props: "Props loaded",
  validated: "Candidates created",
  priced: "Candidates after pricing",
  evScored: "Candidates after EV",
  simulated: "Candidates after simulation",
  confidencePassed: "Candidates after confidence",
  grounded: "Candidates after grounding",
  delivered: "Final delivered picks",
};

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
  grounded: number;
  delivered: number;
  error: string;
  exitReason: CoachLiveBoardExitReason;
  firstZeroStage: CoachLiveBoardStage | "none";
  firstZeroStageLabel: string;
  scanStarted: boolean;
  scanComplete: boolean;
  boardScanInFlight: boolean;
  scanBudgetExpired: boolean;
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
  grounded: number;
  delivered: number;
  error: string;
  exitReason: CoachLiveBoardExitReason;
  propSimTimeouts: number;
  summaryEmitted: boolean;
  scanStarted: boolean;
  scanComplete: boolean;
  boardScanInFlight: number;
  scanBudgetExpired: boolean;
  loggedStages: Set<CoachLiveBoardStage>;
};

let active: TraceState | null = null;

function logLine(message: string): void {
  console.log(`${COACH_LIVE_BOARD_LOG} ${message}`);
}

function logStageCount(stage: CoachLiveBoardStage, count: number): void {
  if (!active) return;
  active.loggedStages.add(stage);
  logLine(`${COACH_LIVE_BOARD_STAGE_LABELS[stage]}: ${count}`);
}

export function coachLiveBoardStageLabel(stage: CoachLiveBoardStage | "none"): string {
  if (stage === "none") return "none";
  return COACH_LIVE_BOARD_STAGE_LABELS[stage];
}

export function firstCoachLiveBoardZeroStage(
  snapshot: Pick<CoachLiveBoardTraceSnapshot, CoachLiveBoardStage>,
): CoachLiveBoardStage | "none" {
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
    case "confidencePassed":
      return "confidence_filter";
    case "grounded":
      return "grounding_filter";
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
    grounded: 0,
    delivered: 0,
    error: "",
    exitReason: "none",
    propSimTimeouts: 0,
    summaryEmitted: false,
    scanStarted: false,
    scanComplete: false,
    boardScanInFlight: 0,
    scanBudgetExpired: false,
    loggedStages: new Set(),
  };
  logLine(`Live board request started requestId=${requestId}`);
}

export function coachLiveBoardTraceActive(): boolean {
  return active != null;
}

export function markCoachLiveBoardScanStarted(): void {
  if (!active) return;
  active.scanStarted = true;
  active.boardScanInFlight += 1;
  logLine(`board-scan-started requestId=${active.requestId}`);
}

export function markCoachLiveBoardScanEnded(scanComplete: boolean): void {
  if (!active) return;
  active.boardScanInFlight = Math.max(0, active.boardScanInFlight - 1);
  if (scanComplete) active.scanComplete = true;
  logLine(
    `board-scan-ended scanComplete=${scanComplete} boardScanInFlight=${active.boardScanInFlight} requestId=${active.requestId}`,
  );
}

export function recordCoachLiveBoardScanBudgetExpired(): void {
  if (!active) return;
  active.scanBudgetExpired = true;
  logLine(
    `board-scan-budget-expired scanStillInFlight=${active.boardScanInFlight > 0} requestId=${active.requestId}`,
  );
}

export function recordCoachLiveBoardApiResult(opts: {
  endpoint: string;
  status: number;
  ok: boolean;
  games?: number;
  props?: number;
  error?: string;
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
  logStageCount("games", active.games);
  logStageCount("props", active.props);
}

export function recordCoachLiveBoardValidated(count: number): void {
  if (!active) return;
  active.validated = count;
  logStageCount("validated", count);
}

export function recordCoachLiveBoardPriced(count: number): void {
  if (!active) return;
  active.priced = count;
  logStageCount("priced", count);
}

export function recordCoachLiveBoardEvScored(scored: BoardScoredLeg[]): void {
  if (!active) return;
  active.evScored = positiveEdgeScoredLegs(scored).length;
  logStageCount("evScored", active.evScored);
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
  logStageCount("simulated", count);
}

export function recordCoachLiveBoardDeduped(count: number): void {
  if (!active) return;
  active.deduped = count;
}

export function recordCoachLiveBoardConfidencePassed(count: number): void {
  if (!active) return;
  active.confidencePassed = count;
  logStageCount("confidencePassed", count);
}

/** Correlation / staging count before odds grounding. */
export function recordCoachLiveBoardCorrelationPassed(count: number): void {
  recordCoachLiveBoardGrounded(count);
}

export function recordCoachLiveBoardGrounded(count: number): void {
  if (!active) return;
  active.grounded = count;
  logStageCount("grounded", count);
}

export function recordCoachLiveBoardDelivered(count: number): void {
  if (!active) return;
  active.delivered = count;
  logStageCount("delivered", count);
}

export function recordCoachLiveBoardError(message: string): void {
  if (!active) return;
  active.error = active.error || message;
}

export function recordCoachLiveBoardExitReason(reason: CoachLiveBoardExitReason): void {
  if (!active) return;
  active.exitReason = reason;
}

function buildSnapshot(): CoachLiveBoardTraceSnapshot | null {
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
    grounded: active.grounded,
    delivered: active.delivered,
    error: active.error,
    exitReason: active.exitReason,
    firstZeroStage: "none",
    firstZeroStageLabel: "none",
    scanStarted: active.scanStarted,
    scanComplete: active.scanComplete,
    boardScanInFlight: active.boardScanInFlight > 0,
    scanBudgetExpired: active.scanBudgetExpired,
  };
  snap.firstZeroStage = firstCoachLiveBoardZeroStage(snap);
  snap.firstZeroStageLabel = coachLiveBoardStageLabel(snap.firstZeroStage);
  snap.exitReason = classifyCoachLiveBoardExit(snap);
  return snap;
}

export function snapshotCoachLiveBoardTrace(): CoachLiveBoardTraceSnapshot | null {
  return buildSnapshot();
}

function logCompletionStageRollup(snap: CoachLiveBoardTraceSnapshot): void {
  for (const stage of STAGE_ORDER) {
    logLine(`${COACH_LIVE_BOARD_STAGE_LABELS[stage]}: ${snap[stage]}`);
  }
}

/**
 * Log when an empty ticket would surface the generic "couldn't ground a real ticket" fallback.
 * Backend-only — does not touch UI.
 */
export function logCoachLiveBoardEmptyTicketFallback(opts: {
  delivered: number;
  scanComplete: boolean;
  hasManifestReply?: boolean;
  legTarget?: number;
}): void {
  if (!active || opts.delivered > 0) return;
  const snap = buildSnapshot();
  if (!snap) return;
  const wouldShowGenericFallback =
    !opts.hasManifestReply && (opts.legTarget ?? 0) > 0;
  const fallbackBeforeScanFinished =
    wouldShowGenericFallback && (!opts.scanComplete || snap.boardScanInFlight);
  logLine(
    `empty-ticket-fallback ` +
      `stageReturnedZero="${snap.firstZeroStageLabel}" ` +
      `firstZero=${snap.firstZeroStage} ` +
      `scanComplete=${opts.scanComplete} ` +
      `boardScanInFlight=${snap.boardScanInFlight} ` +
      `scanBudgetExpired=${snap.scanBudgetExpired} ` +
      `fallbackBeforeScanFinished=${fallbackBeforeScanFinished} ` +
      `requestId=${snap.requestId}`,
  );
}

export function formatCoachLiveBoardSummary(snapshot: CoachLiveBoardTraceSnapshot): string {
  return (
    `${COACH_LIVE_BOARD_LOG} pipeline-summary ` +
    `status=${snapshot.httpStatus} ` +
    `games=${snapshot.games} ` +
    `props=${snapshot.props} ` +
    `candidates=${snapshot.validated} ` +
    `priced=${snapshot.priced} ` +
    `ev=${snapshot.evScored} ` +
    `simulated=${snapshot.simulated} ` +
    `confidence=${snapshot.confidencePassed} ` +
    `grounded=${snapshot.grounded} ` +
    `delivered=${snapshot.delivered} ` +
    `firstZero=${snapshot.firstZeroStage} ` +
    `firstZeroLabel="${snapshot.firstZeroStageLabel}" ` +
    `exit=${snapshot.exitReason} ` +
    `scanComplete=${snapshot.scanComplete} ` +
    `boardScanInFlight=${snapshot.boardScanInFlight} ` +
    `requestId=${snapshot.requestId}`
  );
}

export function emitCoachLiveBoardSummary(reason?: string): CoachLiveBoardTraceSnapshot | null {
  if (!active || active.summaryEmitted) {
    return buildSnapshot();
  }
  active.summaryEmitted = true;
  const snap = buildSnapshot();
  if (!snap) return null;
  if (reason) {
    active.error = active.error || reason;
    snap.error = snap.error || reason;
    if (snap.exitReason === "none" && reason.includes("delivery")) {
      snap.exitReason = "delivery_guard";
    }
  }
  logLine(`Live board request completed requestId=${snap.requestId}`);
  logCompletionStageRollup(snap);
  console.log(formatCoachLiveBoardSummary(snap));
  if (snap.delivered === 0) {
    logCoachLiveBoardEmptyTicketFallback({
      delivered: 0,
      scanComplete: snap.scanComplete,
      legTarget: 1,
    });
  }
  if (snap.endpoints.length) {
    logLine(`endpoints=${snap.endpoints.join(",")} apiRequestSent=${snap.apiRequestSent}`);
  }
  return snap;
}

export function resetCoachLiveBoardTrace(): void {
  active = null;
}
