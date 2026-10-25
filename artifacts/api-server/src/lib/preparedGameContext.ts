/** Event-bound context prepared by cron. Reads never start provider work. */
import { warmDepthChartEvidence, type DepthChartEvidence } from "./preparedDepthCharts.js";
import { cacheGet, cacheSet } from "./store.js";
import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";
import { withInflightCoalesce } from "./propSimDedicatedStore.js";
import { MLB_PARKS, PARK_META } from "./parks.js";
import { resolveFootballStadium } from "./footballStadiums.js";

export const PREPARED_GAME_CONTEXT_TTL_MS = 2 * 60_000;
export type ContextGame = { id: string; sport?: string; startsAt: string; homeTeamId?: string | null; awayTeamId?: string | null; homeAbbr?: string | null; homeTeam?: string | null; awayTeam?: string | null; venue?: string | null };
export type PreparedGameContext = {
  version: 1; sport: string; eventId: string; startsAt: string; observedAtMs: number; expiresAtMs: number;
  homeTeamId: string; awayTeamId: string; requiresEventTime?: boolean;
  depthCharts?: DepthChartEvidence[];
  lineups: Array<{ teamId: string; complete: boolean; players: Array<{ athleteId: string; starter: boolean; position: string | null; battingOrder: number | null }> }>;
  environment: {
    venue: string | null; exposure: "outdoor" | "indoors" | "unknown";
    weather: { source: "openweather_forecast"; locationScope: "venue" | "city"; forecastAtMs: number; observedAtMs?: number; tempF: number | null; windMph: number | null; gustMph: number | null; windDeg: number | null; humidity: number | null; precipChancePct: number | null; condition: string | null } | null;
  };
};
type AthleteRow = { athlete?: { id?: string; position?: { abbreviation?: string } }; starter?: boolean; battingOrder?: number };
export type ContextSummary = {
  header?: { season?: { year?: number }; id?: string; competitions?: Array<{ id?: string; date?: string; status?: { type?: { state?: string } }; competitors?: Array<{ homeAway?: string; team?: { id?: string } }> }> };
  gameInfo?: { venue?: { fullName?: string; indoor?: boolean; address?: { city?: string; country?: string; state?: string } } };
  boxscore?: { players?: Array<{ team?: { id?: string }; statistics?: Array<{ athletes?: AthleteRow[] }> }> };
  rosters?: Array<{ team?: { id?: string }; roster?: AthleteRow[] }>;
};
const key = (sport: string) => `coach-prepared-game:v1:${sport}`;
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function parsePreparedGameContext(sport: string, game: ContextGame, data: ContextSummary, now = Date.now()): PreparedGameContext | null {
  const comp = data.header?.competitions?.find(c => c.id === game.id) ?? data.header?.competitions?.[0];
  const home = comp?.competitors?.find(c => c.homeAway === "home")?.team?.id;
  const away = comp?.competitors?.find(c => c.homeAway === "away")?.team?.id;
  const starts = Date.parse(game.startsAt);
  if (data.header?.id !== game.id || !comp || comp.status?.type?.state !== "pre" || !Number.isFinite(starts) || starts <= now || starts > now + 48 * 3600_000 || Date.parse(comp.date ?? "") !== starts || !home || !away || home !== game.homeTeamId || away !== game.awayTeamId) return null;
  const venue = data.gameInfo?.venue;
  const groups = [
    ...(data.rosters ?? []).map(t => ({ teamId: t.team?.id, rows: t.roster ?? [] })),
    ...(data.boxscore?.players ?? []).map(t => ({ teamId: t.team?.id, rows: (t.statistics ?? []).flatMap(s => s.athletes ?? []) })),
  ];
  const byTeam = new Map<string, Map<string, PreparedGameContext["lineups"][number]["players"][number]>>();
  const conflictedTeams = new Set<string>();
  for (const group of groups) {
    if (!group.teamId || ![home, away].includes(group.teamId)) continue;
    const players = byTeam.get(group.teamId) ?? new Map();
    for (const row of group.rows) {
      if (!row.athlete?.id || typeof row.starter !== "boolean") continue;
      const previous = players.get(String(row.athlete.id));
      if (previous && previous.starter !== row.starter) conflictedTeams.add(group.teamId);
      const rawOrder = finite(row.battingOrder);
      const order = rawOrder != null && rawOrder >= 100 && rawOrder % 100 === 0 ? rawOrder / 100 : rawOrder;
      players.set(String(row.athlete.id), { athleteId: String(row.athlete.id), starter: row.starter, position: row.athlete.position?.abbreviation ?? null, battingOrder: order != null && order >= 1 && order <= 9 && Number.isInteger(order) ? order : null });
    }
    byTeam.set(group.teamId, players);
  }
  const expected = sport === "mlb" ? 9 : sport === "soccer" ? 11 : ["nba", "wnba", "ncaab"].includes(sport) ? 5 : 0;
  let exposure: PreparedGameContext["environment"]["exposure"] = venue?.indoor === true ? "indoors" : venue?.indoor === false ? "outdoor" : "unknown";
  // Known open-air parks/stadiums are usable only when the actual event venue matches.
  // A retractable-roof registry flag is NOT a live closed-roof confirmation.
  if (exposure === "unknown" && game.homeAbbr && venue?.fullName) {
    const stadium = resolveFootballStadium(sport, game.homeAbbr);
    const park = sport === "mlb" ? MLB_PARKS[game.homeAbbr] : null;
    const parkName = sport === "mlb" ? PARK_META[game.homeAbbr]?.name : null;
    if (stadium && !stadium.dome && norm(stadium.name) === norm(venue.fullName)) exposure = "outdoor";
    if (park && !park.dome && parkName && norm(parkName) === norm(venue.fullName)) exposure = "outdoor";
  }
  return { version: 1, sport, eventId: game.id, startsAt: game.startsAt, observedAtMs: now, expiresAtMs: now + PREPARED_GAME_CONTEXT_TTL_MS, homeTeamId: home, awayTeamId: away,
    lineups: [...byTeam].map(([teamId, rows]) => { const players = [...rows.values()]; return { teamId, complete: expected > 0 && !conflictedTeams.has(teamId) && players.filter(p => p.starter && (sport !== "mlb" || p.position !== "P")).length === expected, players }; }),
    environment: { venue: venue?.fullName ?? null, exposure, weather: null },
  };
}

type Forecast = { list?: Array<{ dt?: number; main?: { temp?: number; humidity?: number }; wind?: { speed?: number; gust?: number; deg?: number }; pop?: number; weather?: Array<{ description?: string }> }> };
export function weatherAtGameTime(data: Forecast, startsAt: string, locationScope: "venue" | "city"): PreparedGameContext["environment"]["weather"] {
  const starts = Date.parse(startsAt);
  const row = [...(data.list ?? [])].filter(r => finite(r.dt) != null).sort((a,b) => Math.abs(a.dt! * 1000 - starts) - Math.abs(b.dt! * 1000 - starts))[0];
  if (!Number.isFinite(starts) || !row || Math.abs(row.dt! * 1000 - starts) > 90 * 60_000) return null;
  const positive = (v: unknown) => { const n = finite(v); return n != null && n >= 0 ? n : null; };
  const pop = finite(row.pop), humidity = finite(row.main?.humidity), direction = finite(row.wind?.deg);
  return { source: "openweather_forecast", locationScope, forecastAtMs: row.dt! * 1000, tempF: finite(row.main?.temp), windMph: positive(row.wind?.speed), gustMph: positive(row.wind?.gust), windDeg: direction != null && direction >= 0 && direction <= 360 ? direction : null, humidity: humidity != null && humidity >= 0 && humidity <= 100 ? humidity : null, precipChancePct: pop != null && pop >= 0 && pop <= 1 ? Math.round(pop * 100) : null, condition: row.weather?.[0]?.description ?? null };
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`Game context provider ${response.status}`);
  return await response.json() as T;
}
const COUNTRY_CODES: Record<string, string> = { england: "GB", scotland: "GB", wales: "GB", unitedkingdom: "GB", france: "FR", italy: "IT", spain: "ES", brazil: "BR", japan: "JP", germany: "DE", australia: "AU", canada: "CA", unitedstates: "US", usa: "US", netherlands: "NL", portugal: "PT", mexico: "MX", argentina: "AR", switzerland: "CH", china: "CN", austria: "AT", belgium: "BE", sweden: "SE", denmark: "DK", norway: "NO", qatar: "QA", saudiarabia: "SA", unitedarabemirates: "AE" };
async function prepareOne(sport: string, game: ContextGame): Promise<PreparedGameContext | null> {
  const path = ESPN_SPORT_PATHS[sport];
  if ((!path && sport !== "tennis") || !/^\d+$/.test(game.id)) return null;
  let envelope: { data: ContextSummary; at: number };
  if (sport === "tennis") {
    const { loadTennisGames } = await import("./tennis.js");
    const match = (await loadTennisGames()).find(g => g.id === game.id);
    const seed = match?.contextSeed;
    if (!seed || !match?.homeTeamId || !match.awayTeamId) return null;
    envelope = { at: seed.observedAtMs, data: { header: { id: match.id, competitions: [{ id: match.id, date: match.startsAt, status: { type: { state: seed.state ?? undefined } }, competitors: [{ homeAway: "home", team: { id: match.homeTeamId } }, { homeAway: "away", team: { id: match.awayTeamId } }] }] }, gameInfo: { venue: seed.venue } } };
  } else {
    envelope = await cachedJson(`coach-summary:v1:${sport}:${game.id}`, 60_000, async () => ({
      data: await json<ContextSummary>(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(game.id)}`), at: Date.now(),
    }));
  }
  const data = envelope.data;
  const context = parsePreparedGameContext(sport, game, envelope.data, envelope.at);
  if (!context || context.expiresAtMs <= Date.now()) return null;
  // Background work only: Coach reads the prepared result, never fetches charts.
  // Missing event season remains unknown rather than borrowing the calendar year.
  if (sport === "nfl" && Number.isInteger(data.header?.season?.year)) {
    context.depthCharts = (await Promise.all([context.homeTeamId, context.awayTeamId].map(teamId => warmDepthChartEvidence(teamId, data.header!.season!.year!)))).filter((x): x is DepthChartEvidence => x !== null);
  }
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || context.environment.exposure === "indoors" || !["mlb", "nfl", "ncaaf", "soccer", "tennis"].includes(sport)) return context;
  try {
  let coords: { lat: number; lon: number; scope: "venue" | "city" } | null = null;
  const venue = data.gameInfo?.venue;
  const stadium = game.homeAbbr ? resolveFootballStadium(sport, game.homeAbbr) : null;
  const park = sport === "mlb" && game.homeAbbr ? MLB_PARKS[game.homeAbbr] : null;
  const parkName = sport === "mlb" && game.homeAbbr ? PARK_META[game.homeAbbr]?.name : null;
  if (stadium && venue?.fullName && norm(stadium.name) === norm(venue.fullName)) coords = { lat: stadium.lat, lon: stadium.lon, scope: "venue" };
  if (park && parkName && venue?.fullName && norm(parkName) === norm(venue.fullName)) coords = { lat: park.lat, lon: park.lon, scope: "venue" };
  const city = venue?.address?.city, country = venue?.address?.country;
  const code = country ? COUNTRY_CODES[norm(country)] ?? (/^[A-Z]{2}$/.test(country) ? country : null) : null;
  // City forecasts are labelled city-level and never masquerade as stadium readings.
  if (!coords && city && code) {
    const state = venue?.address?.state;
    const query = `${city},${code === "US" && state ? `${state},` : ""}${code}`;
    const found = await cachedJson(`coach-geocode:v1:${query}`, 24 * 3600_000, () => json<Array<{ name?: string; country?: string; lat?: number; lon?: number }>>(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${encodeURIComponent(apiKey)}`));
    const hits = found.filter(r => r.country === code && r.name && norm(r.name) === norm(city) && finite(r.lat) != null && Math.abs(r.lat!) <= 90 && finite(r.lon) != null && Math.abs(r.lon!) <= 180);
    if (hits.length === 1) coords = { lat: hits[0]!.lat!, lon: hits[0]!.lon!, scope: "city" };
  }
  if (coords) {
    const c = coords;
    const forecast = await cachedJson(`coach-forecast:v1:${c.lat.toFixed(3)}:${c.lon.toFixed(3)}`, 5 * 60_000, async () => ({ data: await json<Forecast>(`https://api.openweathermap.org/data/2.5/forecast?lat=${c.lat}&lon=${c.lon}&units=imperial&appid=${encodeURIComponent(apiKey)}`), observedAtMs: Date.now() }));
    context.environment.weather = weatherAtGameTime(forecast.data, game.startsAt, c.scope);
    if (context.environment.weather) context.environment.weather.observedAtMs = forecast.observedAtMs;
  }
  } catch { /* Weather failure never discards a verified lineup. */ }
  return context;
}

export async function warmPreparedGameContexts(sport: string, games: ContextGame[]): Promise<number> {
  return (await withInflightCoalesce(`coach-prepared:${sport}`, async () => {
    const now = Date.now();
    const candidates = games.filter(g => Date.parse(g.startsAt) > now && Date.parse(g.startsAt) < now + 48 * 3600_000).sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    await cacheSet(`coach-prepared-refs:v1:${sport}`, candidates.slice(0, 100), 48 * 3600_000);
    const upcoming = candidates.slice(0, 4);
    const contexts: PreparedGameContext[] = [];
    const deadline = Date.now() + 8000;
    for (const game of upcoming) {
      if (Date.now() >= deadline) break;
      const context = await prepareOne(sport, game).catch(() => null);
      if (context) {
        context.requiresEventTime = games.filter(g => g.homeTeamId === game.homeTeamId && g.awayTeamId === game.awayTeamId && Date.parse(g.startsAt) > now && Date.parse(g.startsAt) < now + 48 * 3600_000).length > 1;
        contexts.push(context);
      }
    }
    await cacheSet(key(sport), contexts, PREPARED_GAME_CONTEXT_TTL_MS);
    return contexts.length;
  })).value;
}

/** Lightweight closed-app refresh: no odds, prop-board or simulation work. */
export async function refreshPreparedGameContexts(): Promise<{ gamesPrepared: number; sports: number }> {
  return (await withInflightCoalesce("coach-prepared-refresh", async () => {
    const sports = [...Object.keys(ESPN_SPORT_PATHS).filter(s => s !== "ufc"), "tennis"];
    let gamesPrepared = 0, sportsPrepared = 0;
    for (let i = 0; i < sports.length; i += 2) {
      await Promise.all(sports.slice(i, i + 2).map(async sport => {
        const games = await cacheGet<ContextGame[]>(`coach-prepared-refs:v1:${sport}`).catch(() => undefined);
        if (!games?.length) return;
        gamesPrepared += await warmPreparedGameContexts(sport, games).catch(() => 0);
        sportsPrepared++;
      }));
    }
    return { gamesPrepared, sports: sportsPrepared };
  })).value;
}

export async function readPreparedGameContexts(sport: string): Promise<PreparedGameContext[]> {
  // Shared-cache outage cannot hold up a Coach request. Never starts a provider fetch.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const values = await Promise.race([cacheGet<PreparedGameContext[]>(key(sport)), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 40); })]);
    return (values ?? []).filter(c => c.version === 1 && c.sport === sport && c.observedAtMs <= Date.now() && c.expiresAtMs > Date.now() && Date.parse(c.startsAt) > Date.now());
  } catch { return []; } finally { if (timer) clearTimeout(timer); }
}
export async function attachPreparedGameContexts<T extends ContextGame>(sport: string, games: T[]): Promise<Array<T & { preparedContext?: PreparedGameContext }>> {
  const contexts = await readPreparedGameContexts(sport);
  return games.map(game => { const context = contexts.find(c => c.eventId === game.id && c.homeTeamId === game.homeTeamId && c.awayTeamId === game.awayTeamId && Date.parse(c.startsAt) === Date.parse(game.startsAt)); return context ? { ...game, preparedContext: context } : game; });
}

/** Match only an unambiguous event; doubleheaders require the exact start time. */
export async function preparedContextForMatch(sport: string, homeTeamId: string, awayTeamId: string, startsAt?: string): Promise<PreparedGameContext | null> {
  if (!homeTeamId || !awayTeamId) return null;
  const contexts = (await readPreparedGameContexts(sport)).filter(c => c.homeTeamId === homeTeamId && c.awayTeamId === awayTeamId && (startsAt ? Date.parse(c.startsAt) === Date.parse(startsAt) : !c.requiresEventTime));
  return contexts.length === 1 ? contexts[0]! : null;
}

// Best-effort app-open preparation: response is already sent, provider work is
// globally one-wide and repeated public requests cannot amplify the queue.
const pendingWarmups = new Map<string, ContextGame[]>();
const lastQueued = new Map<string, number>();
let drainingWarmups = false;
export function schedulePreparedGameContexts(sport: string, games: ContextGame[]): void {
  if ((!ESPN_SPORT_PATHS[sport] && sport !== "tennis") || Date.now() - (lastQueued.get(sport) ?? 0) < 60_000 || !games.some(g => Date.parse(g.startsAt) > Date.now() && Date.parse(g.startsAt) < Date.now() + 48 * 3600_000)) return;
  lastQueued.set(sport, Date.now());
  pendingWarmups.set(sport, games);
  if (drainingWarmups) return;
  drainingWarmups = true;
  setImmediate(() => { void (async () => {
    try {
      while (pendingWarmups.size) {
        const [nextSport, nextGames] = pendingWarmups.entries().next().value!;
        pendingWarmups.delete(nextSport);
        await warmPreparedGameContexts(nextSport, nextGames).catch(() => 0);
      }
    } finally { drainingWarmups = false; }
  })(); });
}
