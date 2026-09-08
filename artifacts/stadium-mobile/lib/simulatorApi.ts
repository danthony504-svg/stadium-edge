// Simulator-only API helpers in a small module so OTA bundles always ship them
// alongside simulator.tsx / simulatorProps.ts (avoids partial updates where the
// large api.ts barrel is stale and exports like getInjuries are undefined).
import { fetch as expoFetch } from "expo/fetch";

import { resolveUfcSimulatorGames } from "./ufcSimulatorGames";
import type {
  EspnGame,
  GameSimulationResult,
  InjuryTeam,
  MatchupHistoryEntry,
  OddsGame,
  PlayerHistory,
  PlayerProp,
  PropSimulationResult,
} from "./api";

export { propMarketLabel } from "./propMarketLabel";

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

async function simPostJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs = 44_000,
): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  try {
    const res = await expoFetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export async function fetchSimulatorGames(sport: string, signal?: AbortSignal): Promise<EspnGame[]> {
  const parse = (rows: unknown): EspnGame[] =>
    Array.isArray(rows)
      ? rows.filter((g): g is EspnGame => !!g && typeof g === "object" && typeof g.id === "string")
      : [];
  const sportId = sport.toLowerCase();

  // UFC: skip stale ESPN-backed /sports/games — build slate from odds (+ ESPN venue).
  if (sportId === "ufc" || sportId === "mma") {
    return resolveUfcSimulatorGames([], (sig) => fetchSimulatorOdds("ufc", sig), signal);
  }

  let rows: EspnGame[] = [];
  try {
    rows = parse(
      await simGetJson<EspnGame[]>(
        `/sports/games?sport=${encodeURIComponent(sport)}&simulator=1`,
        signal,
        18_000,
      ),
    );
  } catch {
    try {
      rows = parse(
        await simGetJson<EspnGame[]>(
          `/sports/games?sport=${encodeURIComponent(sport)}`,
          signal,
          18_000,
        ),
      );
    } catch {
      rows = [];
    }
  }

  return rows;
}

export async function fetchSimulatorOdds(sport: string, signal?: AbortSignal): Promise<OddsGame[]> {
  try {
    return await simGetJson<OddsGame[]>(
      `/sports/odds?sport=${encodeURIComponent(sport)}`,
      signal,
    );
  } catch {
    return [];
  }
}

export type GameRosterPlayer = {
  name: string;
  athleteId: string | null;
  teamId: string;
  headshot: string | null;
};

const ESPN_SPORT_PATHS: Record<string, string> = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  nhl: "hockey/nhl",
  nfl: "football/nfl",
  ncaaf: "football/college-football",
  ncaab: "basketball/mens-college-basketball",
};

/** Soccer rosters vary by competition — try World Cup first (our props feed is WC-only). */
const SOCCER_ROSTER_PATHS = ["soccer/fifa.world", "soccer/uefa.champions"];

type EspnRosterAthlete = {
  id?: string | number;
  fullName?: string;
  displayName?: string;
  headshot?: { href?: string } | string;
};

/** Direct ESPN roster fetch when /sports/game-roster isn't deployed yet. */
async function fetchEspnRosterDirect(
  sport: string,
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
  signal?: AbortSignal,
): Promise<GameRosterPlayer[]> {
  const teamIds = [homeTeamId, awayTeamId].filter((id): id is string => !!id);
  const paths =
    sport === "soccer"
      ? SOCCER_ROSTER_PATHS
      : ESPN_SPORT_PATHS[sport]
        ? [ESPN_SPORT_PATHS[sport]]
        : [];
  if (!paths.length || !teamIds.length) return [];

  const players: GameRosterPlayer[] = [];
  for (const teamId of teamIds) {
    let loaded = false;
    for (const espnPath of paths) {
      try {
        const res = await expoFetch(
          `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${teamId}/roster`,
          { signal },
        );
        if (!res.ok) continue;
        const data = (await res.json()) as {
          athletes?: (EspnRosterAthlete | { items?: EspnRosterAthlete[] })[];
        };
        const flat: EspnRosterAthlete[] = [];
        for (const entry of data.athletes ?? []) {
          if (entry && typeof entry === "object" && "items" in entry && Array.isArray(entry.items)) {
            flat.push(...entry.items);
          } else {
            flat.push(entry as EspnRosterAthlete);
          }
        }
        if (!flat.length) continue;
        for (const a of flat) {
          const name = a.fullName ?? a.displayName;
          if (!name) continue;
          const href = typeof a.headshot === "string" ? a.headshot : a.headshot?.href;
          players.push({
            name,
            athleteId: a.id != null ? String(a.id) : null,
            teamId,
            headshot: href ?? null,
          });
        }
        loaded = true;
        break;
      } catch {
        /* try next competition path */
      }
    }
    if (!loaded) {
      /* team roster unavailable for this competition */
    }
  }
  return players;
}

export async function fetchGameRoster(
  sport: string,
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ sport: string; players: GameRosterPlayer[] }> {
  try {
    const q = new URLSearchParams({ sport });
    if (homeTeamId) q.set("homeTeamId", homeTeamId);
    if (awayTeamId) q.set("awayTeamId", awayTeamId);
    const data = await simGetJson<{ sport: string; players: GameRosterPlayer[] }>(
      `/sports/game-roster?${q.toString()}`,
      signal,
    );
    if (data.players?.length) return data;
  } catch {
    /* fall through to ESPN */
  }
  const players = await fetchEspnRosterDirect(sport, homeTeamId, awayTeamId, signal);
  return { sport, players };
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
  return simGetJson(`/sports/player-search?query=${encodeURIComponent(query)}`, signal);
}

export type SimPrizePicksResponse = {
  props?: PlayerProp[];
  home?: string | null;
  away?: string | null;
};

export type SimGetPropsArgs = {
  sport: string;
  eventId: string;
  home?: string;
  away?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  startsAt?: string | null;
};

export type SimPropsResponse = {
  home: string | null;
  away: string | null;
  bookmaker: string | null;
  props: PlayerProp[];
};

export function fetchSimulatorProps(
  args: SimGetPropsArgs,
  signal?: AbortSignal,
): Promise<SimPropsResponse> {
  if (!args?.sport || !args?.eventId) {
    return Promise.resolve({ home: null, away: null, bookmaker: null, props: [] });
  }
  const q = new URLSearchParams({ sport: args.sport, eventId: args.eventId });
  if (args.home) q.set("home", args.home);
  if (args.away) q.set("away", args.away);
  if (args.homeTeamId) q.set("homeTeamId", args.homeTeamId);
  if (args.awayTeamId) q.set("awayTeamId", args.awayTeamId);
  if (args.startsAt) q.set("startsAt", args.startsAt);
  return simGetJson<SimPropsResponse>(`/sports/props?${q.toString()}`, signal, 30_000);
}

export function fetchSimulatorPrizePicks(
  args: {
    sport: string;
    home: string;
    away: string;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  },
  signal?: AbortSignal,
): Promise<SimPrizePicksResponse> {
  const q = new URLSearchParams({ sport: args.sport, home: args.home, away: args.away });
  if (args.homeTeamId) q.set("homeTeamId", args.homeTeamId);
  if (args.awayTeamId) q.set("awayTeamId", args.awayTeamId);
  return simGetJson(`/sports/prizepicks-props?${q.toString()}`, signal);
}

export type SimInjuryTeam = InjuryTeam;

export function fetchSimulatorInjuries(sport: string, signal?: AbortSignal): Promise<InjuryTeam[]> {
  return simGetJson<InjuryTeam[]>(`/sports/injuries?sport=${encodeURIComponent(sport)}`, signal);
}

export type SimParkWeatherReport = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  current: { tempF: number; condition: string };
  impact: { rating: string; summary: string };
};

export function fetchSimulatorParkWeather(
  sport = "mlb",
  signal?: AbortSignal,
): Promise<SimParkWeatherReport[]> {
  return simGetJson<SimParkWeatherReport[]>(
    `/weather/parks?sport=${encodeURIComponent(sport)}`,
    signal,
  );
}

export function fetchSimulatorPlayerHistory(
  args: {
    sport: string;
    athleteId: string | null;
    name?: string | null;
    season?: string | null;
    opponentName?: string | null;
  },
  signal?: AbortSignal,
): Promise<PlayerHistory> {
  const q = new URLSearchParams({ sport: args.sport });
  if (args.athleteId) q.set("athleteId", args.athleteId);
  if (args.name) q.set("name", args.name);
  if (args.season) q.set("season", args.season);
  if (args.opponentName) q.set("opponentName", args.opponentName);
  return simGetJson<PlayerHistory>(`/sports/player-history?${q.toString()}`, signal);
}

export async function fetchSimulatorGameOutcome(
  opts: {
    sport: string;
    homeTeamId: string;
    awayTeamId: string;
    homeTeam?: string;
    awayTeam?: string;
    simulations?: number;
    weatherImpact?: number | null;
    coverQueries?: {
      id: string;
      kind: "ml" | "spread" | "total" | "teamTotal";
      teamSide?: "home" | "away";
      line?: number;
      totalSide?: "over" | "under";
    }[];
    retainOutcomes?: boolean;
  },
  signal?: AbortSignal,
): Promise<GameSimulationResult | null> {
  return simPostJson<GameSimulationResult>("/sports/simulate/game-outcome", opts, signal, 44_000);
}

export async function fetchSimulatorPropSimulationsBatch(
  sport: string,
  props: {
    player: string;
    market: string;
    line: number;
    side: "Over" | "Under";
    athleteId?: string | null;
  }[],
  opts?: {
    homeTeam?: string;
    awayTeam?: string;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    weatherImpact?: number | null;
    simulations?: number;
    tier?: "quick" | "deep";
  },
  signal?: AbortSignal,
): Promise<PropSimulationResult[]> {
  if (!props.length) return [];
  const tier = opts?.tier ?? "quick";
  const json = await simPostJson<{ props?: PropSimulationResult[] }>(
    "/sports/simulate/props",
    { sport, tier, ...opts, props },
    signal,
    tier === "deep" ? 66_000 : 22_000,
  );
  return json?.props ?? [];
}

export type SimMlbProbable = {
  name: string;
  athleteId: string;
};

export type SimMlbProbablesResp = {
  probables: Record<string, SimMlbProbable>;
};

/** Probable starters — used for lineup-aware sim cache invalidation (MLB). */
export async function fetchSimulatorMlbProbables(
  signal?: AbortSignal,
): Promise<SimMlbProbablesResp> {
  try {
    return await simGetJson<SimMlbProbablesResp>(`/sports/mlb-probables`, signal);
  } catch {
    return { probables: {} };
  }
}

/** Best-effort wake-up before simulator fan-out (cold autoscale hosts). */
export async function warmSimulatorApi(signal?: AbortSignal): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onAbort);
    try {
      await expoFetch(`${API_BASE}/healthz`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  } catch {
    // Never block the simulator on a warm-up miss.
  }
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

const _clampLean = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const _streakStr = (s: { type?: string; count?: number } | null | undefined) =>
  s && (s.count ?? 0) > 0 ? (s.type === "W" ? s.count! : -s.count!) : 0;

function computeMlLean(
  label: string,
  d: Record<string, any> | null | undefined,
): { side: string; edge: number; reasons: string[] } | null {
  const parts = (label || "").split(" @ ");
  const awayNm = (parts[0] || "").trim();
  const homeNm = (parts[1] || "").trim();
  if (!awayNm || !homeNm || !d) return null;
  const h10 = d?.home?.last10;
  const a10 = d?.away?.last10;
  const hSeas = d?.home?.season;
  const aSeas = d?.away?.season;
  const hVen = d?.home?.homeSplit?.games > 0 ? d.home.homeSplit : null;
  const aVen = d?.away?.awaySplit?.games > 0 ? d.away.awaySplit : null;
  const h2h = d?.h2h?.meetings?.length ? d.h2h : null;
  let edge = 0;
  let any = false;
  if (h10?.avgMargin != null && a10?.avgMargin != null) {
    edge += _clampLean((h10.avgMargin - a10.avgMargin) * 1.2, -10, 10);
    any = true;
  }
  if (hSeas?.winPct != null && aSeas?.winPct != null) {
    edge += _clampLean((hSeas.winPct - aSeas.winPct) * 15, -8, 8);
    any = true;
  }
  if (hVen?.avgMargin != null && aVen?.avgMargin != null) {
    edge += _clampLean((hVen.avgMargin - aVen.avgMargin) * 0.9, -6, 6);
    any = true;
  }
  const sd = _streakStr(d?.home?.streak) - _streakStr(d?.away?.streak);
  if (sd !== 0) {
    edge += _clampLean(sd * 1.2, -5, 5);
    any = true;
  }
  if (h2h) {
    edge += _clampLean((h2h.homeWins - h2h.awayWins) * 2, -5, 5);
    any = true;
  }
  if (!any || Math.abs(edge) < 1) return null;
  const homeFav = edge > 0;
  const side = homeFav ? homeNm : awayNm;
  const reasons: string[] = [];
  const favL10 = homeFav ? h10 : a10;
  const oppL10 = homeFav ? a10 : h10;
  if (favL10?.avgMargin != null) {
    reasons.push(
      `${side} ${favL10.wins}-${favL10.losses} L10 (${favL10.avgMargin > 0 ? "+" : ""}${favL10.avgMargin} margin)${
        oppL10?.avgMargin != null
          ? ` vs ${oppL10.wins}-${oppL10.losses} (${oppL10.avgMargin > 0 ? "+" : ""}${oppL10.avgMargin})`
          : ""
      }`,
    );
  }
  const favSeas = homeFav ? hSeas : aSeas;
  if (favSeas?.winPct != null) {
    reasons.push(`${favSeas.wins}-${favSeas.losses} season (${Math.round(favSeas.winPct * 100)}% win)`);
  }
  const favVen = homeFav ? hVen : aVen;
  if (favVen) {
    reasons.push(
      `${favVen.wins}-${favVen.losses} ${homeFav ? "at home" : "on the road"} (${favVen.avgMargin > 0 ? "+" : ""}${favVen.avgMargin} margin)`,
    );
  }
  const favStreak = homeFav ? d?.home?.streak : d?.away?.streak;
  if (favStreak?.type === "W" && (favStreak.count ?? 0) >= 2) {
    reasons.push(`${favStreak.count}-game win streak`);
  }
  if (h2h) {
    const fw = homeFav ? h2h.homeWins : h2h.awayWins;
    const fl = homeFav ? h2h.awayWins : h2h.homeWins;
    if (fw !== fl) reasons.push(`${fw}-${fl} H2H last ${h2h.meetings.length}`);
  }
  if (reasons.length === 0) {
    reasons.push(`${side} holds the edge on combined form, season, venue and streak metrics`);
  }
  return { side, edge: Math.round(Math.abs(edge) * 10) / 10, reasons };
}

export async function fetchSimulatorMatchupHistory(
  opts: {
    sport: string;
    gameLabel: string;
    homeTeamId: string;
    awayTeamId: string;
    startsAt?: string;
  },
  signal?: AbortSignal,
): Promise<MatchupHistoryEntry | null> {
  try {
    const qs = `sport=${encodeURIComponent(opts.sport)}&homeTeamId=${encodeURIComponent(opts.homeTeamId)}&awayTeamId=${encodeURIComponent(opts.awayTeamId)}`;
    const data = await simGetJson<Record<string, any>>(`/sports/matchup-history?${qs}`, signal);
    const home10 = data?.home?.last10;
    const away10 = data?.away?.last10;
    const h2h = data?.h2h;
    if (!home10 && !away10 && !(h2h?.meetings?.length)) return null;
    const gameStart = opts.startsAt ? new Date(opts.startsAt).getTime() : null;
    const computeRest = (lastDate: string | null) => {
      if (!lastDate || gameStart == null) return null;
      const diffMs = gameStart - new Date(lastDate).getTime();
      if (!Number.isFinite(diffMs) || diffMs < 0) return null;
      const restDays = Math.floor(diffMs / 86400000);
      return { restDays, backToBack: restDays <= 1 };
    };
    const splitOf = (s: { games?: number; wins?: number; losses?: number; avgMargin?: number; ptsFor?: number; ptsAgainst?: number } | null | undefined) =>
      s && (s.games ?? 0) > 0
        ? {
            record: `${s.wins}-${s.losses}`,
            avgMargin: s.avgMargin,
            ptsFor: s.ptsFor,
            ptsAgainst: s.ptsAgainst,
            games: s.games,
          }
        : null;
    const seasonOf = (s: { games?: number; wins?: number; losses?: number; winPct?: number } | null | undefined) =>
      s && (s.games ?? 0) > 0 ? { record: `${s.wins}-${s.losses}`, winPct: s.winPct } : null;
    const lean = computeMlLean(opts.gameLabel, data);
    return {
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
            meetings: h2h.meetings.slice(0, 3).map((m: Record<string, unknown>) => ({
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
  } catch {
    return null;
  }
}
