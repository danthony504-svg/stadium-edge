// Simulator-only API helpers in a small module so OTA bundles always ship them
// alongside simulator.tsx / simulatorProps.ts (avoids partial updates where the
// large api.ts barrel is stale and exports like getSimulatorGames are undefined).
import { fetch as expoFetch } from "expo/fetch";

import type { EspnGame, PlayerProp } from "./api";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

async function simGetJson<T>(path: string, signal?: AbortSignal, timeoutMs = 22_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  try {
    const res = await expoFetch(`${API_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export async function fetchSimulatorGames(sport: string, signal?: AbortSignal): Promise<EspnGame[]> {
  try {
    return await simGetJson<EspnGame[]>(
      `/sports/games?sport=${encodeURIComponent(sport)}&simulator=1`,
      signal,
    );
  } catch {
    // Older API deploys ignore simulator=1 — client still filters pregame.
    return simGetJson<EspnGame[]>(`/sports/games?sport=${encodeURIComponent(sport)}`, signal);
  }
}

export type GameRosterPlayer = {
  name: string;
  athleteId: string | null;
  teamId: string;
  headshot: string | null;
};

export function fetchGameRoster(
  sport: string,
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ sport: string; players: GameRosterPlayer[] }> {
  const q = new URLSearchParams({ sport });
  if (homeTeamId) q.set("homeTeamId", homeTeamId);
  if (awayTeamId) q.set("awayTeamId", awayTeamId);
  return simGetJson(`/sports/game-roster?${q.toString()}`, signal);
}

export type SimPlayerSearchHit = {
  athleteId: string;
  name: string;
  sport: string;
  team: string | null;
};

export function searchSimulatorPlayer(
  query: string,
  signal?: AbortSignal,
): Promise<{ query: string; results: SimPlayerSearchHit[] }> {
  return simGetJson(
    `/sports/player-search?query=${encodeURIComponent(query)}`,
    signal,
  );
}

export type SimPropsResponse = {
  props?: PlayerProp[];
  home?: string | null;
  away?: string | null;
};

export function fetchSimulatorPrizePicks(
  args: {
    sport: string;
    home: string;
    away: string;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  },
  signal?: AbortSignal,
): Promise<SimPropsResponse> {
  const q = new URLSearchParams({ sport: args.sport, home: args.home, away: args.away });
  if (args.homeTeamId) q.set("homeTeamId", args.homeTeamId);
  if (args.awayTeamId) q.set("awayTeamId", args.awayTeamId);
  return simGetJson(`/sports/prizepicks-props?${q.toString()}`, signal);
}

/** Pregame-only pool — duplicated here so simulator never depends on slate.ts OTA sync. */
export function isSimulatorPregame(
  game: { startsAt?: string | null; state?: string | null; status?: string | null } | null | undefined,
): boolean {
  if (!game) return false;
  if (game.state === "post" || game.state === "in") return false;
  const status = String(game.status ?? "").toLowerCase();
  if (
    status.includes("final") ||
    status.includes("in progress") ||
    status.includes("halftime") ||
    status.includes("end of")
  ) {
    return false;
  }
  const t = Date.parse(game.startsAt ?? "");
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t < now + 48 * 3600_000;
}
