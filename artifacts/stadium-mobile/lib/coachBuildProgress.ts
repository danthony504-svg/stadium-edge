/** Real Coach parlay-build progress — driven by scan phase, not timers. */

export type ParlayBuildPhase = "context" | "board-scan" | "stream" | "score";

export type CoachBuildChecklistStage =
  | "matchups"
  | "injury"
  | "line-value"
  | "correlation"
  | "final-ticket";

export type CoachBuildProgressSnapshot = {
  phase: ParlayBuildPhase | undefined;
  stageIndex: number;
  percent: number;
  checklistStage: CoachBuildChecklistStage;
  slowStageLabel: string;
  matchupComplete: boolean;
  injuryComplete: boolean;
  lineValueComplete: boolean;
  correlationComplete: boolean;
  ticketComplete: boolean;
};

const CHECKLIST_DONE_AT = {
  matchup: 3,
  injury: 4,
  lineValue: 6,
  correlation: 7,
  ticket: 9,
} as const;

function coachBuildChecklistFlags(
  stageIndex: number,
  legCount: number,
): Pick<
  CoachBuildProgressSnapshot,
  "matchupComplete" | "injuryComplete" | "lineValueComplete" | "correlationComplete" | "ticketComplete"
> {
  return {
    matchupComplete: stageIndex >= CHECKLIST_DONE_AT.matchup,
    injuryComplete: stageIndex >= CHECKLIST_DONE_AT.injury,
    lineValueComplete: stageIndex >= CHECKLIST_DONE_AT.lineValue,
    correlationComplete: stageIndex >= CHECKLIST_DONE_AT.correlation,
    ticketComplete: legCount > 0 || stageIndex >= CHECKLIST_DONE_AT.ticket,
  };
}

const SLOW_STAGE_LABEL: Record<CoachBuildChecklistStage, string> = {
  matchups: "matchups",
  injury: "injury report",
  "line-value": "line value",
  correlation: "correlation",
  "final-ticket": "final ticket",
};

/** Map live build phase + leg stream to checklist index and percent. */
export function coachBuildProgressFromPhase(
  buildPhase: ParlayBuildPhase | undefined,
  legCount: number,
): CoachBuildProgressSnapshot {
  if (legCount > 0) {
    const stageIndex = 9;
    return {
      phase: buildPhase,
      stageIndex,
      percent: 100,
      checklistStage: "final-ticket",
      slowStageLabel: SLOW_STAGE_LABEL["final-ticket"],
      ...coachBuildChecklistFlags(stageIndex, legCount),
    };
  }
  switch (buildPhase) {
    case "score": {
      const stageIndex = 8;
      return {
        phase: buildPhase,
        stageIndex,
        percent: 93,
        checklistStage: "correlation",
        slowStageLabel: SLOW_STAGE_LABEL.correlation,
        ...coachBuildChecklistFlags(stageIndex, legCount),
      };
    }
    case "stream": {
      const stageIndex = 7;
      return {
        phase: buildPhase,
        stageIndex,
        percent: 74,
        checklistStage: "correlation",
        slowStageLabel: SLOW_STAGE_LABEL.correlation,
        ...coachBuildChecklistFlags(stageIndex, legCount),
      };
    }
    case "board-scan": {
      const stageIndex = 5;
      return {
        phase: buildPhase,
        stageIndex,
        percent: 64,
        checklistStage: "line-value",
        slowStageLabel: SLOW_STAGE_LABEL["line-value"],
        ...coachBuildChecklistFlags(stageIndex, legCount),
      };
    }
    case "context": {
      const stageIndex = 3;
      return {
        phase: buildPhase,
        stageIndex,
        percent: 40,
        checklistStage: "injury",
        slowStageLabel: SLOW_STAGE_LABEL.injury,
        ...coachBuildChecklistFlags(stageIndex, legCount),
      };
    }
    default: {
      const stageIndex = 1;
      return {
        phase: buildPhase,
        stageIndex,
        percent: 16,
        checklistStage: "matchups",
        slowStageLabel: SLOW_STAGE_LABEL.matchups,
        ...coachBuildChecklistFlags(stageIndex, legCount),
      };
    }
  }
}

export function coachBuildProgressSignature(opts: {
  requestId?: string;
  stage: string;
  percent: number;
  ticketId?: string;
}): string {
  return `${opts.requestId ?? ""}|${opts.stage}|${opts.percent}|${opts.ticketId ?? ""}`;
}
