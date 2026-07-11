// Period-aware score decomposition + race-to simulation for game-line Monte Carlo.

export type SimPeriodScope =
  | "fg"
  | "h1"
  | "h2"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "f5"
  | "i1"
  | "p1"
  | "p2"
  | "p3";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Share of full-game scoring that occurs IN this period (not cumulative). */
function periodIncrementFrac(sport: string, period: SimPeriodScope): number | null {
  const s = sport.toLowerCase();
  if (period === "fg") return 1;
  if (s === "mlb" || s.startsWith("baseball")) {
    if (period === "f5") return 0.55;
    if (period === "i1") return 0.11;
    return null;
  }
  if (s === "nhl" || s.includes("hockey")) {
    if (period === "p1" || period === "p2" || period === "p3") return 1 / 3;
    return null;
  }
  // Basketball / football default quarter shares.
  if (period === "q1" || period === "q3") return 0.26;
  if (period === "q2" || period === "q4") return 0.24;
  if (period === "h1") return 0.5;
  if (period === "h2") return 0.5;
  return null;
}

/** Period-specific team scores for one full-game draw. */
export function periodScoresForDraw(
  sport: string,
  period: SimPeriodScope,
  homeFull: number,
  awayFull: number,
): { home: number; away: number } {
  if (period === "fg") return { home: homeFull, away: awayFull };
  const frac = periodIncrementFrac(sport, period);
  if (frac == null) return { home: homeFull, away: awayFull };
  const noiseH = 1 + (Math.random() - 0.5) * 0.14;
  const noiseA = 1 + (Math.random() - 0.5) * 0.14;
  return {
    home: Math.max(0, round2(homeFull * frac * noiseH)),
    away: Math.max(0, round2(awayFull * frac * noiseA)),
  };
}

/** Sequential race-to-N using Poisson-style possession scoring. */
export function raceToHits(
  target: number,
  teamSide: "home" | "away",
  homeFull: number,
  awayFull: number,
): boolean {
  const t = Math.max(1, Math.round(target));
  const homeRate = Math.max(0.05, homeFull);
  const awayRate = Math.max(0.05, awayFull);
  let h = 0;
  let a = 0;
  let guard = 0;
  while (h < t && a < t && guard < 500) {
    guard += 1;
    const roll = Math.random() * (homeRate + awayRate);
    if (roll < homeRate) h += 1;
    else a += 1;
  }
  if (teamSide === "home") return h >= t && h > a;
  return a >= t && a > h;
}

export function parsePeriodScope(raw: unknown): SimPeriodScope | undefined {
  const p = String(raw ?? "").toLowerCase().trim();
  if (!p || p === "fg" || p === "full") return "fg";
  const map: Record<string, SimPeriodScope> = {
    h1: "h1",
    h2: "h2",
    q1: "q1",
    q2: "q2",
    q3: "q3",
    q4: "q4",
    f5: "f5",
    i1: "i1",
    p1: "p1",
    p2: "p2",
    p3: "p3",
  };
  return map[p];
}

export function sportSupportsPeriod(sport: string, period: SimPeriodScope): boolean {
  if (period === "fg") return true;
  return periodIncrementFrac(sport, period) != null;
}
