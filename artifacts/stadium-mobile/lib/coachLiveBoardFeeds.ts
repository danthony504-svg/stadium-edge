import { fetch as expoFetch } from "expo/fetch.js";
import { API_BASE } from "./apiBase.ts";
import type { EspnGame, LiveOddsFeed, OddsGame } from "./api.ts";
import {
  recordCoachLiveBoardApiResult,
  recordCoachLiveBoardFeedCounts,
} from "./coachLiveBoardTrace.ts";
import { filterBettableOddsGames } from "./slate.ts";
import { mapWithConcurrency } from "./boundedConcurrency.ts";

export type CoachLiveBoardFeeds = {
  espnGames: EspnGame[];
  oddsGames: OddsGame[];
  liveFeed: LiveOddsFeed;
};

async function tracedJson<T>(
  path: string,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<{ data: T; status: number; ok: boolean; error?: string }> {
  const endpoint = `${API_BASE}${path}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    const res = (await expoFetch(endpoint, { signal: ctrl.signal })) as Response;
    clearTimeout(timer);
    if (!res.ok) {
      return { data: [] as T, status: res.status, ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { data, status: res.status, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: [] as T, status: 0, ok: false, error: msg };
  }
}

/** Fetch live-board feeds with HTTP status tracing for Coach diagnostics. */
export async function fetchCoachLiveBoardFeeds(
  scanSports: string[],
  signal?: AbortSignal,
): Promise<CoachLiveBoardFeeds> {
  if (!scanSports.length) {
    recordCoachLiveBoardFeedCounts({ games: 0, props: 0 });
    return { espnGames: [], oddsGames: [], liveFeed: { games: [], odds: [] } };
  }

  const espnResults = await mapWithConcurrency(
    scanSports,
    3,
    async (sport) => {
      const path = `/sports/games?sport=${encodeURIComponent(sport)}`;
      const res = await tracedJson<EspnGame[]>(path, signal);
      recordCoachLiveBoardApiResult({
        endpoint: path,
        status: res.status,
        ok: res.ok,
        games: Array.isArray(res.data) ? res.data.length : 0,
        error: res.error,
      });
      return Array.isArray(res.data) ? res.data : [];
    },
    { signal },
  );

  const oddsResults = await mapWithConcurrency(
    scanSports,
    3,
    async (sport) => {
      const path = `/sports/odds?sport=${encodeURIComponent(sport)}`;
      const res = await tracedJson<OddsGame[]>(path, signal);
      recordCoachLiveBoardApiResult({
        endpoint: path,
        status: res.status,
        ok: res.ok,
        games: Array.isArray(res.data) ? res.data.length : 0,
        error: res.error,
      });
      return Array.isArray(res.data) ? res.data : [];
    },
    { signal },
  );

  const livePath = `/sports/live-odds?sport=${encodeURIComponent(scanSports.join(","))}`;
  const liveRes = await tracedJson<LiveOddsFeed>(livePath, signal, 10_000);
  const liveFeed: LiveOddsFeed = liveRes.ok
    ? liveRes.data
    : { games: [], odds: [] };
  recordCoachLiveBoardApiResult({
    endpoint: livePath,
    status: liveRes.status,
    ok: liveRes.ok,
    games: liveFeed.games?.length ?? 0,
    props: liveFeed.odds?.length ?? 0,
    error: liveRes.error,
    optional: true,
  });

  const espnGames = espnResults.flat();
  const oddsGames = filterBettableOddsGames(oddsResults.flat());
  recordCoachLiveBoardFeedCounts({
    games: Math.max(oddsGames.length, espnGames.length),
  });

  return { espnGames, oddsGames, liveFeed };
}
