import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";

import type { EspnGame, OddsGame, PlayerProp } from "./api";

/** One featured prop row cached for the Discover hero / rails. */
export type CachedPropEntry = {
  prop: PlayerProp;
  gameLabel: string;
  startsAt: string;
  teamAbbr: string | null;
  teamLogo: string | null;
};

const PREFIX = "discover-cache:v3:";
const GEN_KEY = `${PREFIX}ota-generation`;
/** Hero legs older than this are not shown while a fresh fetch is in flight. */
export const HERO_STICKY_MAX_MS = 12 * 60_000;
const MAX_AGE_MS = 30 * 60_000;

/** Sports surfaced on Discover that we persist hero/live/upcoming for. */
export const DISCOVER_CACHE_SPORTS = ["mlb", "wnba", "nba", "nhl", "soccer", "ufc", "nfl"];

const heroBySport = new Map<string, CachedPropEntry[]>();
const heroAtBySport = new Map<string, number>();
const liveBySport = new Map<string, EspnGame[]>();
const upcomingBySport = new Map<string, OddsGame[]>();

let hydratePromise: Promise<boolean> | null = null;
let cacheGenerationValid = false;

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
type StoredHero = { at: number; legs: CachedPropEntry[] };

function currentOtaGeneration(): string {
  if (__DEV__) return "dev";
  if (!Updates.isEnabled) return "embedded";
  return Updates.updateId ?? Updates.runtimeVersion ?? "embedded";
}

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

async function readStoredHero(key: string): Promise<StoredHero | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredHero | Stored<CachedPropEntry[]>;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    if ("legs" in parsed && Array.isArray(parsed.legs)) {
      return { at: parsed.at, legs: parsed.legs };
    }
    const legacy = parsed as Stored<CachedPropEntry[]>;
    if (Array.isArray(legacy.data)) {
      return { at: legacy.at, legs: legacy.data };
    }
    return null;
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

async function writeStoredHero(key: string, legs: CachedPropEntry[]): Promise<void> {
  try {
    const stored: StoredHero = { at: Date.now(), legs };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Best-effort
  }
}

function clearMemory() {
  heroBySport.clear();
  heroAtBySport.clear();
  liveBySport.clear();
  upcomingBySport.clear();
}

/** Drop persisted + in-memory Discover snapshots (e.g. after OTA generation change). */
export async function clearDiscoverCache(): Promise<void> {
  clearMemory();
  cacheGenerationValid = false;
  hydratePromise = null;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // Best-effort
  }
}

async function ensureCacheGeneration(): Promise<boolean> {
  const gen = currentOtaGeneration();
  try {
    const stored = await AsyncStorage.getItem(GEN_KEY);
    if (stored === gen) return true;
    await clearDiscoverCache();
    await AsyncStorage.setItem(GEN_KEY, gen);
    return false;
  } catch {
    return false;
  }
}

/**
 * Load persisted Discover snapshots into the in-memory session cache.
 * Returns false when the OTA generation changed (cache was cleared).
 */
export function hydrateDiscoverCache(sports: string[]): Promise<boolean> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const genOk = await ensureCacheGeneration();
      cacheGenerationValid = genOk;
      await Promise.all(
        sports.map(async (sport) => {
          const [hero, live, upcoming] = await Promise.all([
            readStoredHero(heroKey(sport)),
            readStored<EspnGame[]>(liveKey(sport)),
            readStored<OddsGame[]>(upcomingKey(sport)),
          ]);
          if (hero && hero.legs.length >= 2) {
            heroBySport.set(sport, hero.legs);
            heroAtBySport.set(sport, hero.at);
          }
          if (live && live.length > 0) {
            liveBySport.set(
              sport,
              live.filter((g) => !g.sport || g.sport === sport).map((g) => ({ ...g, sport })),
            );
          }
          if (upcoming && upcoming.length > 0) {
            upcomingBySport.set(
              sport,
              upcoming.filter((g) => !g.sport || g.sport === sport).map((g) => ({ ...g, sport })),
            );
          }
        }),
      );
      return genOk;
    })();
  }
  return hydratePromise;
}

export function isDiscoverCacheGenerationValid(): boolean {
  return cacheGenerationValid;
}

export function cachedHeroLegs(sport: string): CachedPropEntry[] {
  return heroBySport.get(sport) ?? [];
}

export function cachedHeroAgeMs(sport: string): number | null {
  const at = heroAtBySport.get(sport);
  return at != null ? Date.now() - at : null;
}

export function isHeroStickyFresh(sport: string, maxMs = HERO_STICKY_MAX_MS): boolean {
  const age = cachedHeroAgeMs(sport);
  return age != null && age <= maxMs;
}

export function rememberHeroLegs(sport: string, legs: CachedPropEntry[]): void {
  if (legs.length < 2) return;
  const at = Date.now();
  heroBySport.set(sport, legs);
  heroAtBySport.set(sport, at);
  void writeStoredHero(heroKey(sport), legs);
}

export function cachedLiveGames(sport: string): EspnGame[] {
  return (liveBySport.get(sport) ?? []).filter((g) => g.sport === sport);
}

export function rememberLiveGames(sport: string, games: EspnGame[]): void {
  const tagged = games
    .filter((g) => !g.sport || g.sport === sport)
    .map((g) => ({ ...g, sport }));
  if (tagged.length === 0) return;
  liveBySport.set(sport, tagged);
  void writeStored(liveKey(sport), tagged);
}

export function cachedUpcomingGames(sport: string): OddsGame[] {
  return (upcomingBySport.get(sport) ?? []).filter((g) => g.sport === sport);
}

export function rememberUpcomingGames(sport: string, games: OddsGame[]): void {
  const tagged = games
    .filter((g) => !g.sport || g.sport === sport)
    .map((g) => ({ ...g, sport }));
  if (tagged.length === 0) return;
  upcomingBySport.set(sport, tagged);
  void writeStored(upcomingKey(sport), tagged);
}
