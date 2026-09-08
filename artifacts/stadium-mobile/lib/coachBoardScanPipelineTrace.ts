// Stage-by-stage board scan pipeline tracing — counts after every step.

export type CoachBoardScanPipelineStage =
  | "1-scan-start"
  | "2-fetch-markets"
  | "3-games-filtered"
  | "4-props-filtered"
  | "5-props-expanded"
  | "6-game-lines-scored"
  | "7-props-scored"
  | "8-ticket-staged"
  | "9-coach-delivered";

export type BoardScanPipelineSnapshot = {
  requestId?: string;
  targetLegs?: number;
  oddsGamesRaw?: number;
  propPoolRaw?: number;
  gamesFiltered?: number;
  propsFiltered?: number;
  propsExpanded?: number;
  gameLinesEvaluated?: number;
  gameLinesScored?: number;
  propsRealistic?: number;
  propsScored?: number;
  marketsSurvivedFilter?: number;
  picksStaged?: number;
  picksQualified?: number;
  picksDelivered?: number;
  scanComplete?: boolean;
  stopStage?: CoachBoardScanPipelineStage;
  stopReason?: string;
};

let lastSnapshot: BoardScanPipelineSnapshot = {};

export function boardScanPipelineSnapshot(): Readonly<BoardScanPipelineSnapshot> {
  return lastSnapshot;
}

const ZERO_STOP_STAGES: CoachBoardScanPipelineStage[] = [
  "3-games-filtered",
  "4-props-filtered",
  "8-ticket-staged",
  "9-coach-delivered",
];

function defaultStopReason(stage: CoachBoardScanPipelineStage, count: number): string {
  switch (stage) {
    case "3-games-filtered":
      return count === 0
        ? "No bettable games in horizon after sportsbook fetch — check getOdds/getGames and slate filters"
        : "";
    case "4-props-filtered":
      return count === 0
        ? "Prop pool empty after bettable/excluded-sport filters — check buildChatContext realProps"
        : "";
    case "8-ticket-staged":
      return count === 0
        ? "Scored legs exist but ticket staging produced zero picks — check sim grade / AI recommend gates"
        : "";
    case "9-coach-delivered":
      return count === 0
        ? "Staged picks exist but delivery gates zeroed the ticket — check filterCoachDeliveredPicks"
        : "";
    default:
      return "";
  }
}

/** Log count after a pipeline stage; records STOP when a blocking stage hits zero. */
export function logBoardScanPipeline(
  stage: CoachBoardScanPipelineStage,
  count: number,
  detail: Partial<BoardScanPipelineSnapshot> & { extra?: Record<string, unknown> } = {},
): void {
  const { extra, ...snapshotFields } = detail;
  lastSnapshot = { ...lastSnapshot, ...snapshotFields };
  const payload = {
    stage,
    count,
    ...lastSnapshot,
    ...(extra ?? {}),
  };
  console.log(`[coach-board-scan] ${stage} count=${count}`, JSON.stringify(payload));

  if (count === 0 && ZERO_STOP_STAGES.includes(stage)) {
    const reason = snapshotFields.stopReason ?? defaultStopReason(stage, count);
    if (reason) {
      lastSnapshot = { ...lastSnapshot, stopStage: stage, stopReason: reason };
      console.warn(`[coach-board-scan] STOP at ${stage}: ${reason}`);
    }
  }
}
