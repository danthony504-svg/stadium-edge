/** Client-side +500 Steals stage timing — detect stalled steps and log durations. */

import {
  type StealProgressStage,
  type StealServerStageName,
  STEAL_STAGE_TIMEOUT_MS,
} from "./stealProgressState.ts";
import { logStealScanLifecycle } from "./stealScanLifecycle.ts";

export type StealServerStageTiming = {
  stage: StealServerStageName;
  durationMs: number;
  completed: boolean;
  skipped?: boolean;
  detail?: string;
};

export { STEAL_STAGE_TIMEOUT_MS };

const UI_TO_SERVER_STAGE: Record<StealProgressStage, StealServerStageName> = {
  connected: "games",
  "games-loaded": "games",
  "props-loaded": "props",
  "comparing-odds": "comparing-odds",
  "running-ev": "running-ev",
  "running-simulations": "running-simulations",
  ranking: "ranking",
};

export function stealServerStageLabel(stage: StealServerStageName): string {
  switch (stage) {
    case "games":
      return "games";
    case "props":
      return "props";
    case "comparing-odds":
      return "odds comparison";
    case "running-ev":
      return "EV";
    case "running-simulations":
      return "simulations";
    case "ranking":
      return "ranking";
  }
}

export function stealProgressStageToServerStage(stage: StealProgressStage): StealServerStageName {
  return UI_TO_SERVER_STAGE[stage];
}

export function logStealServerStageTimings(
  scanId: string,
  timings: StealServerStageTiming[] | undefined,
  stalledStage?: StealServerStageName,
): void {
  if (!timings?.length && !stalledStage) return;
  for (const row of timings ?? []) {
    console.info(
      "[steals-scan-stage]",
      JSON.stringify({
        scanId,
        stage: row.stage,
        durationMs: row.durationMs,
        completed: row.completed,
        skipped: row.skipped ?? false,
        detail: row.detail ?? null,
      }),
    );
  }
  if (stalledStage) {
    logStealScanLifecycle({
      stage: "scan_incomplete",
      endpoint: "/api/sports/live-steals",
      detail: `stalled_stage=${stalledStage}`,
    });
  }
}

export function stealClientStageTimeoutPatch(
  scanId: string,
  stage: StealProgressStage,
  stageEnteredAtMs: number,
  nowMs: number,
): {
  scanId: string;
  stage: StealProgressStage;
  terminal: true;
  timedOut: true;
  percent: 100;
  stalledStage: StealServerStageName;
} | null {
  const elapsed = nowMs - stageEnteredAtMs;
  if (elapsed < STEAL_STAGE_TIMEOUT_MS) return null;
  const stalledStage = stealProgressStageToServerStage(stage);
  console.info(
    "[steals-scan-stage]",
    JSON.stringify({
      scanId,
      stage: stalledStage,
      durationMs: elapsed,
      completed: false,
      skipped: true,
      detail: "client_stage_timeout",
      uiStage: stage,
    }),
  );
  logStealScanLifecycle({
    stage: "scan_incomplete",
    endpoint: "/api/sports/live-steals",
    detail: `client_timeout_stage=${stalledStage}`,
  });
  return {
    scanId,
    stage,
    terminal: true,
    timedOut: true,
    percent: 100,
    stalledStage,
  };
}
