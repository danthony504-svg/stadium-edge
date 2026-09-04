/** Coach matchup-analysis stage — bounded concurrency, timeouts, tracing. */

import type { MatchupHistoryEntry, UpsetSpot } from "./api.ts";

export const COACH_MATCHUP_TIMEOUT_MS = 15_000;
export const COACH_MATCHUP_CONCURRENCY = 4;
export const COACH_MATCHUP_PER_GAME_TIMEOUT_MS = 8_000;

export type CoachMatchupTarget = {
  sport: string;
  gameLabel: string;
  homeTeamId: string;
  awayTeamId: string;
  startsAt?: string;
};

export class CoachMatchupStageError extends Error {
  readonly requestId: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly empty: boolean;

  constructor(
    message: string,
    opts: {
      requestId: string;
      durationMs: number;
      timedOut?: boolean;
      empty?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause != null ? { cause: opts.cause } : undefined);
    this.name = "CoachMatchupStageError";
    this.requestId = opts.requestId;
    this.durationMs = opts.durationMs;
    this.timedOut = opts.timedOut === true;
    this.empty = opts.empty === true;
  }
}

function logJson(tag: string, payload: Record<string, unknown>): void {
  console.log(tag, JSON.stringify(payload));
}

export function logCoachScanMatchupStart(requestId: string, gameCount: number): void {
  logJson("[coach-scan] matchup-start", { requestId, gameCount });
}

export function logCoachScanMatchupProgress(
  requestId: string,
  processedGames: number,
  totalGames: number,
): void {
  logJson("[coach-scan] matchup-progress", { requestId, processedGames, totalGames });
}

export function logCoachScanMatchupComplete(
  requestId: string,
  inputCount: number,
  outputCount: number,
  durationMs: number,
): void {
  logJson("[coach-scan] matchup-complete", { requestId, inputCount, outputCount, durationMs });
}

export function logCoachScanMatchupEmpty(requestId: string, reason: string): void {
  logJson("[coach-scan] matchup-empty", { requestId, reason });
}

export function logCoachScanMatchupError(
  requestId: string,
  message: string,
  stack?: string,
): void {
  console.error("[coach-scan] matchup-error", JSON.stringify({ requestId, message }));
  if (stack) console.error(stack);
}

export function logCoachScanMatchupTimeout(requestId: string, durationMs: number): never {
  console.error("[coach-scan] matchup-timeout", JSON.stringify({ requestId, durationMs }));
  throw new CoachMatchupStageError(`Matchup analysis timed out after ${durationMs}ms`, {
    requestId,
    durationMs,
    timedOut: true,
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onEach?: (index: number) => void,
): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]!, idx);
      onEach?.(idx + 1);
    }
  });
  await Promise.all(workers);
  return results;
}

export type BuildMatchupEntryResult = {
  entry: MatchupHistoryEntry;
  upset?: UpsetSpot;
};

/** Build one matchupHistory entry (+ optional upset) from the ESPN feed shape. */
export function buildMatchupEntryFromFeed(
  target: CoachMatchupTarget,
  data: any,
  mlPriceByLabel: Record<string, Record<string, number>>,
  helpers: {
    computeMlLean: (label: string, d: any) => { side: string; edge: number; reasons: string[]; upset?: { dogOdds: number } } | null;
    detectUpset: (lean: any, pricesByNick?: Record<string, number>) => any;
  },
): BuildMatchupEntryResult | null {
  const home10 = data?.home?.last10;
  const away10 = data?.away?.last10;
  const h2h = data?.h2h;
  if (!home10 && !away10 && !(h2h?.meetings?.length)) return null;

  const gameStart = target.startsAt ? new Date(target.startsAt).getTime() : null;
  const computeRest = (lastDate: string | null) => {
    if (!lastDate || gameStart == null) return null;
    const diffMs = gameStart - new Date(lastDate).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return null;
    const restDays = Math.floor(diffMs / 86400000);
    return { restDays, backToBack: restDays <= 1 };
  };
  const splitOf = (s: any) =>
    s && s.games > 0
      ? {
          record: `${s.wins}-${s.losses}`,
          avgMargin: s.avgMargin,
          ptsFor: s.ptsFor,
          ptsAgainst: s.ptsAgainst,
          games: s.games,
        }
      : null;
  const seasonOf = (s: any) =>
    s && s.games > 0 ? { record: `${s.wins}-${s.losses}`, winPct: s.winPct } : null;

  const lean = helpers.computeMlLean(target.gameLabel, data);
  if (lean) helpers.detectUpset(lean, mlPriceByLabel[target.gameLabel]);

  const entry: MatchupHistoryEntry = {
    home: home10
      ? {
          record: `${home10.wins}-${home10.losses}`,
          ptsFor: home10.ptsFor,
          ptsAgainst: home10.ptsAgainst,
          avgMargin: home10.avgMargin,
        }
      : null,
    away: away10
      ? {
          record: `${away10.wins}-${away10.losses}`,
          ptsFor: away10.ptsFor,
          ptsAgainst: away10.ptsAgainst,
          avgMargin: away10.avgMargin,
        }
      : null,
    homePace: typeof data?.home?.pace === "number" ? data.home.pace : null,
    awayPace: typeof data?.away?.pace === "number" ? data.away.pace : null,
    homeVenueForm: splitOf(data?.home?.homeSplit),
    awayVenueForm: splitOf(data?.away?.awaySplit),
    homeStreak: data?.home?.streak || null,
    awayStreak: data?.away?.streak || null,
    homeSeason: seasonOf(data?.home?.season),
    awaySeason: seasonOf(data?.away?.season),
    homeRest: computeRest(data?.home?.lastGameDate ?? null),
    awayRest: computeRest(data?.away?.lastGameDate ?? null),
    h2h: h2h?.meetings?.length
      ? {
          homeWins: h2h.homeWins,
          awayWins: h2h.awayWins,
          meetings: h2h.meetings
            .slice(0, 3)
            .map((m: any) => ({
              date: m.date,
              homeScore: m.homeTeamScore,
              awayScore: m.awayTeamScore,
              homeMargin: m.homeTeamWonByMargin,
            })),
        }
      : null,
    lastMeeting: data?.lastMeeting ?? null,
    mlLean: lean,
  };

  const upset =
    lean?.upset != null
      ? ({
          game: target.gameLabel,
          sport: target.sport,
          side: lean.side,
          dogOdds: lean.upset.dogOdds,
          edge: lean.edge,
          reasons: lean.reasons || [],
          startsAt: target.startsAt,
        } satisfies UpsetSpot)
      : undefined;

  return { entry, upset };
}

/**
 * Run bounded, timed matchup analysis for a slate of games.
 * Blocking function: `runCoachMatchupAnalysis` → per-game `fetchMatchup` await inside `mapWithConcurrency`.
 */
export async function runCoachMatchupAnalysis(
  targets: CoachMatchupTarget[],
  mlPriceByLabel: Record<string, Record<string, number>>,
  fetchMatchup: (
    sport: string,
    homeTeamId: string,
    awayTeamId: string,
    signal?: AbortSignal,
  ) => Promise<any>,
  helpers: {
    computeMlLean: (label: string, d: any) => { side: string; edge: number; reasons: string[]; upset?: { dogOdds: number } } | null;
    detectUpset: (lean: any, pricesByNick?: Record<string, number>) => any;
  },
  opts: {
    requestId: string;
    signal?: AbortSignal;
    focalText?: string | null;
    cap?: number;
    requireUsable?: boolean;
  },
): Promise<{
  matchupHistory: Record<string, MatchupHistoryEntry>;
  upsetSpots: UpsetSpot[];
  inputCount: number;
  outputCount: number;
  durationMs: number;
}> {
  const start = Date.now();
  const requestId = opts.requestId;
  let ordered = targets;
  if (opts.focalText) {
    const { gameMatchesFocalText, focalSportsFromText } = await import("./chatContextPriority.ts");
    const focalSports = focalSportsFromText(opts.focalText);
    const isFocal = (t: CoachMatchupTarget) =>
      gameMatchesFocalText(t.gameLabel, opts.focalText) || focalSports.has(t.sport);
    const focal = targets.filter(isFocal);
    if (focal.length > 0 && focal.length < targets.length) {
      ordered = [...focal, ...targets.filter((t) => !isFocal(t))];
    }
  }
  const batch = ordered.slice(0, opts.cap ?? 16);
  const inputCount = batch.length;
  logCoachScanMatchupStart(requestId, inputCount);

  const deadline = start + COACH_MATCHUP_TIMEOUT_MS;
  const remainingMs = () => Math.max(0, deadline - Date.now());

  const matchupHistory: Record<string, MatchupHistoryEntry> = {};
  const upsetSpots: UpsetSpot[] = [];

  if (inputCount === 0) {
    const durationMs = Date.now() - start;
    const reason = "no team-id games in slate";
    logCoachScanMatchupEmpty(requestId, reason);
    if (opts.requireUsable) {
      throw new CoachMatchupStageError(reason, { requestId, durationMs, empty: true });
    }
    logCoachScanMatchupComplete(requestId, 0, 0, durationMs);
    return { matchupHistory, upsetSpots, inputCount: 0, outputCount: 0, durationMs };
  }

  let processedGames = 0;
  await mapWithConcurrency(
    batch,
    COACH_MATCHUP_CONCURRENCY,
    async (t) => {
      if (remainingMs() <= 0) return null;
      try {
        const data = await withTimeout(
          fetchMatchup(t.sport, t.homeTeamId, t.awayTeamId, opts.signal),
          Math.min(COACH_MATCHUP_PER_GAME_TIMEOUT_MS, remainingMs()),
          `matchup ${t.gameLabel}`,
        );
        const built = buildMatchupEntryFromFeed(t, data, mlPriceByLabel, helpers);
        if (!built) return null;
        matchupHistory[t.gameLabel] = built.entry;
        if (built.upset) upsetSpots.push(built.upset);
        return built;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        logCoachScanMatchupError(requestId, `${t.gameLabel}: ${message}`, stack);
        return null;
      }
    },
    (count) => {
      processedGames = count;
      logCoachScanMatchupProgress(requestId, processedGames, inputCount);
    },
  );

  if (remainingMs() <= 0 && processedGames < inputCount) {
    logCoachScanMatchupTimeout(requestId, Date.now() - start);
  }

  upsetSpots.sort((a, b) => b.edge - a.edge);
  const outputCount = Object.keys(matchupHistory).length;
  const durationMs = Date.now() - start;
  logCoachScanMatchupComplete(requestId, inputCount, outputCount, durationMs);

  if (outputCount === 0) {
    const reason =
      inputCount === 0
        ? "no team-id games in slate"
        : `no usable matchup data from ${inputCount} game${inputCount === 1 ? "" : "s"}`;
    logCoachScanMatchupEmpty(requestId, reason);
    if (opts.requireUsable) {
      throw new CoachMatchupStageError(reason, { requestId, durationMs, empty: true });
    }
  }

  return { matchupHistory, upsetSpots, inputCount, outputCount, durationMs };
}
