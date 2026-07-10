// UFC fighter headshots — Sherdog profile photos, ESPN country flag fallback.

import { fetchClientSherdogFighter } from "./ufcSupplement";
import { fetchUfcSimulatorGamesFromEspn } from "./ufcSimulatorGames";

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export async function fetchSherdogFighterPhoto(
  name: string,
  opponent?: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const patch = await fetchClientSherdogFighter(name, opponent, signal);
  return patch?.photoUrl ?? null;
}

export async function fetchEspnMmaCountryFlag(
  athleteId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/common/v3/sports/mma/athletes/${encodeURIComponent(athleteId)}`,
      {
        headers: { Accept: "application/json", "User-Agent": "StadiumEdge/1.0" },
        signal,
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { athlete?: { flag?: { href?: string } } };
    return data.athlete?.flag?.href ?? null;
  } catch {
    return null;
  }
}

export type UfcFightPhotos = { away: string | null; home: string | null };

export type UfcPhotoMap = Record<string, string>;

const photoCache = new Map<string, string | null>();

export function normFighterName(s: string): string {
  return normName(s);
}

/** Batch-resolve Sherdog headshots for a UFC odds feed (cached per fighter). */
export async function buildUfcFeedPhotoMap(
  fights: ReadonlyArray<{ awayTeam: string; homeTeam: string }>,
  signal?: AbortSignal,
): Promise<UfcPhotoMap> {
  const out: UfcPhotoMap = {};
  const espn = await fetchUfcSimulatorGamesFromEspn(signal).catch(() => []);
  for (const g of espn) {
    if (g.awayTeam && g.awayLogo) out[normName(g.awayTeam)] = g.awayLogo;
    if (g.homeTeam && g.homeLogo) out[normName(g.homeTeam)] = g.homeLogo;
  }

  const opponent = new Map<string, string>();
  const toFetch: string[] = [];
  for (const f of fights) {
    opponent.set(normName(f.awayTeam), f.homeTeam);
    opponent.set(normName(f.homeTeam), f.awayTeam);
    for (const name of [f.awayTeam, f.homeTeam]) {
      const k = normName(name);
      if (out[k]) continue;
      const cached = photoCache.get(k);
      if (cached) {
        if (cached) out[k] = cached;
        continue;
      }
      if (!toFetch.includes(name)) toFetch.push(name);
    }
  }

  const CONCURRENCY = 5;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (name) => {
        const k = normName(name);
        const url = await fetchSherdogFighterPhoto(name, opponent.get(k), signal);
        photoCache.set(k, url);
        if (url) out[k] = url;
      }),
    );
  }

  return out;
}

export function withUfcFightPhotos(
  base: { awayLogo?: string | null; homeLogo?: string | null } | undefined,
  photoMap: UfcPhotoMap | undefined,
  awayTeam: string,
  homeTeam: string,
): { awayLogo?: string | null; homeLogo?: string | null } | undefined {
  if (!photoMap) return base;
  const awayLogo = photoMap[normName(awayTeam)] ?? base?.awayLogo ?? null;
  const homeLogo = photoMap[normName(homeTeam)] ?? base?.homeLogo ?? null;
  if (!awayLogo && !homeLogo && !base?.awayLogo && !base?.homeLogo) return base;
  return { ...(base ?? {}), awayLogo, homeLogo };
}

/** Sherdog headshots first; ESPN scoreboard country flags when no photo. */
export async function resolveUfcFightPhotos(
  awayName: string,
  homeName: string,
  signal?: AbortSignal,
): Promise<UfcFightPhotos> {
  const [awayPhoto, homePhoto, espn] = await Promise.all([
    fetchSherdogFighterPhoto(awayName, homeName, signal),
    fetchSherdogFighterPhoto(homeName, awayName, signal),
    fetchUfcSimulatorGamesFromEspn(signal).catch(() => []),
  ]);

  const bout =
    espn.find(
      (g) => namesMatch(g.awayTeam ?? "", awayName) && namesMatch(g.homeTeam ?? "", homeName),
    ) ?? null;

  let away = awayPhoto ?? bout?.awayLogo ?? null;
  let home = homePhoto ?? bout?.homeLogo ?? null;

  const awayId = bout?.awayTeamId;
  const homeId = bout?.homeTeamId;
  if (!away && awayId) away = await fetchEspnMmaCountryFlag(awayId, signal);
  if (!home && homeId) home = await fetchEspnMmaCountryFlag(homeId, signal);

  return { away, home };
}
