/** Canonical +500 Steals scan progress — monotonic steps with live stats. */

export type StealProgressStage =
  | "connected"
  | "games-loaded"
  | "props-loaded"
  | "comparing-odds"
  | "running-ev"
  | "running-simulations"
  | "ranking";

export type StealCanonicalProgress = {
  scanId: string;
  stage: StealProgressStage;
  stepIndex: number;
  totalSteps: number;
  percent: number;
  booksConnected: number;
  gamesLoaded: number;
  propsLoaded: number;
  terminal: boolean;
  timedOut: boolean;
};

export const STEAL_PROGRESS_STAGE_ORDER: StealProgressStage[] = [
  "connected",
  "games-loaded",
  "props-loaded",
  "comparing-odds",
  "running-ev",
  "running-simulations",
  "ranking",
];

export const STEAL_PROGRESS_TOTAL_STEPS = STEAL_PROGRESS_STAGE_ORDER.length;

const STAGE_PERCENT: Record<StealProgressStage, number> = {
  connected: 10,
  "games-loaded": 24,
  "props-loaded": 38,
  "comparing-odds": 54,
  "running-ev": 68,
  "running-simulations": 82,
  ranking: 96,
};

export function stealProgressStageRank(stage: StealProgressStage): number {
  return STEAL_PROGRESS_STAGE_ORDER.indexOf(stage);
}

export function stealProgressStageLabel(
  stage: StealProgressStage,
  stats: { gamesLoaded: number; propsLoaded: number },
): string {
  switch (stage) {
    case "connected":
      return "Connected to sportsbooks";
    case "games-loaded":
      return stats.gamesLoaded > 0
        ? `Loaded ${stats.gamesLoaded} games`
        : "Loading games…";
    case "props-loaded":
      return stats.propsLoaded > 0
        ? `Loaded ${stats.propsLoaded} player props`
        : "Loading player props…";
    case "comparing-odds":
      return "Comparing odds across sportsbooks";
    case "running-ev":
      return "Running EV calculations";
    case "running-simulations":
      return "Running simulations";
    case "ranking":
      return "Ranking +500 opportunities";
  }
}

export function stealProgressChecklist(progress: StealCanonicalProgress): {
  label: string;
  done: boolean;
  active: boolean;
}[] {
  const rank = stealProgressStageRank(progress.stage);
  return STEAL_PROGRESS_STAGE_ORDER.map((stage, index) => {
    const done = index < rank || (index === rank && progress.terminal);
    const active = index === rank && !progress.terminal;
    return {
      label: stealProgressStageLabel(stage, {
        gamesLoaded: progress.gamesLoaded,
        propsLoaded: progress.propsLoaded,
      }),
      done,
      active,
    };
  });
}

export function initialStealProgress(scanId: string): StealCanonicalProgress {
  return {
    scanId,
    stage: "connected",
    stepIndex: 1,
    totalSteps: STEAL_PROGRESS_TOTAL_STEPS,
    percent: STAGE_PERCENT.connected,
    booksConnected: 0,
    gamesLoaded: 0,
    propsLoaded: 0,
    terminal: false,
    timedOut: false,
  };
}

export type StealProgressPatch = {
  scanId: string;
  stage?: StealProgressStage;
  percent?: number;
  booksConnected?: number;
  gamesLoaded?: number;
  propsLoaded?: number;
  terminal?: boolean;
  timedOut?: boolean;
};

export function mergeStealProgress(
  current: StealCanonicalProgress | undefined,
  patch: StealProgressPatch,
): StealCanonicalProgress | null {
  const base = current ?? initialStealProgress(patch.scanId);
  if (base.terminal) return null;
  if (base.scanId !== patch.scanId) return base;

  const nextStage = patch.stage ?? base.stage;
  const nextRank = stealProgressStageRank(nextStage);
  const baseRank = stealProgressStageRank(base.stage);
  if (nextRank < baseRank) return null;

  const stagePercent = STAGE_PERCENT[nextStage];
  const nextPercent = Math.max(base.percent, patch.percent ?? stagePercent, stagePercent);
  const merged: StealCanonicalProgress = {
    scanId: patch.scanId,
    stage: nextRank > baseRank ? nextStage : base.stage,
    stepIndex: Math.max(base.stepIndex, nextRank + 1),
    totalSteps: STEAL_PROGRESS_TOTAL_STEPS,
    percent: nextRank > baseRank ? Math.max(stagePercent, nextPercent) : nextPercent,
    booksConnected: Math.max(base.booksConnected, patch.booksConnected ?? 0),
    gamesLoaded: Math.max(base.gamesLoaded, patch.gamesLoaded ?? 0),
    propsLoaded: Math.max(base.propsLoaded, patch.propsLoaded ?? 0),
    terminal: base.terminal || patch.terminal === true,
    timedOut: base.timedOut || patch.timedOut === true,
  };

  if (merged.terminal) {
    merged.percent = 100;
    merged.stepIndex = STEAL_PROGRESS_TOTAL_STEPS;
    merged.stage = "ranking";
  }

  if (
    base.stage === merged.stage &&
    base.percent === merged.percent &&
    base.booksConnected === merged.booksConnected &&
    base.gamesLoaded === merged.gamesLoaded &&
    base.propsLoaded === merged.propsLoaded &&
    base.terminal === merged.terminal &&
    base.timedOut === merged.timedOut
  ) {
    return null;
  }
  return merged;
}

export type StealProgressLiveInput = {
  booksScanned?: number;
  gamesScanned?: number;
  marketsChecked?: number;
  longshotsAnalyzed?: number;
  scanComplete?: boolean;
  stealsFound?: number;
};

/** Map server scan meta into monotonic progress patches. */
export function stealProgressFromLiveScan(
  scanId: string,
  live: StealProgressLiveInput,
): StealProgressPatch {
  const books = live.booksScanned ?? 0;
  const games = live.gamesScanned ?? 0;
  const props = live.longshotsAnalyzed ?? 0;
  const markets = live.marketsChecked ?? 0;

  if (live.scanComplete) {
    return {
      scanId,
      stage: "ranking",
      percent: 100,
      booksConnected: books,
      gamesLoaded: games,
      propsLoaded: props,
      terminal: true,
    };
  }
  if (markets > 0 || (live.stealsFound ?? 0) > 0) {
    return {
      scanId,
      stage: "running-simulations",
      booksConnected: books,
      gamesLoaded: games,
      propsLoaded: props,
    };
  }
  if (props > 0) {
    return {
      scanId,
      stage: "running-ev",
      booksConnected: books,
      gamesLoaded: games,
      propsLoaded: props,
    };
  }
  if (games > 0) {
    return {
      scanId,
      stage: "comparing-odds",
      booksConnected: books,
      gamesLoaded: games,
      propsLoaded: props,
    };
  }
  if (books > 0) {
    return {
      scanId,
      stage: "props-loaded",
      booksConnected: books,
      gamesLoaded: games,
      propsLoaded: props,
    };
  }
  return { scanId, stage: "connected", booksConnected: books };
}

/** Time-based fallback when the server has not returned meta yet. */
export function stealProgressFromElapsedMs(scanId: string, elapsedMs: number): StealProgressPatch {
  if (elapsedMs < 800) return { scanId, stage: "connected" };
  if (elapsedMs < 2_000) return { scanId, stage: "games-loaded" };
  if (elapsedMs < 3_500) return { scanId, stage: "props-loaded" };
  if (elapsedMs < 5_500) return { scanId, stage: "comparing-odds" };
  if (elapsedMs < 8_000) return { scanId, stage: "running-ev" };
  if (elapsedMs < 11_000) return { scanId, stage: "running-simulations" };
  return { scanId, stage: "ranking" };
}

export const STEAL_SCAN_TIMEOUT_MS = 15_000;
