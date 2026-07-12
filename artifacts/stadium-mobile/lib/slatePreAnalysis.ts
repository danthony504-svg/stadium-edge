// Background slate pre-analysis — compact context + board scan + quick prop sim.
// Runs on app open / foreground refresh so Coach parlay builds start warm.

import {
  buildCompactParlayContext,
  getGames,
  getLiveOdds,
  getOdds,
  type BuiltChatContext,
} from "./api.ts";
import { tryReachFullBoardScan, type FullBoardScanResult } from "./boardMarketScanner.ts";
import { buildGameTeamIdMap } from "./coachGameMonteCarlo.ts";
import { enrichChatContextProps } from "./propSelection.ts";
import { filterBettableOddsGames } from "./slate.ts";
import { DEFAULT_SPORTS } from "./sports.ts";
import {
  computeSlateFingerprint,
  deserializeBoardScan,
  getSlatePreAnalysisSnapshot,
  isSlatePreAnalysisFresh,
  patchSlatePreAnalysisBoardScan,
  propSimMapToSnapshot,
  rememberSlatePreAnalysis,
  applyServerSlateSnapshot,
  serializeBoardScan,
  type SlatePreAnalysisSnapshot,
} from "./slatePreAnalysisCache.ts";
import { fetchCoachServerSlate } from "./coachSlateApi.ts";

/** Default reach target — seeds 6/9/15-leg asks via reach fill. */
export const SLATE_PRE_ANALYSIS_TARGET = 9;

let activeAbort: AbortController | null = null;
let running = false;
let coachBuildBusy = false;
let lastForegroundRunAt = 0;

export function setCoachBuildBusy(busy: boolean): void {
  coachBuildBusy = busy;
}

export function isSlatePreAnalysisRunning(): boolean {
  return running;
}

export function stopSlatePreAnalysis(): void {
  activeAbort?.abort();
  activeAbort = null;
  running = false;
}

export type SlatePreAnalysisSeed = {
  built: BuiltChatContext;
  propSimulations: Map<string, { hitProbability: number | null }>;
  boardScan: FullBoardScanResult | null;
  fingerprint: string;
};

/** Read a fresh cached snapshot for Coach parlay builds. */
export function readSlatePreAnalysisSeed(): SlatePreAnalysisSeed | null {
  const snap = getSlatePreAnalysisSnapshot();
  if (!snap) return null;
  return {
    built: snap.built,
    propSimulations: new Map(snap.propSimulations),
    boardScan: snap.boardScan ? deserializeBoardScan(snap.boardScan) : null,
    fingerprint: snap.fingerprint,
  };
}

async function fetchScanFeeds(signal?: AbortSignal) {
  const scanSports = DEFAULT_SPORTS;
  const [espnGames, oddsGames, liveFeed] = await Promise.all([
    Promise.all(scanSports.map((s) => getGames(s, signal).catch(() => []))).then((rows) =>
      rows.flat(),
    ),
    Promise.all(scanSports.map((s) => getOdds(s, signal).catch(() => []))).then((rows) =>
      filterBettableOddsGames(rows.flat()),
    ),
    getLiveOdds(scanSports, signal).catch(() => ({ games: [], odds: [] })),
  ]);
  return { espnGames, oddsGames, liveFeed };
}

async function runBoardScan(
  built: BuiltChatContext,
  propSimulations: Map<string, { hitProbability: number | null }>,
  signal?: AbortSignal,
  onPartial?: (partial: FullBoardScanResult) => void,
): Promise<FullBoardScanResult | null> {
  const { context, propPool, gameMeta } = built;
  const { espnGames, oddsGames, liveFeed } = await fetchScanFeeds(signal);
  if (signal?.aborted) return null;
  const teamIdMap = buildGameTeamIdMap(espnGames);
  return tryReachFullBoardScan({
    target: SLATE_PRE_ANALYSIS_TARGET,
    oddsGames,
    propPool,
    realOdds: context.realOdds,
    liveOdds: liveFeed.odds,
    espnGames,
    gameMeta,
    teamIdMap,
    matchupHistory: context.matchupHistory,
    matchupInjuries: context.matchupInjuries,
    playerHistory: context.playerHistory as Record<string, import("./pickScoreContext.ts").PlayerHistorySlice> | undefined,
    signal,
    onPartial: (partial) => {
      void patchSlatePreAnalysisBoardScan(partial);
      onPartial?.(partial);
    },
  });
}

/** Full pre-analysis pass — never throws. */
export async function runSlatePreAnalysis(opts?: {
  signal?: AbortSignal;
  onPartialBoard?: (partial: FullBoardScanResult) => void;
}): Promise<SlatePreAnalysisSnapshot | null> {
  const signal = opts?.signal;
  try {
    const built = await buildCompactParlayContext(SLATE_PRE_ANALYSIS_TARGET, signal);
    if (signal?.aborted) return null;

    const existing = getSlatePreAnalysisSnapshot();
    const fingerprint = computeSlateFingerprint(built);
    if (existing && existing.fingerprint === fingerprint && isSlatePreAnalysisFresh(existing)) {
      return existing;
    }

    const { built: enrichedBuilt, propSimulations } = await enrichChatContextProps(built, signal, {
      requestedLegs: SLATE_PRE_ANALYSIS_TARGET,
    });
    if (signal?.aborted) return null;

    const boardScan = await runBoardScan(
      enrichedBuilt,
      propSimulations,
      signal,
      opts?.onPartialBoard,
    );
    if (signal?.aborted) return null;

    const snapshot: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: computeSlateFingerprint(enrichedBuilt),
      built: enrichedBuilt,
      propSimulations: propSimMapToSnapshot(propSimulations),
      boardScan: boardScan ? serializeBoardScan(boardScan) : null,
      deepSimComplete: false,
    };
    await rememberSlatePreAnalysis(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/** Pull latest server-precomputed slate into local cache (instant Coach seed). */
export async function syncServerSlatePreAnalysis(): Promise<boolean> {
  try {
    const resp = await fetchCoachServerSlate();
    if (!resp?.fresh || !resp.snapshot) return false;
    return applyServerSlateSnapshot(resp.snapshot);
  } catch {
    return false;
  }
}

/** Start or refresh background pre-analysis (no-op when Coach is building). */
export function startSlatePreAnalysis(reason = "manual"): void {
  if (coachBuildBusy || running) return;
  const snap = getSlatePreAnalysisSnapshot();
  if (snap && isSlatePreAnalysisFresh(snap) && reason === "foreground") {
    const since = Date.now() - lastForegroundRunAt;
    if (since < 45_000) return;
  }
  stopSlatePreAnalysis();
  const controller = new AbortController();
  activeAbort = controller;
  running = true;
  lastForegroundRunAt = Date.now();
  void (async () => {
    await syncServerSlatePreAnalysis().catch(() => false);
    if (controller.signal.aborted) return;
    const seeded = getSlatePreAnalysisSnapshot();
    if (seeded && isSlatePreAnalysisFresh(seeded) && seeded.boardScan?.picks?.length) {
      if (!seeded.deepSimComplete) {
        return runSlatePreAnalysis({ signal: controller.signal });
      }
      return seeded;
    }
    return runSlatePreAnalysis({ signal: controller.signal });
  })()
    .catch(() => null)
    .finally(() => {
      if (activeAbort === controller) activeAbort = null;
      running = false;
    });
}
