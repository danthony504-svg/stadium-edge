// Coach parlay-build injury fetch — requestId-scoped, non-blocking, 8–10s hard timeout.

import { buildGameInjuryReport, type GameInjuryReport } from "./injuries.ts";

export type InjuryTeam = {
  team: string;
  teamAbbr: string;
  entries: Array<{
    player: string;
    position: string | null;
    status: string;
    description: string;
  }>;
};

export const COACH_INJURY_TIMEOUT_MS = 9_000;
const STORAGE_KEY = "coach_injury_v1";

export type CoachInjuryDataStatus = "available" | "unavailable";
export type CoachInjuryStep = "pending" | "loading" | "complete" | "skipped" | "unavailable";

export type CoachInjuryRecord = {
  requestId: string;
  step: CoachInjuryStep;
  injuryStatus: CoachInjuryDataStatus;
  sports: string[];
  endpoint: string;
  startedAt: number;
  completedAt?: number;
  httpStatus?: number;
  bodyShape?: string;
  error?: string;
  injuryTeamCount?: number;
  matchupInjuryCount?: number;
};

export type CoachInjuryResult = {
  record: CoachInjuryRecord;
  injuryTeamsBySport: Record<string, InjuryTeam[]>;
  injuryTeams: InjuryTeam[];
  matchupInjuries: Record<string, GameInjuryReport>;
};

const records = new Map<string, CoachInjuryRecord>();
const inFlight = new Map<string, Promise<CoachInjuryResult>>();
const resultCache = new Map<string, CoachInjuryResult>();

export type CoachInjurySportFetcher = (sport: string, signal?: AbortSignal) => Promise<InjuryTeam[]>;
let sportFetcherOverride: CoachInjurySportFetcher | null = null;

export function setCoachInjurySportFetcherForTests(fetcher: CoachInjurySportFetcher | null): void {
  sportFetcherOverride = fetcher;
}

async function resolveSportFetcher(): Promise<CoachInjurySportFetcher> {
  if (sportFetcherOverride) return sportFetcherOverride;
  const { getInjuries } = await import("./api.ts");
  return getInjuries;
}

function log(event: string, requestId: string, extra?: Record<string, unknown>): void {
  const tail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[coach-injury] ${event} requestId=${requestId}${tail}`);
}

function injuryEndpoint(sport: string): string {
  return `/sports/injuries?sport=${encodeURIComponent(sport)}`;
}

function describeInjuryBody(teams: unknown): string {
  if (!Array.isArray(teams)) return "non-array";
  if (!teams.length) return "empty-array";
  const first = teams[0] as InjuryTeam | undefined;
  if (!first || typeof first !== "object") return "array:unknown";
  const entries = Array.isArray(first.entries) ? first.entries.length : 0;
  return `array:${teams.length}-teams,first-entries:${entries}`;
}

function stepFromOutcome(
  injuryStatus: CoachInjuryDataStatus,
  teamCount: number,
): CoachInjuryStep {
  if (injuryStatus === "unavailable") return "unavailable";
  if (teamCount === 0) return "skipped";
  return "complete";
}

export function resetCoachInjuryForTests(): void {
  records.clear();
  inFlight.clear();
  resultCache.clear();
}

export function getCoachInjuryRecord(requestId: string | null | undefined): CoachInjuryRecord | null {
  if (!requestId) return null;
  return records.get(requestId) ?? null;
}

export function coachInjuryStepComplete(record: CoachInjuryRecord | null | undefined): boolean {
  if (!record) return false;
  return record.step !== "pending" && record.step !== "loading";
}

function cacheResult(result: CoachInjuryResult): CoachInjuryResult {
  records.set(result.record.requestId, result.record);
  resultCache.set(result.record.requestId, result);
  return result;
}

function resultFromRecord(record: CoachInjuryRecord): CoachInjuryResult | null {
  return resultCache.get(record.requestId) ?? null;
}

async function fetchSportInjuries(
  requestId: string,
  sport: string,
  signal?: AbortSignal,
): Promise<{ sport: string; teams: InjuryTeam[]; httpStatus?: number; bodyShape: string; error?: string; timedOut?: boolean }> {
  const endpoint = injuryEndpoint(sport);
  const startedAt = Date.now();
  log("start", requestId, { endpoint, sport, startedAt });
  try {
    const fetcher = await resolveSportFetcher();
    const teams = await Promise.race([
      fetcher(sport, signal),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("coach-injury-timeout")), COACH_INJURY_TIMEOUT_MS);
      }),
    ]);
    const bodyShape = describeInjuryBody(teams);
    log("success", requestId, {
      endpoint,
      sport,
      startedAt,
      elapsedMs: Date.now() - startedAt,
      httpStatus: 200,
      bodyShape,
      teamCount: teams.length,
    });
    return { sport, teams, httpStatus: 200, bodyShape };
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    const timedOut = err.includes("coach-injury-timeout") || err.includes("request timeout");
    if (timedOut) {
      log("timeout", requestId, { endpoint, sport, startedAt, elapsedMs: Date.now() - startedAt });
    } else {
      log("error", requestId, {
        endpoint,
        sport,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        error: err,
      });
    }
    return {
      sport,
      teams: [],
      bodyShape: timedOut ? "timeout" : "error",
      error: err,
      timedOut,
    };
  }
}

export function buildCoachMatchupInjuries(
  injuryTeamsBySport: Record<string, InjuryTeam[]>,
  games: Array<{ sport: string; game: string }>,
): Record<string, GameInjuryReport> {
  const out: Record<string, GameInjuryReport> = {};
  for (const g of games) {
    const teams = injuryTeamsBySport[g.sport];
    if (!teams?.length) continue;
    const [away, home] = g.game.split(" @ ");
    if (!away || !home) continue;
    const report = buildGameInjuryReport(g.sport, teams, away, home);
    if (report) out[g.game] = report;
  }
  return out;
}

function finalizeUnavailable(
  requestId: string,
  sports: string[],
  startedAt: number,
  reason: string,
  trace?: Record<string, unknown>,
): CoachInjuryResult {
  const record: CoachInjuryRecord = {
    requestId,
    step: "unavailable",
    injuryStatus: "unavailable",
    sports,
    endpoint: sports.map(injuryEndpoint).join(","),
    startedAt,
    completedAt: Date.now(),
    bodyShape: trace?.bodyShape as string | undefined,
    error: reason,
    injuryTeamCount: 0,
    matchupInjuryCount: 0,
  };
  log("continue-without-data", requestId, { injuryStatus: "unavailable", reason, ...trace });
  const result: CoachInjuryResult = {
    record,
    injuryTeamsBySport: {},
    injuryTeams: [],
    matchupInjuries: {},
  };
  return cacheResult(result);
}

async function runCoachInjuryFetch(opts: {
  requestId: string;
  sports: string[];
  games?: Array<{ sport: string; game: string }>;
  signal?: AbortSignal;
  onUpdate?: (record: CoachInjuryRecord) => void;
}): Promise<CoachInjuryResult> {
  const { requestId, sports, games, signal, onUpdate } = opts;
  const uniqueSports = [...new Set(sports.filter(Boolean))];
  const startedAt = Date.now();
  const loading: CoachInjuryRecord = {
    requestId,
    step: "loading",
    injuryStatus: "unavailable",
    sports: uniqueSports,
    endpoint: uniqueSports.map(injuryEndpoint).join(","),
    startedAt,
  };
  records.set(requestId, loading);
  onUpdate?.(loading);

  if (!uniqueSports.length) {
    const result = finalizeUnavailable(requestId, uniqueSports, startedAt, "no-sports");
    onUpdate?.(result.record);
    void persistCoachInjury(result.record);
    return result;
  }

  const perSport = await Promise.all(
    uniqueSports.map((sport) => fetchSportInjuries(requestId, sport, signal)),
  );

  const injuryTeamsBySport: Record<string, InjuryTeam[]> = {};
  let totalTeams = 0;
  let anyTimeout = false;
  let anyError = false;
  let allEmpty = true;
  const shapes: string[] = [];

  for (const row of perSport) {
    injuryTeamsBySport[row.sport] = row.teams;
    totalTeams += row.teams.length;
    if (row.teams.length > 0) allEmpty = false;
    if (row.timedOut) anyTimeout = true;
    if (row.error && !row.timedOut) anyError = true;
    shapes.push(`${row.sport}:${row.bodyShape}`);
  }

  const injuryTeams = perSport.flatMap((r) => r.teams);
  const matchupInjuries = buildCoachMatchupInjuries(
    injuryTeamsBySport,
    games ?? [],
  );

  if (anyTimeout) {
    const result = finalizeUnavailable(requestId, uniqueSports, startedAt, "timeout", {
      bodyShape: shapes.join(";"),
    });
    onUpdate?.(result.record);
    void persistCoachInjury(result.record);
    return result;
  }

  if (anyError && totalTeams === 0) {
    const result = finalizeUnavailable(requestId, uniqueSports, startedAt, "fetch-error", {
      bodyShape: shapes.join(";"),
    });
    onUpdate?.(result.record);
    void persistCoachInjury(result.record);
    return result;
  }

  if (allEmpty) {
    log("empty", requestId, { bodyShape: shapes.join(";"), teamCount: 0 });
    const record: CoachInjuryRecord = {
      requestId,
      step: "skipped",
      injuryStatus: "unavailable",
      sports: uniqueSports,
      endpoint: uniqueSports.map(injuryEndpoint).join(","),
      startedAt,
      completedAt: Date.now(),
      httpStatus: 200,
      bodyShape: shapes.join(";"),
      injuryTeamCount: 0,
      matchupInjuryCount: 0,
    };
    log("continue-without-data", requestId, { injuryStatus: "unavailable", reason: "empty" });
    const result: CoachInjuryResult = {
      record,
      injuryTeamsBySport,
      injuryTeams: [],
      matchupInjuries: {},
    };
    cacheResult(result);
    onUpdate?.(record);
    void persistCoachInjury(record);
    return result;
  }

  const record: CoachInjuryRecord = {
    requestId,
    step: stepFromOutcome("available", totalTeams),
    injuryStatus: "available",
    sports: uniqueSports,
    endpoint: uniqueSports.map(injuryEndpoint).join(","),
    startedAt,
    completedAt: Date.now(),
    httpStatus: 200,
    bodyShape: shapes.join(";"),
    injuryTeamCount: totalTeams,
    matchupInjuryCount: Object.keys(matchupInjuries).length,
  };
  const result: CoachInjuryResult = {
    record,
    injuryTeamsBySport,
    injuryTeams,
    matchupInjuries,
  };
  cacheResult(result);
  onUpdate?.(record);
  void persistCoachInjury(record);
  return result;
}

/** Idempotent per requestId — dedupes in-flight, rerender, and app-resume retries. */
export function fetchCoachInjuriesForBuild(opts: {
  requestId: string;
  sports: string[];
  games?: Array<{ sport: string; game: string }>;
  signal?: AbortSignal;
  onUpdate?: (record: CoachInjuryRecord) => void;
}): Promise<CoachInjuryResult> {
  const { requestId } = opts;
  const existing = records.get(requestId);
  if (existing && coachInjuryStepComplete(existing)) {
    const cached = resultFromRecord(existing);
    if (cached) return Promise.resolve(cached);
  }
  const pending = inFlight.get(requestId);
  if (pending) return pending;

  const promise = runCoachInjuryFetch(opts);
  inFlight.set(requestId, promise);
  promise.finally(() => inFlight.delete(requestId));
  return promise;
}

export function mergeCoachInjuryGames(
  result: CoachInjuryResult,
  games: Array<{ sport: string; game: string }>,
): CoachInjuryResult {
  if (!games.length || result.record.injuryStatus !== "available") return result;
  const matchupInjuries = buildCoachMatchupInjuries(result.injuryTeamsBySport, games);
  const merged: CoachInjuryResult = {
    ...result,
    matchupInjuries: { ...result.matchupInjuries, ...matchupInjuries },
  };
  merged.record = {
    ...result.record,
    matchupInjuryCount: Object.keys(merged.matchupInjuries).length,
  };
  return cacheResult(merged);
}

export function applyCoachInjuryToContext<T extends {
  matchupInjuries?: Record<string, GameInjuryReport>;
  injuryTeams?: InjuryTeam[];
  injuryStatus?: CoachInjuryDataStatus;
}>(
  context: T,
  result: CoachInjuryResult,
): T {
  if (result.record.injuryStatus === "available") {
    return {
      ...context,
      injuryStatus: "available",
      injuryTeams: result.injuryTeams,
      matchupInjuries: {
        ...(context.matchupInjuries ?? {}),
        ...result.matchupInjuries,
      },
    };
  }
  return { ...context, injuryStatus: "unavailable" };
}

export async function persistCoachInjury(record: CoachInjuryRecord): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable */
  }
}

export async function loadPersistedCoachInjury(): Promise<CoachInjuryRecord | null> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachInjuryRecord;
    if (!parsed?.requestId) return null;
    records.set(parsed.requestId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPersistedCoachInjury(): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
