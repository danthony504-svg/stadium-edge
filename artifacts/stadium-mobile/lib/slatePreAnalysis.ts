// Background slate pre-analysis — server-first; local scan only when cache is cold.

import {
  buildCompactParlayContext,
  getGames,
  getLiveOdds,
  getOdds,
  type BuiltChatContext,
} from "./api.ts";
import { tryReachFullBoardScan, type FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanMeetsLegTarget, boardScanReadyForDelivery } from "./coachScanPolicy.ts";
import { buildGameTeamIdMap } from "./coachGameMonteCarlo.ts";
import { enrichChatContextProps } from "./propSelection.ts";
import { filterBettableOddsGames, filterBettablePropPool, filterCoachHorizonPicksAfterEnrich, isPregameBettableForSport } from "./slate.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import type { MatchupHistoryEntry } from "./api.ts";
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
  resolveSlateBoardScan,
  serializeBoardScan,
  SLATE_PRE_ANALYSIS_TARGET,
  type SlateParlayLegCount,
  type SerializedBoardScan,
  type SlatePreAnalysisSnapshot,
  type SlateTicketsIndex,
} from "./slatePreAnalysisCache.ts";
import { fetchCoachServerSlate } from "./coachSlateApi.ts";

export { SLATE_PRE_ANALYSIS_TARGET };

let activeAbort: AbortController | null = null;
let running = false;
let coachBuildBusy = false;
let lastForegroundRunAt = 0;
let openWarmInterval: ReturnType<typeof setInterval> | null = null;

const OPEN_WARM_INTERVAL_MS = 120_000;

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
  if (openWarmInterval) {
    clearInterval(openWarmInterval);
    openWarmInterval = null;
  }
}

/** Keep pulling server-precomputed scores while the app stays open. */
export function startSlatePreAnalysisOpenWarm(): void {
  if (openWarmInterval) return;
  openWarmInterval = setInterval(() => {
    void syncServerSlatePreAnalysis().catch(() => false);
    if (!coachBuildBusy && !running) {
      startSlatePreAnalysis("open-warm");
    }
  }, OPEN_WARM_INTERVAL_MS);
}

export type SlatePreAnalysisSeed = {
  built: BuiltChatContext;
  propSimulations: Map<string, { hitProbability: number | null }>;
  boardScan: FullBoardScanResult | null;
  fingerprint: string;
};

export type SlateSeedOpts = {
  legs?: number;
  sport?: string | null;
};

function coachEnrichSourcesFromBuilt(built: BuiltChatContext) {
  return {
    realOdds: built.context.realOdds,
    propPool: built.propPool,
    gameMeta: built.gameMeta,
    realGames: built.context.realGames,
  };
}

function sanitizeBuiltForCoach(built: BuiltChatContext): BuiltChatContext {
  return {
    ...built,
    context: {
      ...built.context,
      realOdds: filterBettableOddsGames(built.context.realOdds ?? []),
      realProps: filterBettablePropPool(built.context.realProps ?? []),
      realGames: (built.context.realGames ?? []).filter((g) =>
        isPregameBettableForSport(g.startsAt, g.sport ?? ""),
      ),
    },
    propPool: filterBettablePropPool(built.propPool),
  };
}

function sanitizeSerializedBoardScan(
  raw: SerializedBoardScan | null,
  built: BuiltChatContext,
): SerializedBoardScan | null {
  if (!raw?.picks?.length) return raw;
  const horizon = filterCoachHorizonPicksAfterEnrich(
    raw.picks,
    coachEnrichSourcesFromBuilt(built),
  );
  const picks = finalizeCoachDeliveryPicks(horizon, {
    matchupHistory: built.context.matchupHistory as
      | Record<string, MatchupHistoryEntry>
      | undefined,
  });
  return { ...raw, picks };
}

function sanitizeSlateSnapshot(snap: SlatePreAnalysisSnapshot): SlatePreAnalysisSnapshot {
  const built = sanitizeBuiltForCoach(snap.built);
  const boardScan = sanitizeSerializedBoardScan(snap.boardScan, built);
  let tickets: SlateTicketsIndex | null | undefined = snap.tickets;
  if (tickets) {
    const global: SlateTicketsIndex["global"] = {};
    for (const [size, scan] of Object.entries(tickets.global ?? {})) {
      const cleaned = sanitizeSerializedBoardScan(scan ?? null, built);
      if (cleaned?.picks?.length) {
        global[Number(size) as SlateParlayLegCount] = cleaned;
      }
    }
    const bySport: SlateTicketsIndex["bySport"] = {};
    for (const [sport, sizes] of Object.entries(tickets.bySport ?? {})) {
      const sportTickets: Partial<Record<SlateParlayLegCount, SerializedBoardScan>> = {};
      for (const [size, scan] of Object.entries(sizes ?? {})) {
        const cleaned = sanitizeSerializedBoardScan(scan ?? null, built);
        if (cleaned?.picks?.length) {
          sportTickets[Number(size) as SlateParlayLegCount] = cleaned;
        }
      }
      if (Object.keys(sportTickets).length) bySport[sport] = sportTickets;
    }
    tickets = { global, bySport };
  }
  return { ...snap, built, boardScan, tickets };
}

function seedFromSnapshot(
  snap: SlatePreAnalysisSnapshot,
  opts?: SlateSeedOpts,
): SlatePreAnalysisSeed {
  const clean = sanitizeSlateSnapshot(snap);
  const requested = opts?.legs ?? SLATE_PRE_ANALYSIS_TARGET;
  const boardRaw = resolveSlateBoardScan(clean, opts);
  // A completed, fresh, exact-size server ticket is already the same work the
  // foreground full-board scan would perform. Preserve its terminal status so
  // Coach can commit it immediately instead of discarding that work and
  // starting another multi-minute scan. Any stale, shallow, or mismatched
  // snapshot remains preview-only.
  const terminalSeed =
    !!boardRaw &&
    clean.deepSimComplete &&
    isSlatePreAnalysisFresh(clean) &&
    boardScanReadyForDelivery(boardRaw, requested);
  return {
    built: clean.built,
    propSimulations: new Map(clean.propSimulations),
    boardScan: boardRaw
      ? deserializeBoardScan({
          ...boardRaw,
          requestedLegs: boardRaw.requestedLegs ?? boardRaw.picks.length,
          scanComplete: terminalSeed,
        })
      : null,
    fingerprint: clean.fingerprint,
  };
}

/** Read cached snapshot for Coach parlay builds — resolves precomputed ticket size/sport. */
export function readSlatePreAnalysisSeed(opts?: SlateSeedOpts): SlatePreAnalysisSeed | null {
  const snap = getSlatePreAnalysisSnapshot();
  if (!snap) return null;
  return seedFromSnapshot(snap, opts);
}

function serverTicketsReady(snap: SlatePreAnalysisSnapshot | null, opts?: SlateSeedOpts): boolean {
  if (!snap) return false;
  const requested = opts?.legs ?? SLATE_PRE_ANALYSIS_TARGET;
  const scan = resolveSlateBoardScan(snap, opts);
  return boardScanReadyForDelivery(scan, requested);
}

/** Poll until precomputed board-scan legs are available (server or local). */
export async function awaitWarmSlateSeed(
  opts?: SlateSeedOpts & {
    signal?: AbortSignal;
    maxMs?: number;
    pollMs?: number;
  },
): Promise<SlatePreAnalysisSeed | null> {
  await syncServerSlatePreAnalysis(opts).catch(() => false);
  const maxMs = opts?.maxMs ?? 12_000;
  const pollMs = opts?.pollMs ?? 300;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) return null;
    const seed = readSlatePreAnalysisSeed(opts);
    const requested = opts?.legs ?? SLATE_PRE_ANALYSIS_TARGET;
    if (seed?.boardScan?.picks?.length && boardScanReadyForDelivery(seed.boardScan, requested)) {
      return seed;
    }
    if (!isSlatePreAnalysisRunning()) {
      await syncServerSlatePreAnalysis(opts).catch(() => false);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const last = readSlatePreAnalysisSeed(opts);
  const requested = opts?.legs ?? SLATE_PRE_ANALYSIS_TARGET;
  return last?.boardScan?.picks?.length && boardScanReadyForDelivery(last.boardScan, requested)
    ? last
    : null;
}

/** Instant hydrate from server DB — call on app boot and Coach tab focus. */
export async function hydrateCoachSlateFromServer(opts?: SlateSeedOpts): Promise<boolean> {
  return syncServerSlatePreAnalysis(opts);
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
    mlbPlatoon: context.mlbPlatoon,
    mlbGameEnv: context.mlbGameEnv,
    signal,
    onPartial: (partial) => {
      void patchSlatePreAnalysisBoardScan(partial);
      onPartial?.(partial);
    },
  });
}

/** Local fallback scan — only when server slate is cold or stale. */
export async function runSlatePreAnalysis(opts?: {
  signal?: AbortSignal;
  onPartialBoard?: (partial: FullBoardScanResult) => void;
}): Promise<SlatePreAnalysisSnapshot | null> {
  const signal = opts?.signal;
  try {
    const existing = getSlatePreAnalysisSnapshot();
    if (existing?.tickets && existing.deepSimComplete && isSlatePreAnalysisFresh(existing)) {
      return existing;
    }
    if (existing && serverTicketsReady(existing) && isSlatePreAnalysisFresh(existing)) {
      return existing;
    }

    const built = await buildCompactParlayContext(SLATE_PRE_ANALYSIS_TARGET, signal);
    if (signal?.aborted) return null;

    const fingerprint = computeSlateFingerprint(built);
    if (existing && existing.fingerprint === fingerprint && isSlatePreAnalysisFresh(existing)) {
      return existing;
    }

    const { built: enrichedBuilt, propSimulations } = await enrichChatContextProps(built, signal, {
      requestedLegs: SLATE_PRE_ANALYSIS_TARGET,
    });
    if (signal?.aborted) return null;

    const boardScan = await runBoardScan(enrichedBuilt, signal, opts?.onPartialBoard);
    if (signal?.aborted) return null;

    const snapshot: SlatePreAnalysisSnapshot = sanitizeSlateSnapshot({
      at: Date.now(),
      fingerprint: computeSlateFingerprint(enrichedBuilt),
      built: enrichedBuilt,
      propSimulations: propSimMapToSnapshot(propSimulations),
      boardScan: boardScan ? serializeBoardScan(boardScan) : null,
      deepSimComplete: false,
    });
    await rememberSlatePreAnalysis(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/** Pull latest server-precomputed slate — instant serve even when slightly stale. */
export async function syncServerSlatePreAnalysis(opts?: SlateSeedOpts): Promise<boolean> {
  try {
    const resp = await fetchCoachServerSlate(opts);
    const usable = resp?.snapshot && (resp.fresh || resp.instantServe);
    if (!usable || !resp.snapshot) return false;
    return applyServerSlateSnapshot(sanitizeSlateSnapshot(resp.snapshot));
  } catch {
    return false;
  }
}

/** Background refresh — server-first; local scan only on cold cache. */
export function startSlatePreAnalysis(reason = "manual", seedOpts?: SlateSeedOpts): void {
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
    await syncServerSlatePreAnalysis(seedOpts).catch(() => false);
    if (controller.signal.aborted) return;
    const seeded = getSlatePreAnalysisSnapshot();
    if (
      seeded &&
      serverTicketsReady(seeded, seedOpts) &&
      (seeded.deepSimComplete || isSlatePreAnalysisFresh(seeded))
    ) {
      if (!seeded.deepSimComplete && !seeded.tickets) {
        return runSlatePreAnalysis({ signal: controller.signal });
      }
      return seeded;
    }
    if (seeded?.tickets && serverTicketsReady(seeded, seedOpts)) {
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
