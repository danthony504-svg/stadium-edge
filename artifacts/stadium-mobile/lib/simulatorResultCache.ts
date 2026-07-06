import type { GameSimulationResult, RealOddsEntry } from "./api";
import type { GameInjuryReport } from "./injuries";

/** Fresh for 3 minutes — middle of the 2–5 minute window users expect. */
export const SIM_RESULT_TTL_MS = 3 * 60_000;

const FINGERPRINT_VERSION = 1;

export type SimInputFingerprint = {
  version: number;
  odds: string;
  injuries: string;
  weather: string;
  lineups: string;
};

export type CachedGameSimResult = {
  gameResult: GameSimulationResult;
  ranAt: number;
  fingerprint: SimInputFingerprint;
};

const cache = new Map<string, CachedGameSimResult>();

export function simResultCacheKey(sport: string, gameId: string): string {
  return `${sport}:${gameId}`;
}

export function fingerprintOddsLines(lines: RealOddsEntry[]): string {
  return lines
    .filter((l): l is RealOddsEntry => !!l && typeof l.market === "string")
    .map((l) => `${l.market}|${l.pick}|${l.odds}`)
    .sort()
    .join(";");
}

export function fingerprintInjuries(report: GameInjuryReport | null | undefined): string {
  if (!report) return "";
  return report.sides
    .flatMap((s) => s.keyPlayers.map((p) => `${p.player}:${p.status}`))
    .sort()
    .join(";");
}

export function fingerprintWeather(
  wx: {
    tempF?: number | null;
    condition?: string | null;
    climateControlled?: boolean;
    impactRating?: string | null;
  } | null,
  weatherImpact: number | null | undefined,
): string {
  if (!wx) return String(weatherImpact ?? "");
  return [
    wx.climateControlled ? "dome" : "outdoor",
    wx.tempF ?? "",
    wx.condition ?? "",
    wx.impactRating ?? "",
    weatherImpact ?? "",
  ].join("|");
}

export function fingerprintLineups(args: {
  homeStarterId?: string | null;
  awayStarterId?: string | null;
  homeStarterName?: string | null;
  awayStarterName?: string | null;
}): string {
  return [
    args.homeStarterId ?? args.homeStarterName ?? "",
    args.awayStarterId ?? args.awayStarterName ?? "",
  ].join("|");
}

export function buildSimInputFingerprint(parts: {
  odds: string;
  injuries: string;
  weather: string;
  lineups: string;
}): SimInputFingerprint {
  return { ...parts, version: FINGERPRINT_VERSION };
}

export function fingerprintKey(fp: SimInputFingerprint): string {
  return `${fp.version}|${fp.odds}|${fp.injuries}|${fp.weather}|${fp.lineups}`;
}

export function isSimCacheFresh(ranAt: number, ttlMs = SIM_RESULT_TTL_MS): boolean {
  return Date.now() - ranAt < ttlMs;
}

function fingerprintsEqual(a: SimInputFingerprint, b: SimInputFingerprint): boolean {
  return (
    a.version === b.version &&
    a.odds === b.odds &&
    a.injuries === b.injuries &&
    a.weather === b.weather &&
    a.lineups === b.lineups
  );
}

export function getCachedGameSim(
  sport: string,
  gameId: string,
  fingerprint: SimInputFingerprint,
  opts?: { ttlMs?: number; pregameOnly?: boolean },
): CachedGameSimResult | null {
  if (opts?.pregameOnly === false) return null;
  const ttlMs = opts?.ttlMs ?? SIM_RESULT_TTL_MS;
  const hit = cache.get(simResultCacheKey(sport, gameId));
  if (!hit) return null;
  if (!isSimCacheFresh(hit.ranAt, ttlMs)) return null;
  if (!fingerprintsEqual(hit.fingerprint, fingerprint)) return null;
  return hit;
}

export function rememberGameSim(sport: string, gameId: string, entry: CachedGameSimResult): void {
  cache.set(simResultCacheKey(sport, gameId), entry);
}

export function clearGameSimCache(sport?: string, gameId?: string): void {
  if (!sport) {
    cache.clear();
    return;
  }
  if (!gameId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${sport}:`)) cache.delete(key);
    }
    return;
  }
  cache.delete(simResultCacheKey(sport, gameId));
}
