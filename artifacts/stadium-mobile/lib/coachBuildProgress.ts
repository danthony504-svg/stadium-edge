/** Canonical Coach parlay-build progress — monotonic stages driven by real pipeline events. */

export type ParlayBuildPhase = "context" | "board-scan" | "stream" | "score";

export type CoachBuildStageId =
  | "starting"
  | "loading-games"
  | "matchups"
  | "injuries"
  | "line-value"
  | "simulations"
  | "correlation"
  | "building-ticket"
  | "final-ticket";

export type CoachBuildProgressStatus = "active" | "complete" | "timed-out" | "failed" | "empty";

export type CoachBuildStageDef = {
  id: CoachBuildStageId;
  percent: number;
  label: string;
  timeoutMs: number;
};

export const COACH_BUILD_STAGES: readonly CoachBuildStageDef[] = [
  { id: "starting", percent: 0, label: "Starting analysis", timeoutMs: 15_000 },
  { id: "loading-games", percent: 10, label: "Loading today's games", timeoutMs: 45_000 },
  { id: "matchups", percent: 25, label: "Analyzing matchups", timeoutMs: 60_000 },
  { id: "injuries", percent: 40, label: "Checking injuries and lineups", timeoutMs: 45_000 },
  { id: "line-value", percent: 55, label: "Calculating line value and EV", timeoutMs: 90_000 },
  { id: "simulations", percent: 70, label: "Running simulations", timeoutMs: 120_000 },
  { id: "correlation", percent: 85, label: "Scoring correlation", timeoutMs: 20_000 },
  { id: "building-ticket", percent: 95, label: "Building final ticket", timeoutMs: 60_000 },
  { id: "final-ticket", percent: 100, label: "Final ticket ready", timeoutMs: 30_000 },
] as const;

export const COACH_BUILD_STAGE_IDS = COACH_BUILD_STAGES.map((s) => s.id);

export type CoachBuildProgressState = {
  requestId: string;
  sendGeneration: number;
  legTarget: number;
  /** Highest fully completed stage index (-1 = none). */
  completedThroughIndex: number;
  displayPercent: number;
  status: CoachBuildProgressStatus;
  activeStageStartedAt: number;
  timedOutStageId?: CoachBuildStageId;
  failureMessage?: string;
};

export type CoachBuildProgressView = {
  percent: number;
  headline: string;
  checklist: { id: CoachBuildStageId; label: string; done: boolean; active: boolean }[];
  timedOut: boolean;
  timedOutLabel?: string;
  failed: boolean;
  failureMessage?: string;
  spinning: boolean;
  status: CoachBuildProgressStatus;
};

export type CoachBuildProgressCallback = (
  stageId: CoachBuildStageId,
  requestId: string,
) => void;

const STAGE_INDEX = new Map(COACH_BUILD_STAGES.map((s, i) => [s.id, i]));

export function coachBuildStageIndex(stageId: CoachBuildStageId): number {
  return STAGE_INDEX.get(stageId) ?? -1;
}

export function coachBuildStageTimeoutMs(stageId: CoachBuildStageId, legTarget: number): number {
  const base = COACH_BUILD_STAGES[coachBuildStageIndex(stageId)]?.timeoutMs ?? 60_000;
  if (stageId === "simulations") {
    if (legTarget >= 15) return 180_000;
    if (legTarget >= 9) return 150_000;
    if (legTarget >= 6) return 120_000;
    return base;
  }
  if (stageId === "building-ticket" && legTarget >= 9) return 90_000;
  return base;
}

function activeStageIndex(state: CoachBuildProgressState): number {
  if (state.status !== "active") return COACH_BUILD_STAGES.length - 1;
  return Math.min(state.completedThroughIndex + 1, COACH_BUILD_STAGES.length - 1);
}

function matchesRequest(
  state: CoachBuildProgressState,
  opts: { requestId: string; sendGeneration: number },
): boolean {
  return state.requestId === opts.requestId && state.sendGeneration === opts.sendGeneration;
}

export function createCoachBuildProgress(opts: {
  requestId: string;
  sendGeneration: number;
  legTarget?: number;
  now?: number;
}): CoachBuildProgressState {
  const now = opts.now ?? Date.now();
  return {
    requestId: opts.requestId,
    sendGeneration: opts.sendGeneration,
    legTarget: opts.legTarget ?? 0,
    completedThroughIndex: -1,
    displayPercent: 0,
    status: "active",
    activeStageStartedAt: now,
  };
}

/** Mark the next sequential stage complete for the active request. */
export function advanceCoachBuildStage(
  state: CoachBuildProgressState,
  stageId: CoachBuildStageId,
  opts: { requestId: string; sendGeneration: number; now?: number },
): CoachBuildProgressState {
  if (!matchesRequest(state, opts) || state.status !== "active") return state;
  const targetIdx = coachBuildStageIndex(stageId);
  if (targetIdx < 0) return state;
  const expectedIdx = state.completedThroughIndex + 1;
  if (targetIdx !== expectedIdx) return state;
  const now = opts.now ?? Date.now();
  const floorPercent = COACH_BUILD_STAGES[targetIdx]!.percent;
  return {
    ...state,
    completedThroughIndex: targetIdx,
    displayPercent: Math.max(state.displayPercent, floorPercent),
    activeStageStartedAt: now,
  };
}

export function coachBuildProgressOnPicksRendered(
  state: CoachBuildProgressState,
  pickCount: number,
  opts: { requestId: string; sendGeneration: number; now?: number },
): CoachBuildProgressState {
  if (!matchesRequest(state, opts)) return state;
  if (pickCount <= 0) return state;
  const advanced = advanceCoachBuildStage(state, "final-ticket", opts);
  return {
    ...advanced,
    displayPercent: 100,
    status: "complete",
  };
}

export function coachBuildProgressOnFailure(
  state: CoachBuildProgressState,
  message: string,
  opts: {
    requestId: string;
    sendGeneration: number;
    empty?: boolean;
    now?: number;
  },
): CoachBuildProgressState {
  if (!matchesRequest(state, opts)) return state;
  return {
    ...state,
    status: opts.empty ? "empty" : "failed",
    failureMessage: message,
    displayPercent: Math.max(
      state.displayPercent,
      COACH_BUILD_STAGES[Math.max(0, state.completedThroughIndex)]?.percent ?? 0,
    ),
  };
}

export function coachBuildProgressTick(
  state: CoachBuildProgressState,
  now = Date.now(),
): CoachBuildProgressState {
  if (state.status !== "active") return state;

  const activeIdx = activeStageIndex(state);
  const activeStage = COACH_BUILD_STAGES[activeIdx]!;
  const floor =
    state.completedThroughIndex >= 0
      ? COACH_BUILD_STAGES[state.completedThroughIndex]!.percent
      : 0;
  const ceiling =
    activeIdx < COACH_BUILD_STAGES.length - 1
      ? COACH_BUILD_STAGES[activeIdx + 1]!.percent - 1
      : 100;
  const step = Math.max(0.35, (ceiling - floor) / 120);
  const nextDisplay = Math.min(ceiling, Math.max(state.displayPercent + step, floor));

  let next = state;
  if (nextDisplay !== state.displayPercent) {
    next = { ...state, displayPercent: nextDisplay };
  }

  const timeoutMs = coachBuildStageTimeoutMs(activeStage.id, state.legTarget);
  if (now - state.activeStageStartedAt >= timeoutMs) {
    return {
      ...next,
      status: "timed-out",
      timedOutStageId: activeStage.id,
      failureMessage: `${activeStage.label} timed out`,
      displayPercent: Math.max(next.displayPercent, activeStage.percent),
    };
  }

  return next;
}

export function coachBuildProgressView(state: CoachBuildProgressState | null): CoachBuildProgressView | null {
  if (!state) return null;
  const activeIdx =
    state.status === "complete"
      ? COACH_BUILD_STAGES.length
      : Math.min(state.completedThroughIndex + 1, COACH_BUILD_STAGES.length - 1);

  const timedOut = state.status === "timed-out";
  const failed = state.status === "failed" || state.status === "empty";
  const spinning = state.status === "active";

  const headline = timedOut
    ? `${state.timedOutStageId ? COACH_BUILD_STAGES[coachBuildStageIndex(state.timedOutStageId)]?.label ?? "Stage" : "Stage"} timed out`
    : failed
      ? state.failureMessage ?? "Build failed"
      : COACH_BUILD_STAGES[Math.min(activeIdx, COACH_BUILD_STAGES.length - 1)]!.label;

  const checklist = COACH_BUILD_STAGES.map((stage, idx) => ({
    id: stage.id,
    label: stage.label,
    done: state.status === "complete" ? true : idx <= state.completedThroughIndex,
    active: state.status === "active" && idx === activeIdx,
  }));

  return {
    percent: state.status === "complete" ? 100 : Math.round(state.displayPercent),
    headline,
    checklist,
    timedOut,
    timedOutLabel: timedOut
      ? COACH_BUILD_STAGES[coachBuildStageIndex(state.timedOutStageId ?? "starting")]?.label
      : undefined,
    failed,
    failureMessage: state.failureMessage,
    spinning,
    status: state.status,
  };
}

export function coachBuildProgressSignature(opts: {
  requestId?: string;
  stage: string;
  percent: number;
  ticketId?: string;
}): string {
  return `${opts.requestId ?? ""}|${opts.stage}|${opts.percent}|${opts.ticketId ?? ""}`;
}

/** Single canonical Coach build progress snapshot for UI + callers. */
export type CoachBuildProgressSnapshot = {
  percent: number;
  label: string;
  matchupComplete: boolean;
  injuryComplete: boolean;
  lineValueComplete: boolean;
  simulationComplete: boolean;
  correlationComplete: boolean;
  ticketComplete: boolean;
};

const MATCHUPS_IDX = coachBuildStageIndex("matchups");
const INJURIES_IDX = coachBuildStageIndex("injuries");
const LINE_VALUE_IDX = coachBuildStageIndex("line-value");
const SIMULATIONS_IDX = coachBuildStageIndex("simulations");
const CORRELATION_IDX = coachBuildStageIndex("correlation");
const FINAL_TICKET_IDX = coachBuildStageIndex("final-ticket");

function coachBuildChecklistFromIndex(
  completedThroughIndex: number,
  legCount: number,
): Omit<CoachBuildProgressSnapshot, "percent" | "label"> {
  const idx = legCount > 0 ? FINAL_TICKET_IDX : completedThroughIndex;
  return {
    matchupComplete: idx >= MATCHUPS_IDX,
    injuryComplete: idx >= INJURIES_IDX,
    lineValueComplete: idx >= LINE_VALUE_IDX,
    simulationComplete: idx >= SIMULATIONS_IDX,
    correlationComplete: idx >= CORRELATION_IDX,
    ticketComplete: legCount > 0 || idx >= FINAL_TICKET_IDX,
  };
}

function coachBuildSnapshotFromLifecycle(
  lifecycle: CoachBuildProgressState,
  legCount: number,
): CoachBuildProgressSnapshot {
  if (lifecycle.status === "complete" || legCount > 0) {
    return {
      percent: 100,
      label: COACH_BUILD_STAGES[FINAL_TICKET_IDX]!.label,
      matchupComplete: true,
      injuryComplete: true,
      lineValueComplete: true,
      simulationComplete: true,
      correlationComplete: true,
      ticketComplete: true,
    };
  }
  const activeIdx = Math.min(lifecycle.completedThroughIndex + 1, COACH_BUILD_STAGES.length - 1);
  const stage = COACH_BUILD_STAGES[activeIdx]!;
  return {
    percent:
      lifecycle.status === "timed-out" || lifecycle.status === "failed" || lifecycle.status === "empty"
        ? Math.round(lifecycle.displayPercent)
        : Math.round(lifecycle.displayPercent),
    label: lifecycle.failureMessage ?? stage.label,
    ...coachBuildChecklistFromIndex(lifecycle.completedThroughIndex, legCount),
  };
}

/** Map legacy parlay phase to the nearest active stage id. */
export function coachBuildStageFromParlayPhase(
  buildPhase: ParlayBuildPhase | undefined,
): CoachBuildStageId {
  switch (buildPhase) {
    case "context":
      return "matchups";
    case "board-scan":
      return "simulations";
    case "stream":
      return "correlation";
    case "score":
      return "building-ticket";
    default:
      return "starting";
  }
}

/**
 * Canonical progress mapper — prefers live lifecycle state, falls back to phase.
 * Percentages: idle 0 → loading-games 10 → matchups 25 → injuries 40 →
 * line-value 55 → simulations 70 → correlation 85 → building-ticket 95 → complete 100.
 */
export function coachBuildProgressFromPhase(
  buildPhase: ParlayBuildPhase | undefined,
  legCount: number,
  lifecycle?: CoachBuildProgressState | null,
): CoachBuildProgressSnapshot {
  if (lifecycle && lifecycle.status !== "failed" && lifecycle.status !== "empty") {
    return coachBuildSnapshotFromLifecycle(lifecycle, legCount);
  }
  if (legCount > 0) {
    return {
      percent: 100,
      label: COACH_BUILD_STAGES[FINAL_TICKET_IDX]!.label,
      matchupComplete: true,
      injuryComplete: true,
      lineValueComplete: true,
      simulationComplete: true,
      correlationComplete: true,
      ticketComplete: true,
    };
  }
  const stageId = buildPhase ? coachBuildStageFromParlayPhase(buildPhase) : "starting";
  const stageIdx = coachBuildStageIndex(stageId);
  const stage = COACH_BUILD_STAGES[stageIdx] ?? COACH_BUILD_STAGES[0]!;
  return {
    percent: stage.percent,
    label: stage.label,
    ...coachBuildChecklistFromIndex(stageIdx, legCount),
  };
}

/** Bridge canonical snapshot → AnalysisProgress view model. */
export function coachBuildProgressViewFromSnapshot(
  snapshot: CoachBuildProgressSnapshot,
  opts?: {
    timedOut?: boolean;
    timedOutLabel?: string;
    failed?: boolean;
    failureMessage?: string;
    spinning?: boolean;
  },
): CoachBuildProgressView {
  const checklistStageIds: CoachBuildStageId[] = [
    "starting",
    "loading-games",
    "matchups",
    "injuries",
    "line-value",
    "simulations",
    "correlation",
    "building-ticket",
    "final-ticket",
  ];
  const flags = [
    true,
    snapshot.percent >= 10,
    snapshot.matchupComplete,
    snapshot.injuryComplete,
    snapshot.lineValueComplete,
    snapshot.simulationComplete,
    snapshot.correlationComplete,
    snapshot.percent >= 95,
    snapshot.ticketComplete,
  ];
  let activeIdx = checklistStageIds.findIndex((_, idx) => !flags[idx]);
  if (activeIdx < 0) activeIdx = checklistStageIds.length - 1;

  return {
    percent: snapshot.percent,
    headline: opts?.failureMessage ?? snapshot.label,
    checklist: checklistStageIds.map((id, idx) => ({
      id,
      label: COACH_BUILD_STAGES[coachBuildStageIndex(id)]!.label,
      done: flags[idx] ?? false,
      active: idx === activeIdx && !opts?.timedOut && !opts?.failed,
    })),
    timedOut: opts?.timedOut === true,
    timedOutLabel: opts?.timedOutLabel,
    failed: opts?.failed === true,
    failureMessage: opts?.failureMessage,
    spinning: opts?.spinning ?? snapshot.percent < 100,
    status: snapshot.ticketComplete
      ? "complete"
      : opts?.timedOut
        ? "timed-out"
        : opts?.failed
          ? "failed"
          : "active",
  };
}
