import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";

import type { ParsedPick } from "@/components/PickCard";
import type { BuiltChatContext, RealOddsEntry } from "./api.ts";
import type { CoachGameSimEntry } from "./coachGameMonteCarlo.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";

const PREFIX = "slate-preanalysis:v3:kernel:";
const STORAGE_KEY = `${PREFIX}snapshot`;
const GEN_KEY = `${PREFIX}ota-generation`;

/** Hero-quality window — board scan older than this still seeds context but not cards. */
export const SLATE_PRE_ANALYSIS_MAX_MS = 15 * 60_000;
/** Instant Coach load — accept slightly stale server slate while refresh runs. */
export const SLATE_INSTANT_LOAD_MAX_MS = 30 * 60_000;
/** Precompute target mirrored from server. */
export const SLATE_PRE_ANALYSIS_TARGET = 15;
export const SLATE_PARLAY_SIZES = [3, 5, 6, 9, 10, 15] as const;
export type SlateParlayLegCount = (typeof SLATE_PARLAY_SIZES)[number];

export type SerializedBoardScan = {
  picks: ParsedPick[];
  evalLinesByGame: Record<string, RealOddsEntry[]>;
  gameSimulations: Record<string, CoachGameSimEntry>;
  totalScanned: number;
  totalQualified: number;
  staging: TicketStagingBreakdown;
  note: string;
  scanComplete?: boolean;
};

export type SlateTicketsIndex = {
  global: Partial<Record<SlateParlayLegCount, SerializedBoardScan>>;
  bySport: Partial<Record<string, Partial<Record<SlateParlayLegCount, SerializedBoardScan>>>>;
};

export type SlatePreAnalysisSnapshot = {
  at: number;
  fingerprint: string;
  built: BuiltChatContext;
  propSimulations: Array<[string, { hitProbability: number | null }]>;
  boardScan: SerializedBoardScan | null;
  tickets?: SlateTicketsIndex | null;
  activeSports?: string[];
  deepSimComplete: boolean;
};

let memorySnapshot: SlatePreAnalysisSnapshot | null = null;
let hydratePromise: Promise<boolean> | null = null;
let cacheGenerationValid = false;

function currentOtaGeneration(): string {
  if (__DEV__) return "dev";
  if (!Updates.isEnabled) return "embedded";
  return Updates.updateId ?? Updates.runtimeVersion ?? "embedded";
}

export function computeSlateFingerprint(
  built: BuiltChatContext,
  opts?: { injuryDigest?: string; gameStatusDigest?: string },
): string {
  const { context, propPool } = built;
  const odds = context.realOdds ?? [];
  const kickoffs = odds
    .map((o) => o.startsAt ?? "")
    .filter(Boolean)
    .sort()
    .slice(0, 32)
    .join("|");
  const prices = odds
    .slice(0, 80)
    .map((o) => `${o.game}:${o.market}:${o.pick}:${o.odds}`)
    .join(";");
  const inj = opts?.injuryDigest ?? "";
  const status = opts?.gameStatusDigest ?? "";
  return `${odds.length}:${propPool.length}:${kickoffs}:${prices}:${inj}:${status}`;
}

export function isSlatePreAnalysisInstantLoad(
  snapshot: SlatePreAnalysisSnapshot | null = memorySnapshot,
  maxMs = SLATE_INSTANT_LOAD_MAX_MS,
): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.at <= maxMs;
}

export function nearestSlateParlaySize(requested: number): SlateParlayLegCount {
  const capped = Math.min(Math.max(3, Math.round(requested)), SLATE_PRE_ANALYSIS_TARGET);
  let best: SlateParlayLegCount = SLATE_PARLAY_SIZES[0];
  for (const size of SLATE_PARLAY_SIZES) {
    if (size <= capped) best = size;
    else break;
  }
  return best;
}

export function resolveSlateBoardScan(
  snapshot: SlatePreAnalysisSnapshot,
  opts?: { legs?: number; sport?: string | null },
): SerializedBoardScan | null {
  const legs = opts?.legs ?? SLATE_PRE_ANALYSIS_TARGET;
  const size = nearestSlateParlaySize(legs);
  const sport = opts?.sport?.toLowerCase().trim() || null;
  const tickets = snapshot.tickets;
  if (tickets) {
    if (sport && tickets.bySport?.[sport]?.[size]) return tickets.bySport[sport]![size]!;
    if (tickets.global?.[size]) return tickets.global[size]!;
    if (sport && tickets.bySport?.[sport]) {
      const sportSizes = Object.keys(tickets.bySport[sport]!)
        .map(Number)
        .filter((n) => n <= size)
        .sort((a, b) => b - a);
      const fallback = sportSizes[0];
      if (fallback && tickets.bySport[sport]![fallback as SlateParlayLegCount]) {
        return tickets.bySport[sport]![fallback as SlateParlayLegCount]!;
      }
    }
    const globalSizes = Object.keys(tickets.global ?? {})
      .map(Number)
      .filter((n) => n <= size)
      .sort((a, b) => b - a);
    const globalFallback = globalSizes[0];
    if (globalFallback && tickets.global?.[globalFallback as SlateParlayLegCount]) {
      return tickets.global[globalFallback as SlateParlayLegCount]!;
    }
  }
  if (snapshot.boardScan?.picks?.length) {
    if (snapshot.boardScan.picks.length <= legs) return snapshot.boardScan;
    return { ...snapshot.boardScan, picks: snapshot.boardScan.picks.slice(0, legs) };
  }
  return null;
}

export function serializeBoardScan(scan: FullBoardScanResult): SerializedBoardScan {
  const evalLinesByGame: Record<string, RealOddsEntry[]> = {};
  for (const [game, lines] of scan.evalLinesByGame) {
    evalLinesByGame[game] = lines;
  }
  const gameSimulations: Record<string, CoachGameSimEntry> = {};
  for (const [game, sim] of scan.gameSimulations) {
    gameSimulations[game] = sim;
  }
  return {
    picks: scan.picks,
    evalLinesByGame,
    gameSimulations,
    totalScanned: scan.totalScanned,
    totalQualified: scan.totalQualified,
    staging: scan.staging,
    note: scan.note,
    scanComplete: scan.scanComplete ?? true,
  };
}

export function deserializeBoardScan(raw: SerializedBoardScan): FullBoardScanResult {
  return {
    picks: raw.picks,
    evalLinesByGame: new Map(Object.entries(raw.evalLinesByGame)),
    gameSimulations: new Map(Object.entries(raw.gameSimulations)),
    totalScanned: raw.totalScanned,
    totalQualified: raw.totalQualified,
    staging: raw.staging,
    note: raw.note,
    scanComplete: raw.scanComplete ?? true,
  };
}

export function propSimMapFromSnapshot(
  rows: SlatePreAnalysisSnapshot["propSimulations"],
): Map<string, { hitProbability: number | null }> {
  return new Map(rows);
}

export function propSimMapToSnapshot(
  map: Map<string, { hitProbability: number | null }>,
): SlatePreAnalysisSnapshot["propSimulations"] {
  return [...map.entries()];
}

export function isSlatePreAnalysisFresh(
  snapshot: SlatePreAnalysisSnapshot | null = memorySnapshot,
  maxMs = SLATE_PRE_ANALYSIS_MAX_MS,
): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.at <= maxMs;
}

export function getSlatePreAnalysisSnapshot(): SlatePreAnalysisSnapshot | null {
  if (!memorySnapshot) return null;
  if (!isSlatePreAnalysisInstantLoad(memorySnapshot)) return null;
  return memorySnapshot;
}

export async function rememberSlatePreAnalysis(
  snapshot: SlatePreAnalysisSnapshot,
): Promise<void> {
  memorySnapshot = snapshot;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    await AsyncStorage.setItem(GEN_KEY, currentOtaGeneration());
    cacheGenerationValid = true;
  } catch {
    // Best-effort — memory snapshot still helps the active session.
  }
}

export async function patchSlatePreAnalysisBoardScan(
  boardScan: FullBoardScanResult,
): Promise<void> {
  if (!memorySnapshot) return;
  const next: SlatePreAnalysisSnapshot = {
    ...memorySnapshot,
    at: Date.now(),
    boardScan: serializeBoardScan(boardScan),
  };
  await rememberSlatePreAnalysis(next);
}

export async function clearSlatePreAnalysisCache(): Promise<void> {
  memorySnapshot = null;
  hydratePromise = null;
  cacheGenerationValid = false;
  try {
    await AsyncStorage.multiRemove([STORAGE_KEY, GEN_KEY]);
  } catch {
    // ignore
  }
}

async function ensureCacheGeneration(): Promise<void> {
  if (cacheGenerationValid) return;
  try {
    const storedGen = await AsyncStorage.getItem(GEN_KEY);
    if (storedGen && storedGen !== currentOtaGeneration()) {
      await clearSlatePreAnalysisCache();
      return;
    }
    cacheGenerationValid = true;
  } catch {
    cacheGenerationValid = true;
  }
}

/** Warm memory from disk on cold start. */
export async function hydrateSlatePreAnalysisCache(): Promise<boolean> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    await ensureCacheGeneration();
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as SlatePreAnalysisSnapshot;
      if (!parsed?.at || !parsed.built?.context) return false;
      if (!isSlatePreAnalysisInstantLoad(parsed)) return false;
      memorySnapshot = parsed;
      return true;
    } catch {
      return false;
    }
  })();
  return hydratePromise;
}

/** Merge a server-precomputed snapshot when it is fresher than local cache. */
export async function applyServerSlateSnapshot(
  server: SlatePreAnalysisSnapshot | null | undefined,
): Promise<boolean> {
  if (!server?.at || !server.built?.context) return false;
  if (!isSlatePreAnalysisInstantLoad(server)) return false;
  const local = memorySnapshot;
  if (local && local.fingerprint === server.fingerprint && local.at >= server.at) {
    return false;
  }
  if (
    local &&
    local.at > server.at &&
    isSlatePreAnalysisFresh(local) &&
    (local.boardScan?.picks?.length ?? 0) >= (server.boardScan?.picks?.length ?? 0)
  ) {
    return false;
  }
  await rememberSlatePreAnalysis(server);
  return true;
}
