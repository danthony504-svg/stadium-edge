export type PlayerSearchHit = {
  athleteId: string;
  name: string;
  sport: string;
  isActive: boolean;
};

function normName(s: string): string {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Pick the best ESPN search hit for a player name within the requested sport. */
export function pickPlayerSearchResult(
  results: PlayerSearchHit[],
  candidate: string,
  sport: string,
): PlayerSearchHit | null {
  const sportLow = sport.toLowerCase();
  const candToks = normName(candidate).split(/\s+/).filter(Boolean);
  if (!candToks.length) return null;

  for (const hit of results) {
    if ((hit.sport ?? "").toLowerCase() !== sportLow) continue;
    const nameToks = normName(hit.name).split(/\s+/).filter(Boolean);
    if (!candToks.every((c) => nameToks.includes(c))) continue;
    if (candToks.length === 1) {
      const isFirstOrLast =
        candToks[0] === nameToks[0] || candToks[0] === nameToks[nameToks.length - 1];
      if (!hit.isActive || !isFirstOrLast) continue;
    }
    return hit;
  }
  return null;
}
