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
