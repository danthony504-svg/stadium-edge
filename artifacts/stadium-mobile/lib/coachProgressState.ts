/** Canonical Coach parlay-build progress — one object per requestId. */

export type CoachProgressStage =
  | "loading-games"
  | "analyzing-props"
  | "calculating-edge"
  | "running-simulations"
  | "building-ticket"
  | "complete";

export type CoachCanonicalProgress = {
  requestId: string;
  stage: CoachProgressStage;
  percent: number;
  gamesLoaded: number;
  propsComplete: boolean;
  edgeComplete: boolean;
  simulationsComplete: boolean;
  ticketComplete: boolean;
  terminal: boolean;
};

export const COACH_PROGRESS_STAGE_ORDER: CoachProgressStage[] = [
  "loading-games",
  "analyzing-props",
  "calculating-edge",
  "running-simulations",
  "building-ticket",
  "complete",
];

const STAGE_PERCENT: Record<CoachProgressStage, number> = {
  "loading-games": 12,
  "analyzing-props": 28,
  "calculating-edge": 52,
  "running-simulations": 74,
  "building-ticket": 92,
  complete: 100,
};

export function coachProgressStageRank(stage: CoachProgressStage): number {
  return COACH_PROGRESS_STAGE_ORDER.indexOf(stage);
}

export function coachProgressSignature(p: CoachCanonicalProgress): string {
  return `${p.requestId}:${p.stage}:${p.percent}:${p.gamesLoaded}:${p.propsComplete}:${p.edgeComplete}:${p.simulationsComplete}:${p.ticketComplete}:${p.terminal}`;
}

export function coachProgressStageLabel(stage: CoachProgressStage, gamesLoaded: number): string {
  switch (stage) {
    case "loading-games":
      return gamesLoaded > 0 ? `${gamesLoaded} games loaded` : "Loading today's games…";
    case "analyzing-props":
      return "Analyzing player props…";
    case "calculating-edge":
      return "Calculating edge…";
    case "running-simulations":
      return "Running AI simulations…";
    case "building-ticket":
      return "Building your best parlay…";
    case "complete":
      return "Ticket ready";
  }
}

export function coachProgressHeadline(stage: CoachProgressStage): string {
  switch (stage) {
    case "loading-games":
      return "Scanning today's games…";
    case "analyzing-props":
      return "Analyzing player props…";
    case "calculating-edge":
      return "Calculating edge…";
    case "running-simulations":
      return "Running AI simulations…";
    case "building-ticket":
      return "Building your best parlay…";
    case "complete":
      return "Finalizing your ticket…";
  }
}

export function initialCoachProgress(requestId: string): CoachCanonicalProgress {
  return {
    requestId,
    stage: "loading-games",
    percent: STAGE_PERCENT["loading-games"],
    gamesLoaded: 0,
    propsComplete: false,
    edgeComplete: false,
    simulationsComplete: false,
    ticketComplete: false,
    terminal: false,
  };
}

export type CoachProgressPatch = {
  requestId: string;
  stage?: CoachProgressStage;
  percent?: number;
  gamesLoaded?: number;
  propsComplete?: boolean;
  edgeComplete?: boolean;
  simulationsComplete?: boolean;
  ticketComplete?: boolean;
  terminal?: boolean;
};

function logCoachProgress(event: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[coach-progress] ${event}`, JSON.stringify(detail));
  } else {
    console.log(`[coach-progress] ${event}`);
  }
}

/** Merge a progress event monotonically; returns null when the event should be ignored. */
export function mergeCoachProgress(
  current: CoachCanonicalProgress | undefined,
  patch: CoachProgressPatch,
): CoachCanonicalProgress | null {
  const base = current ?? initialCoachProgress(patch.requestId);
  if (base.terminal) {
    logCoachProgress("terminal-locked", { requestId: patch.requestId });
    return null;
  }
  if (base.requestId !== patch.requestId) {
    return base;
  }

  const nextStage = patch.stage ?? base.stage;
  const nextRank = coachProgressStageRank(nextStage);
  const baseRank = coachProgressStageRank(base.stage);
  if (nextRank < baseRank) {
    logCoachProgress("ignored-stale-event", {
      requestId: patch.requestId,
      stage: nextStage,
      percent: patch.percent ?? base.percent,
      reason: "stage-rank",
    });
    return null;
  }

  const stagePercent = STAGE_PERCENT[nextStage];
  const nextPercent = Math.max(base.percent, patch.percent ?? stagePercent, stagePercent);
  if (patch.percent != null && patch.percent < base.percent && nextRank === baseRank) {
    logCoachProgress("ignored-stale-event", {
      requestId: patch.requestId,
      stage: nextStage,
      percent: patch.percent,
      reason: "percent",
    });
    return null;
  }

  const merged: CoachCanonicalProgress = {
    requestId: patch.requestId,
    stage: nextRank > baseRank ? nextStage : base.stage,
    percent: nextRank > baseRank ? Math.max(stagePercent, nextPercent) : nextPercent,
    gamesLoaded: Math.max(base.gamesLoaded, patch.gamesLoaded ?? 0),
    propsComplete: base.propsComplete || patch.propsComplete === true,
    edgeComplete: base.edgeComplete || patch.edgeComplete === true,
    simulationsComplete: base.simulationsComplete || patch.simulationsComplete === true,
    ticketComplete: base.ticketComplete || patch.ticketComplete === true,
    terminal: base.terminal || patch.terminal === true,
  };

  if (merged.stage !== "loading-games" && merged.gamesLoaded > 0) {
    merged.propsComplete = true;
  }
  if (coachProgressStageRank(merged.stage) >= coachProgressStageRank("analyzing-props")) {
    merged.propsComplete = true;
  }
  if (coachProgressStageRank(merged.stage) >= coachProgressStageRank("calculating-edge")) {
    merged.edgeComplete = true;
  }
  if (coachProgressStageRank(merged.stage) >= coachProgressStageRank("running-simulations")) {
    merged.simulationsComplete = true;
  }
  if (coachProgressStageRank(merged.stage) >= coachProgressStageRank("building-ticket")) {
    merged.ticketComplete = merged.ticketComplete || merged.stage === "building-ticket";
  }
  if (merged.stage === "complete" || merged.terminal) {
    merged.percent = 100;
    merged.propsComplete = true;
    merged.edgeComplete = true;
    merged.simulationsComplete = true;
    merged.ticketComplete = merged.ticketComplete || patch.ticketComplete === true;
    merged.terminal = true;
    merged.stage = "complete";
  }

  if (coachProgressSignature(base) === coachProgressSignature(merged)) {
    return null;
  }
  return merged;
}

export function coachProgressFromBuildPhase(
  requestId: string,
  phase: "context" | "board-scan" | "stream" | "score" | "idle",
  opts?: {
    gamesLoaded?: number;
    scanComplete?: boolean;
    picksReady?: number;
    exhaustedEmpty?: boolean;
  },
): CoachProgressPatch | null {
  if (phase === "idle") return null;
  if (opts?.exhaustedEmpty) {
    return {
      requestId,
      stage: "complete",
      percent: 100,
      terminal: true,
      ticketComplete: false,
      simulationsComplete: true,
      edgeComplete: true,
      propsComplete: true,
      gamesLoaded: opts.gamesLoaded ?? 0,
    };
  }
  if (phase === "context") {
    return { requestId, stage: "loading-games", gamesLoaded: opts?.gamesLoaded ?? 0 };
  }
  if (phase === "board-scan") {
    const games = opts?.gamesLoaded ?? 0;
    if (games <= 0) {
      return { requestId, stage: "loading-games", gamesLoaded: 0 };
    }
    if (!opts?.scanComplete) {
      return {
        requestId,
        stage: "running-simulations",
        gamesLoaded: games,
        propsComplete: true,
        edgeComplete: true,
      };
    }
    if ((opts?.picksReady ?? 0) > 0) {
      return {
        requestId,
        stage: "building-ticket",
        gamesLoaded: games,
        propsComplete: true,
        edgeComplete: true,
        simulationsComplete: true,
        ticketComplete: true,
      };
    }
    return {
      requestId,
      stage: "running-simulations",
      gamesLoaded: games,
      propsComplete: true,
      edgeComplete: true,
      simulationsComplete: true,
    };
  }
  if (phase === "stream" || phase === "score") {
    return {
      requestId,
      stage: "building-ticket",
      gamesLoaded: opts?.gamesLoaded ?? 0,
      propsComplete: true,
      edgeComplete: true,
      simulationsComplete: true,
      ticketComplete: (opts?.picksReady ?? 0) > 0,
    };
  }
  return null;
}

export function coachProgressChecklist(progress: CoachCanonicalProgress): {
  label: string;
  done: boolean;
  active: boolean;
}[] {
  const rank = coachProgressStageRank(progress.stage);
  const rows: { stage: CoachProgressStage; label: string }[] = [
    {
      stage: "loading-games",
      label:
        progress.gamesLoaded > 0
          ? `${progress.gamesLoaded} games loaded`
          : "Loading today's games…",
    },
    { stage: "analyzing-props", label: "Analyzing player props…" },
    { stage: "calculating-edge", label: "Calculating edge…" },
    { stage: "running-simulations", label: "Running AI simulations…" },
    { stage: "building-ticket", label: "Building your best parlay…" },
  ];
  return rows.map((row) => {
    const rowRank = coachProgressStageRank(row.stage);
    const done = rowRank < rank || (rowRank === rank && progress.terminal);
    const active = rowRank === rank && !progress.terminal;
    return { label: row.label, done, active };
  });
}

export function coachProgressFromLiveScan(
  requestId: string,
  live: {
    gamesLoaded: number;
    propsAnalyzed: number;
    marketsScanned: number;
    simRunning: boolean;
    scanComplete: boolean;
    picksReady: number;
    exhaustedEmpty?: boolean;
  },
): CoachProgressPatch {
  if (live.exhaustedEmpty || (live.scanComplete && live.picksReady === 0)) {
    return {
      requestId,
      stage: "complete",
      percent: 100,
      gamesLoaded: live.gamesLoaded,
      propsComplete: true,
      edgeComplete: true,
      simulationsComplete: true,
      ticketComplete: false,
      terminal: true,
    };
  }
  if (live.scanComplete && live.picksReady > 0) {
    return {
      requestId,
      stage: "building-ticket",
      percent: 92,
      gamesLoaded: live.gamesLoaded,
      propsComplete: true,
      edgeComplete: true,
      simulationsComplete: true,
      ticketComplete: true,
    };
  }
  if (live.simRunning || live.scanComplete) {
    return {
      requestId,
      stage: "running-simulations",
      gamesLoaded: live.gamesLoaded,
      propsComplete: true,
      edgeComplete: true,
      simulationsComplete: live.scanComplete,
    };
  }
  if (live.marketsScanned > 0) {
    return {
      requestId,
      stage: "calculating-edge",
      gamesLoaded: live.gamesLoaded,
      propsComplete: true,
      edgeComplete: true,
    };
  }
  if (live.propsAnalyzed > 0) {
    return {
      requestId,
      stage: "analyzing-props",
      gamesLoaded: live.gamesLoaded,
      propsComplete: true,
    };
  }
  return {
    requestId,
    stage: "loading-games",
    gamesLoaded: live.gamesLoaded,
  };
}

export { logCoachProgress };
