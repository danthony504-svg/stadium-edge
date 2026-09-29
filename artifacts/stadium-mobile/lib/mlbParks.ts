/**
 * Static MLB park factors (public multi-year HR index / altitude / dome).
 * Used as a Coach fallback when /mlb-probables has no row for a board game
 * (e.g. pitchers not posted yet) so park/weather Match still grounds.
 * Keep in sync with api-server/src/lib/parks.ts MLB_PARKS values.
 */

export type MlbParkFactor = {
  hrIndex: number;
  altitudeFt: number;
  dome: boolean;
};

export const MLB_PARK_FACTORS: Record<string, MlbParkFactor> = {
  ARI: { hrIndex: 103, altitudeFt: 1059, dome: true },
  ATL: { hrIndex: 101, altitudeFt: 1050, dome: false },
  BAL: { hrIndex: 104, altitudeFt: 33, dome: false },
  BOS: { hrIndex: 108, altitudeFt: 20, dome: false },
  CHC: { hrIndex: 103, altitudeFt: 600, dome: false },
  CHW: { hrIndex: 104, altitudeFt: 595, dome: false },
  CIN: { hrIndex: 112, altitudeFt: 490, dome: false },
  CLE: { hrIndex: 98, altitudeFt: 660, dome: false },
  COL: { hrIndex: 115, altitudeFt: 5200, dome: false },
  DET: { hrIndex: 94, altitudeFt: 600, dome: false },
  HOU: { hrIndex: 104, altitudeFt: 40, dome: true },
  KC: { hrIndex: 95, altitudeFt: 750, dome: false },
  LAA: { hrIndex: 101, altitudeFt: 153, dome: false },
  LAD: { hrIndex: 101, altitudeFt: 522, dome: false },
  MIA: { hrIndex: 93, altitudeFt: 10, dome: true },
  MIL: { hrIndex: 105, altitudeFt: 635, dome: true },
  MIN: { hrIndex: 99, altitudeFt: 815, dome: false },
  NYM: { hrIndex: 97, altitudeFt: 20, dome: false },
  NYY: { hrIndex: 110, altitudeFt: 55, dome: false },
  OAK: { hrIndex: 92, altitudeFt: 30, dome: false },
  ATH: { hrIndex: 92, altitudeFt: 30, dome: false },
  PHI: { hrIndex: 107, altitudeFt: 60, dome: false },
  PIT: { hrIndex: 96, altitudeFt: 730, dome: false },
  SD: { hrIndex: 95, altitudeFt: 62, dome: false },
  SEA: { hrIndex: 92, altitudeFt: 10, dome: true },
  SF: { hrIndex: 90, altitudeFt: 10, dome: false },
  STL: { hrIndex: 96, altitudeFt: 465, dome: false },
  TB: { hrIndex: 96, altitudeFt: 15, dome: true },
  TEX: { hrIndex: 102, altitudeFt: 545, dome: true },
  TOR: { hrIndex: 103, altitudeFt: 250, dome: true },
  WSH: { hrIndex: 100, altitudeFt: 25, dome: false },
};

export function mlbParkForAbbr(abbr: string | null | undefined): MlbParkFactor | null {
  const k = String(abbr ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!k) return null;
  return MLB_PARK_FACTORS[k] ?? null;
}

function utcDayKey(iso: string | null | undefined): string | null {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function easternDayKey(iso: string | null | undefined): string | null {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !day) return null;
    return `${y}${m}${day}`;
  } catch {
    return null;
  }
}

/**
 * Unique ESPN scoreboard day keys for MLB games on the board.
 * Includes UTC + America/New_York calendar days so late tips still match.
 */
export function mlbBoardDayKeys(
  games: Array<{ sport?: string | null; startsAt?: string | null }>,
): string[] {
  const keys = new Set<string>();
  for (const g of games) {
    if (String(g.sport ?? "").toLowerCase() !== "mlb") continue;
    const utc = utcDayKey(g.startsAt);
    const et = easternDayKey(g.startsAt);
    if (utc) keys.add(utc);
    if (et) keys.add(et);
  }
  return [...keys].sort();
}
