import AsyncStorage from "@react-native-async-storage/async-storage";

import type { EspnGame, OddsGame, PlayerProp } from "./api";

/** One featured prop row cached for the Discover hero / rails. */
export type CachedPropEntry = {
  prop: PlayerProp;
  gameLabel: string;
  startsAt: string;
  teamAbbr: string | null;
  teamLogo: string | null;
};

const PREFIX = "discover-cache:v2:";
const MAX_AGE_MS = 45 * 60_000;

/** Sports surfaced on Discover that we persist hero/live/upcoming for. */
export const DISCOVER_CACHE_SPORTS = ["mlb", "wnba", "nba", "nhl", "soccer", "ufc", "nfl"];

const heroBySport = new Map<string, CachedPropEntry[]>();
const liveBySport = new Map<string, EspnGame[]>();
const upcomingBySport = new Map<string, OddsGame[]>();

let hydratePromise: Promise<void> | null = null;

function heroKey(sport: string) {
  return `${PREFIX}hero:${sport}`;
}
function liveKey(sport: string) {
  return `${PREFIX}live:${sport}`;
}
function upcomingKey(sport: string) {
  return `${PREFIX}upcoming:${sport}`;
}

type Stored<T> = { at: number; data: T };

async function readStored<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeStored<T>(key: string, data: T): Promise<void> {
  try {
    const stored: Stored<T> = { at: Date.now(), data };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Best-effort — never block the UI.
  }
}

/** Load persisted Discover snapshots into the in-memory session cache. */
export function hydrateDiscoverCache(sports: string[]): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      await Promise.all(
        sports.map(async (sport) => {
          const [hero, live, upcoming] = await Promise.all([
            readStored<CachedPropEntry[]>(heroKey(sport)),
            readStored<EspnGame[]>(liveKey(sport)),
            readStored<OddsGame[]>(upcomingKey(sport)),
          ]);
          if (hero && hero.length >= 2) heroBySport.set(sport, hero);
          if (live && live.length > 0) liveBySport.set(sport, live);
          if (upcoming && upcoming.length > 0) upcomingBySport.set(sport, upcoming);
        }),
      );
    })();
  }
  return hydratePromise;
}

export function cachedHeroLegs(sport: string): CachedPropEntry[] {
  return heroBySport.get(sport) ?? [];
}

export function rememberHeroLegs(sport: string, legs: CachedPropEntry[]): void {
  if (legs.length < 2) return;
  heroBySport.set(sport, legs);
  void writeStored(heroKey(sport), legs);
}

export function cachedLiveGames(sport: string): EspnGame[] {
  return liveBySport.get(sport) ?? [];
}

export function rememberLiveGames(sport: string, games: EspnGame[]): void {
  if (games.length === 0) return;
  liveBySport.set(sport, games);
  void writeStored(liveKey(sport), games);
}

export function cachedUpcomingGames(sport: string): OddsGame[] {
  return upcomingBySport.get(sport) ?? [];
}

export function rememberUpcomingGames(sport: string, games: OddsGame[]): void {
  if (games.length === 0) return;
  upcomingBySport.set(sport, games);
  void writeStored(upcomingKey(sport), games);
}
