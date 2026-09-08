/** Real Coach parlay-build progress — driven by scan phase, not timers. */

export type ParlayBuildPhase = "context" | "board-scan" | "stream" | "score";

export type CoachBuildChecklistStage =
  | "matchups"
  | "injury"
  | "line-value"
  | "correlation"
  | "final-ticket";

export type CoachBuildProgressSnapshot = {
  stageIndex: number;
  percent: number;
  checklistStage: CoachBuildChecklistStage;
  slowStageLabel: string;
};

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
    return {
      stageIndex: 9,
      percent: 100,
      checklistStage: "final-ticket",
      slowStageLabel: SLOW_STAGE_LABEL["final-ticket"],
    };
  }
  switch (buildPhase) {
    case "score":
      return {
        stageIndex: 8,
        percent: 93,
        checklistStage: "correlation",
        slowStageLabel: SLOW_STAGE_LABEL.correlation,
      };
    case "stream":
      return {
        stageIndex: 7,
        percent: 74,
        checklistStage: "correlation",
        slowStageLabel: SLOW_STAGE_LABEL.correlation,
      };
    case "board-scan":
      return {
        stageIndex: 5,
        percent: 64,
        checklistStage: "line-value",
        slowStageLabel: SLOW_STAGE_LABEL["line-value"],
      };
    case "context":
      return {
        stageIndex: 3,
        percent: 40,
        checklistStage: "injury",
        slowStageLabel: SLOW_STAGE_LABEL.injury,
      };
    default:
      return {
        stageIndex: 1,
        percent: 16,
        checklistStage: "matchups",
        slowStageLabel: SLOW_STAGE_LABEL.matchups,
      };
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
